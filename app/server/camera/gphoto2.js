// gphoto2 wrapper: camera detection + fast shutter triggering.
//
// Triggering runs inside ONE persistent `gphoto2 --shell` session so the PTP
// connection to the camera stays warm between exposures (no per-capture USB
// re-init — that was the slow part). Commands are single lines; completion is
// detected by the shell prompt: `gphoto2: {<cwd>} /> ` (observed on 2.5.32;
// the regex is tolerant and the first prompt seen is logged for tuning).
//
// Detection stays per-process (`gphoto2 --auto-detect`): it only enumerates
// USB devices and never claims the interface, so it cannot fight the shell
// session's USB lock.
//
// Safety rules (per project CLAUDE.md): gphoto2 invoked ONLY with argument
// arrays; explicit timeouts; SIGTERM then SIGKILL; stderr/stdout scanned for
// camera-busy signatures (gvfs/PTP daemons locking the device produce
// "*** Error ***  -1: Unspecified error" / "Could not claim the USB device").
//
// Mock mode: MOCK_CAMERA=1 (MOCK_CAMERA_FAIL=1 makes captures fail).

import { spawn, execFile } from "node:child_process";
import {
  GPHOTO2_BIN,
  GPHOTO2_DETECT_TIMEOUT_MS,
  GPHOTO2_KILL_GRACE_MS,
  GPHOTO2_SHELL_READY_MS,
  GPHOTO2_SHELL_CMD_MS,
  GPHOTO2_CAPTURE_CMD_MS,
  GPHOTO2_RESTART_BACKOFF_MS,
  GPHOTO2_RESTART_MAX_BACKOFF_MS,
  GPHOTO2_BUSY_POLL_MS,
  GPHOTO2_BUSY_WAIT_MS,
  SHUTTER_COMMAND,
  SHUTTER_VALUE_PREFERENCE,
} from "../config.js";

const mock = process.env.MOCK_CAMERA === "1";
const mockFail = process.env.MOCK_CAMERA_FAIL === "1";
const MOCK_CAPTURE_MS = 200;

export class Gphoto2Error extends Error {
  constructor(message, { busy = false, detail = "" } = {}) {
    super(message);
    this.name = "Gphoto2Error";
    this.busy = busy; // camera likely locked by another process
    this.detail = detail;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Prompt as emitted by gphoto2 --shell, e.g. `gphoto2: {...scanlight-pi/app} /> `
// (local cwd in braces, then the camera folder, ending in ">").
const PROMPT_RE = /gphoto2:\s*\{[^}]*\}[^>\n]*>\s*$/;

// Error signatures in command output. Errors appear compactly on stdout
// (`*** Error (-53: '...') ***`) and verbosely on stderr — both are scanned.
// Busy covers both a daemon holding the USB lock (-1: 'Unspecified error')
// and the camera still processing the previous shot (-110: 'I/O in progress').
const BUSY_PATTERN =
  /-1:\s*Unspecified error|Could not (lock|claim)|could not lock|camera is busy|-110:|I\/O in progress/i;
const ERROR_PATTERN = /\*\*\*\s*Error|ERROR:/i;

function assertSuccess(text, cmd) {
  const detail = text.trim();
  if (BUSY_PATTERN.test(detail)) {
    throw new Gphoto2Error(
      "camera busy — still processing a shot, or another process holds it (disable gvfs-gphoto2-volume-monitor / PTP daemons, or replug the camera)",
      { busy: true, detail }
    );
  }
  if (ERROR_PATTERN.test(detail)) {
    const line =
      detail.split("\n").find((l) => ERROR_PATTERN.test(l)) || detail.split("\n")[0];
    throw new Gphoto2Error(`gphoto2 "${cmd}" failed: ${line.trim()}`, { detail });
  }
}

/** Persistent gphoto2 --shell session with a serialized command queue. */
class Gphoto2Shell {
  constructor() {
    this.child = null;
    this.buffer = "";
    this.stderrBuffer = "";
    this.ready = false;
    this.closed = false;
    this.spawning = null; // in-flight spawn promise (dedupes concurrent ensures)
    this.spawnReject = null; // rejects the spawn promise if the session dies pre-ready
    this.pendingReady = null; // {resolve, timer}
    this.pendingCmd = null; // {resolve, timer}
    this.queue = Promise.resolve();
    this.inflight = 0;
    this.restartAttempts = 0;
    this.promptLogged = false;
    this.shutterCommand = null; // resolved trigger, cached per gphoto2 build
  }

