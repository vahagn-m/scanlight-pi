// gphoto2 CLI wrapper: camera detection and shutter release.
//
// Security/safety rules (per project CLAUDE.md):
// - gphoto2 is ONLY invoked via execFile with argument arrays (never string concat).
// - Every invocation has an explicit timeout: SIGTERM, then SIGKILL after a grace period.
// - stderr is scanned for camera-busy signatures (Linux automount daemons like
//   gvfs-gphoto2-volume-monitor lock the USB interface and produce
//   "*** Error ***  -1: Unspecified error").
// - A mutex guarantees at most one gphoto2 process at a time.
//
// Mock mode: MOCK_CAMERA=1 (MOCK_CAMERA_FAIL=1 makes captures fail).

import { execFile } from "node:child_process";
import {
  GPHOTO2_BIN,
  GPHOTO2_TIMEOUT_MS,
  GPHOTO2_DETECT_TIMEOUT_MS,
  GPHOTO2_KILL_GRACE_MS,
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

let busy = false;

export function isBusy() {
  return busy;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Run gphoto2 with an argument array, timeout, and SIGTERM->SIGKILL escalation. */
function runGphoto2(args, timeoutMs) {
  return new Promise((resolve) => {
    let killTimer = null;
    const child = execFile(
      GPHOTO2_BIN,
      args,
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
    }, timeoutMs);
  });
}

/** Inspect gphoto2 output and throw a descriptive Gphoto2Error on failure. */
function assertSuccess({ error, stdout, stderr }, context) {
  const detail = (stderr || stdout || "").trim();
  if (error && (error.killed || error.signal)) {
    throw new Gphoto2Error(`gphoto2 ${context} timed out and was killed`, { detail });
  }
  if (error && error.code === "ENOENT") {
    throw new Gphoto2Error("gphoto2 is not installed or not on PATH", { detail });
  }
  const busyPattern = /-1:\s*Unspecified error|\*\*\*\s*Error|could not lock|camera is busy/i;
  if (busyPattern.test(detail)) {
    throw new Gphoto2Error(
      "camera busy — another process may hold it (disable gvfs-gphoto2-volume-monitor / unplug-replug camera)",
      { busy: true, detail }
    );
  }
  if ((error && error.code !== 0) || /error/i.test(detail)) {
    throw new Gphoto2Error(`gphoto2 ${context} failed: ${detail.split("\n")[0]}`, {
      detail,
    });
  }
}

/** Detect attached camera via `gphoto2 --auto-detect`. Never throws. */
export async function detect() {
  if (mock) {
    return { connected: true, model: "Mock Camera" };
  }
  try {
    const result = await runGphoto2(["--auto-detect"], GPHOTO2_DETECT_TIMEOUT_MS);
    if (result.error && result.error.code === "ENOENT") {
      return { connected: false, model: "", error: "gphoto2 not installed" };
    }
    // Output rows look like: "Canon EOS 5D                   usb:001,005"
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
 * Trigger one exposure (image stays on the camera card). Resolves when the
 * camera confirms the capture; throws Gphoto2Error otherwise.
 */
export async function captureImage() {
  if (mock) {
    await sleep(MOCK_CAPTURE_MS);
    if (mockFail) {
      throw new Gphoto2Error("mock capture failure", { detail: "MOCK_CAMERA_FAIL=1" });
    }
    return { ok: true };
  }
  if (busy) {
    throw new Gphoto2Error("camera busy — a capture is already in progress", { busy: true });
  }
  busy = true;
  try {
    const result = await runGphoto2(["--capture-image"], GPHOTO2_TIMEOUT_MS);
    assertSuccess(result, "capture");
    return { ok: true };
  } finally {
    busy = false;
  }
}