  isBusy() {
    return this.inflight > 0;
  }

  /**
   * Non-exposing readiness probe: a read that reports PTP Device Busy while
   * the camera is still processing. Used to wait for the camera to be ready
   * BEFORE triggering, so the shutter command itself is only ever sent once
   * (re-sending it in a busy-retry loop re-fires the shutter on some bodies).
   */
  async probeReady() {
    await this.command("get-config eosremoterelease", GPHOTO2_SHELL_CMD_MS);
  }

  /**
   * Resolve the shutter command for this gphoto2 build. An explicit
   * GPHOTO2_SHUTTER_COMMAND always wins. Otherwise query the
   * eosremoterelease widget once and pick the first preferred value it
   * accepts — accepted labels differ across libgphoto2 versions, and some
   * builds silently ignore invalid values instead of erroring.
   */
  async resolveShutterCommand() {
    if (SHUTTER_COMMAND) return SHUTTER_COMMAND;
    if (this.shutterCommand) return this.shutterCommand;
    const fallback = SHUTTER_VALUE_PREFERENCE[0];
    let output;
    try {
      output = await this.command("get-config eosremoterelease", GPHOTO2_SHELL_CMD_MS);
    } catch (err) {
      // Leave un-cached so the next capture retries detection.
      console.log(`[camera] shutter detection failed (${err.message}) — trying ${fallback}`);
      return `set-config eosremoterelease=${fallback}`;
    }
    const choices = [...output.matchAll(/^Choice:\s*\d+\s+(.+)$/gm)].map((m) => m[1].trim());
    const value = SHUTTER_VALUE_PREFERENCE.find((v) => choices.includes(v)) ?? fallback;
    if (!choices.includes(value)) {
      console.log(
        `[camera] eosremoterelease choices (${choices.join(", ") || "none parsed"}) ` +
          `include no preferred value — defaulting to ${value}`
      );
    }
    this.shutterCommand = `set-config eosremoterelease=${value}`;
    console.log(`[camera] shutter trigger: ${this.shutterCommand}`);
    return this.shutterCommand;
  }

  /** Run one shell command; resolves with its output (prompt/echo stripped). */
  command(cmd, timeoutMs = GPHOTO2_SHELL_CMD_MS) {
    const run = async () => {
      this.inflight++;
      try {
        await this.ensureReady();
        this.stderrBuffer = "";
        const output = await this.sendAndWait(cmd, timeoutMs);
        assertSuccess(`${output}\n${this.stderrBuffer}`, cmd);
        return output;
      } finally {
        this.inflight--;
      }
    };
    // Serialize; keep the chain alive across failures.
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  /** Idempotent teardown. */
  close() {
    this.closed = true;
    this.killSession("shutdown");
  }

  // --- internals -----------------------------------------------------------

  async ensureReady() {
    if (this.closed) throw new Gphoto2Error("gphoto2 session is closed");
    if (this.child && this.ready) return;
    if (this.spawning) return this.spawning;
    this.spawning = (async () => {
      if (this.restartAttempts > 0) {
        const backoff = Math.min(
          GPHOTO2_RESTART_MAX_BACKOFF_MS,
          GPHOTO2_RESTART_BACKOFF_MS * this.restartAttempts
        );
        await sleep(backoff);
      }
      await this.spawnSession();
    })().finally(() => {
      this.spawning = null;
    });
    return this.spawning;
  }

  spawnSession() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (err) => {
        if (settled) return;
        settled = true;
        this.spawnReject = null;
        if (this.pendingReady) {
          clearTimeout(this.pendingReady.timer);
          this.pendingReady = null;
        }
        reject(err);
      };
      this.spawnReject = fail;

      let child;
      try {
        child = spawn(GPHOTO2_BIN, ["--shell"], { stdio: ["pipe", "pipe", "pipe"] });
      } catch (err) {
        fail(new Gphoto2Error(`cannot spawn gphoto2: ${err.message}`));
        return;
      }
      this.child = child;
      this.buffer = "";
      this.stderrBuffer = "";
      this.ready = false;

      child.on("error", (err) => {
        this.markDead();
        fail(
          new Gphoto2Error(
            err.code === "ENOENT"
              ? "gphoto2 is not installed or not on PATH"
              : `gphoto2 spawn failed: ${err.message}`
          )
        );
      });
      child.stdin.on("error", () => this.markDead()); // pipe closed under us
      child.stdout.on("data", (chunk) => this.onStdout(chunk.toString("utf8")));
      child.stderr.on("data", (chunk) => {
        this.stderrBuffer += chunk.toString("utf8");
      });
      child.on("exit", (code, signal) => {
        console.warn(`[camera] gphoto2 shell exited (code=${code}, signal=${signal})`);
        this.markDead();
        fail(new Gphoto2Error("gphoto2 shell exited before becoming ready"));
      });

      const timer = setTimeout(() => {
        this.killSession("ready timeout");
        fail(new Gphoto2Error("gphoto2 shell did not show a prompt in time"));
      }, GPHOTO2_SHELL_READY_MS);
      this.pendingReady = {
        timer,
        resolve: () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          this.spawnReject = null;
          this.pendingReady = null;
          this.ready = true;
          this.restartAttempts = 0;
          this.buffer = "";
          resolve();
        },
      };
    });
  }

  onStdout(text) {
    this.buffer += text;
    if (!PROMPT_RE.test(this.buffer)) return;
    if (!this.promptLogged) {
      const sample = this.buffer.match(/gphoto2:[^\n]*/)?.[0];
      console.log(`[camera] gphoto2 prompt sample: ${JSON.stringify(sample)}`);
      this.promptLogged = true;
    }
    if (this.pendingReady) {
      this.pendingReady.resolve();
      return;
    }
    if (this.pendingCmd) {
      const pending = this.pendingCmd;
      this.pendingCmd = null;
      const output = this.buffer;
      this.buffer = "";
      clearTimeout(pending.timer);
      pending.resolve(output);
    }
  }

  sendAndWait(cmd, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCmd = null;
        this.killSession("command timeout");
        reject(new Gphoto2Error(`gphoto2 command timed out: ${cmd}`));
      }, timeoutMs);
      this.pendingCmd = { timer, resolve: (output) => resolve(this.stripEcho(output, cmd)) };
      try {
        this.child.stdin.write(`${cmd}\n`);
      } catch (err) {
        clearTimeout(timer);
        this.pendingCmd = null;
        this.markDead();
        reject(new Gphoto2Error(`cannot write to gphoto2 shell: ${err.message}`));
      }
    });
  }

  /** The shell echoes the command line right after the prompt — drop it. */
  stripEcho(output, cmd) {
    const lines = output.split("\n");
    while (lines.length && lines[0].trim() === cmd.trim()) {
      lines.shift();
    }
    return lines.join("\n").trim();
  }

  /** Session went away: clear state, fail anything waiting on it. */
  markDead() {
    const hadSession = this.child !== null;
    this.ready = false;
    this.child = null;
    if (hadSession) this.restartAttempts++;
    if (this.pendingCmd) {
      clearTimeout(this.pendingCmd.timer);
      const pending = this.pendingCmd;
      this.pendingCmd = null;
      // Resolve with error-marker output so assertSuccess throws a clean error
      // (rejecting mid-queue would poison nothing, but this keeps one path).
      pending.resolve("*** Error (-1: 'gphoto2 session died') ***");
    }
    if (this.spawnReject) {
      this.spawnReject(new Gphoto2Error("gphoto2 session died during startup"));
    }
  }

  killSession(reason) {
    const child = this.child;
    if (this.pendingReady) {
      clearTimeout(this.pendingReady.timer);
      this.pendingReady = null;
    }
    if (this.pendingCmd) {
      clearTimeout(this.pendingCmd.timer);
      this.pendingCmd = null;
    }
    this.ready = false;
    this.child = null;
    if (!child) return;
    console.warn(`[camera] killing gphoto2 shell (${reason})`);
    child.removeAllListeners();
    child.stdin?.removeAllListeners();
    child.kill("SIGTERM");
    const killTimer = setTimeout(() => child.kill("SIGKILL"), GPHOTO2_KILL_GRACE_MS);
    child.once("exit", () => clearTimeout(killTimer));
    if (reason !== "shutdown") this.restartAttempts++;
  }
}

const shell = new Gphoto2Shell();

export function isBusy() {
  return !mock && shell.isBusy();
}

/** Detect attached camera via `gphoto2 --auto-detect` (enumerate-only, no USB claim). Never throws. */
export async function detect() {
  if (mock) {
    return { connected: true, model: "Mock Camera" };
  }
  try {
    const result = await new Promise((resolve) => {
      let killTimer = null;
      const child = execFile(
        GPHOTO2_BIN,
        ["--auto-detect"],
        { maxBuffer: 1024 * 1024 },
        (error, stdout, stderr) => {
          clearTimeout(timer);
          if (killTimer) clearTimeout(killTimer);
          resolve({ error, stdout: stdout || "", stderr: stderr || "" });
        }
      );
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        killTimer = setTimeout(() => child.kill("SIGKILL"), GPHOTO2_KILL_GRACE_MS);
      }, GPHOTO2_DETECT_TIMEOUT_MS);
    });
    if (result.error && result.error.code === "ENOENT") {
      return { connected: false, model: "", error: "gphoto2 not installed" };
    }
    // Output rows look like: "Canon EOS M3                   usb:002,001"
    const match = result.stdout.match(/^\s*(.+?)\s{2,}(usb:\S+)/m);
    if (match) {
      return { connected: true, model: match[1].trim() };
    }
    return { connected: false, model: "" };
  } catch (err) {
    return { connected: false, model: "", error: err.message };
  }
}

/**
 * Trigger one exposure through the warm shell session (image stays on the
 * camera card). The trigger defaults to the first accepted eosremoterelease
 * value of the installed gphoto2 build (see resolveShutterCommand); override
 * with GPHOTO2_SHUTTER_COMMAND.
 *
 * The camera reports PTP Device Busy while it finishes an exposure, so we wait
 * for it to become ready using a NON-exposing probe and then send the shutter
 * command exactly once. The trigger must not be re-sent in a busy-retry loop:
 * on some bodies each send fires the shutter again (continuous shooting).
 * Throws Gphoto2Error on failure; the session auto-respawns on death.
 * @param {{shouldAbort?: () => boolean}} opts Optional abort probe checked while waiting.
 */
export async function captureImage(opts = {}) {
  const shouldAbort = opts.shouldAbort ?? (() => false);
  if (mock) {
    await sleep(MOCK_CAPTURE_MS);
    if (mockFail) {
      throw new Gphoto2Error("mock capture failure", { detail: "MOCK_CAMERA_FAIL=1" });
    }
    return { ok: true };
  }
  const shutterCmd = await shell.resolveShutterCommand();
  const busyDeadline = Date.now() + GPHOTO2_BUSY_WAIT_MS;

  // Wait until the camera is no longer busy from a previous exposure BEFORE
  // triggering. probeReady is a read, so polling it never takes a shot.
  for (;;) {
    try {
      await shell.probeReady();
      break;
    } catch (err) {
      if (err instanceof Gphoto2Error && err.busy) {
        if (shouldAbort() || Date.now() >= busyDeadline) throw err;
        await sleep(GPHOTO2_BUSY_POLL_MS);
        continue;
      }
      // Probe not applicable (e.g. non-EOS override) — fire anyway; a real
      // problem will surface from the trigger itself below.
      break;
    }
  }

  try {
    await shell.command(shutterCmd, GPHOTO2_CAPTURE_CMD_MS);
    return { ok: true };
  } catch (err) {
    if (err instanceof Gphoto2Error && err.busy) {
      // The camera went busy as the trigger landed — the exposure was taken
      // and it is now processing. Do NOT re-send the trigger (that re-fires
      // the shutter); report success and let the next capture wait it out.
      return { ok: true };
    }
    // Non-busy failure (camera unplugged, stale USB port binding, PTP error):
    // discard the session so the caller's next attempt respawns it fresh and
    // rebinds the camera wherever it re-enumerated.
    shell.killSession("capture error recovery");
    throw err;
  }
}

/** Tear down the shell session (server shutdown). Idempotent. */
export function close() {
  shell.close();
}
