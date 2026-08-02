// Serial manager: owns the USB serial connection to the Scanlight Pico.
//
// - Auto-detects the Pico (USB VID 2E8A) and connects; re-polls after loss (hotplug).
// - Runs the handshake (GET_FW_VERSION -> GET_DEFAULT_RGB -> GET_TRIM) with
//   per-request timeout + retry; the retries cover the firmware's ~600 ms
//   power-on self-test window during which serial is blocked.
// - Dispatches telemetry and responses; the firmware sends NO acks, so GET_*
//   success is inferred purely from receiving the matching response.
// - All writes go through a SendQueue so frames never interleave.
//
// Events:
//   "connected"    {fwId, hwId}
//   "disconnected" {reason}
//   "defaults"     {r, g, b}
//   "trim"         [r, g, b, w] (int8)
//   "telemetry"    {ledTempMdegc} | {vbusMv}
//   "error"        Error

import { EventEmitter } from "node:events";
import { PacketParser } from "../protocol/parser.js";
import { buildPacket } from "../protocol/framer.js";
import { SendQueue } from "./sendQueue.js";
import { MockSerialPort } from "./mock.js";
import {
  BAUD_RATE,
  SERIAL_VID,
  HANDSHAKE_TIMEOUT_MS,
  HANDSHAKE_RETRIES,
  RECONNECT_POLL_MS,
  RECONNECT_MAX_BACKOFF_MS,
  HWVersionStrings,
} from "../config.js";
import {
  PKT_H2D_GET_DEFAULT_RGB,
  PKT_H2D_GET_FW_VERSION,
  PKT_H2D_GET_TRIM,
  PKT_D2H_LED_TEMP,
  PKT_D2H_VBUS,
  PKT_D2H_FW_VERSION,
  PKT_D2H_DEFAULT_RGB,
  PKT_D2H_TRIM,
} from "../protocol/constants.js";

export class SerialManager extends EventEmitter {
  constructor({ SerialPortClass = null } = {}) {
    super();
    this.SerialPortClass = SerialPortClass; // lazy-imported in start() unless injected
    this.mock = process.env.MOCK_SERIAL === "1";
    this.port = null;
    this.parser = null;
    this.queue = null;
    this.pending = new Map(); // response header -> {resolve, reject, timer}
    this.connected = false;
    this.stopping = false;
    this.pollTimer = null;
    this.pollAttempts = 0;
    this.fwId = null;
    this.hwId = null;
  }

  isConnected() {
    return this.connected;
  }

  async start() {
    if (this.mock) {
      const port = new MockSerialPort();
      this.attach(port);
      port.open();
      return;
    }
    if (!this.SerialPortClass) {
      ({ SerialPort: this.SerialPortClass } = await import("serialport"));
    }
    this.schedulePoll(0);
  }

  /** Queue a packet for sending. Rejects if not connected. */
  sendPacket(header, data = []) {
    if (!this.connected || !this.queue) {
      return Promise.reject(new Error("serial not connected"));
    }
    return this.queue.send(buildPacket(header, data));
  }

  /** Force an immediate re-scan (UI "rescan" action). */
  rescan() {
    if (this.mock || this.connected || this.stopping) return;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.schedulePoll(0);
  }

  /** Idempotent teardown. */
  async close() {
    this.stopping = true;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.failPending(new Error("serial manager closing"));
    await this.detach();
  }

  // --- internals -----------------------------------------------------------

  schedulePoll(delayMs = null) {
    if (this.stopping || this.mock || this.connected) return;
    if (delayMs === null) {
      delayMs = Math.min(
        RECONNECT_MAX_BACKOFF_MS,
        RECONNECT_POLL_MS * Math.max(1, this.pollAttempts)
      );
    }
    this.pollTimer = setTimeout(() => this.poll(), delayMs);
  }

  async poll() {
    this.pollTimer = null;
    if (this.stopping || this.connected) return;
    try {
      const ports = await this.SerialPortClass.list();
      const pico = ports.find(
        (p) => (p.vendorId || "").toLowerCase() === SERIAL_VID
      );
      if (pico) {
        this.pollAttempts = 0;
        this.openPort(pico.path);
        return;
      }
    } catch (err) {
      this.emit("error", new Error(`serial port scan failed: ${err.message}`));
    }
    this.pollAttempts++;
    this.schedulePoll();
  }

  openPort(path) {
    let port;
    try {
      port = new this.SerialPortClass({ path, baudRate: BAUD_RATE, autoOpen: false });
    } catch (err) {
      this.emit("error", new Error(`cannot create serial port ${path}: ${err.message}`));
      this.schedulePoll();
      return;
    }
    this.attach(port);
    port.open((err) => {
      if (err) {
        const hint =
          err.code === "EACCES" || /permission denied/i.test(err.message)
            ? " (permission denied — add your user to the dialout group: sudo usermod -aG dialout $USER)"
            : "";
        this.emit("error", new Error(`cannot open ${path}: ${err.message}${hint}`));
        this.detach().then(() => this.schedulePoll());
      }
    });
  }

  attach(port) {
    this.port = port;
    this.parser = new PacketParser();
    this.queue = new SendQueue(
      (buf) =>
        new Promise((resolve, reject) => {
          port.write(buf, (err) => (err ? reject(err) : resolve()));
        })
    );
    port.on("data", (chunk) => this.parser.feed(chunk));
    this.parser.on("packet", (header, data) => this.onPacket(header, data));
    port.on("open", () => {
      this.handshake().catch((err) => {
        this.emit("error", err);
        this.handleLoss("handshake failed");
      });
    });
    port.on("close", () => this.handleLoss("port closed"));
    port.on("error", (err) => {
      this.emit("error", err);
      this.handleLoss("port error");
    });
  }

  async detach() {
    const port = this.port;
    this.port = null;
    this.parser = null;
    this.queue = null;
    if (!port) return;
    port.removeAllListeners();
    if (port.isOpen) {
      await new Promise((resolve) => port.close(() => resolve()));
    }
  }

  handleLoss(reason) {
    const wasConnected = this.connected || this.port !== null;
    this.connected = false;
    this.fwId = null;
    this.hwId = null;
    this.failPending(new Error("serial disconnected"));
    this.detach().then(() => {
      if (wasConnected) {
        this.emit("disconnected", { reason });
      }
      this.schedulePoll();
    });
  }

  failPending(err) {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(err);
    }
    this.pending.clear();
  }

  async handshake() {
    // FW version is mandatory — without it the hardware cannot be gated.
    const versionBuf = await this.request(
      PKT_H2D_GET_FW_VERSION,
      PKT_D2H_FW_VERSION
    );
    const word = versionBuf.readUInt32BE(0);
    this.fwId = word & 0xffff;
    this.hwId = word >>> 16;
    this.connected = true;
    this.emit("connected", {
      fwId: this.fwId,
      hwId: this.hwId,
      hwVersion: HWVersionStrings[this.hwId] || `Unknown (ID ${this.hwId})`,
    });

    // Defaults + trim are best-effort; keep firmware defaults on failure.
    try {
      const rgb = await this.request(PKT_H2D_GET_DEFAULT_RGB, PKT_D2H_DEFAULT_RGB);
      this.emit("defaults", { r: rgb[0], g: rgb[1], b: rgb[2] });
    } catch (err) {
      this.emit("error", new Error(`GET_DEFAULT_RGB failed: ${err.message}`));
    }
    try {
      const trim = await this.request(PKT_H2D_GET_TRIM, PKT_D2H_TRIM);
      this.emit("trim", [0, 1, 2, 3].map((i) => trim.readInt8(i)));
    } catch (err) {
      this.emit("error", new Error(`GET_TRIM failed: ${err.message}`));
    }
  }

  /** Send a GET_* and wait for the matching response, with timeout + retries. */
  request(h2dHeader, d2hHeader) {
    let lastErr;
    const attempt = () =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(d2hHeader);
          reject(new Error("timeout"));
        }, HANDSHAKE_TIMEOUT_MS);
        this.pending.set(d2hHeader, { resolve, reject, timer });
        this.queue.send(buildPacket(h2dHeader)).catch((err) => {
          clearTimeout(timer);
          this.pending.delete(d2hHeader);
          reject(err);
        });
      });
    const run = async () => {
      for (let i = 0; i < HANDSHAKE_RETRIES; i++) {
        try {
          return await attempt();
        } catch (err) {
          lastErr = err;
        }
      }
      throw lastErr;
    };
    return run();
  }

  onPacket(header, data) {
    const pending = this.pending.get(header);
    if (pending) {
      clearTimeout(pending.timer);
      this.pending.delete(header);
      pending.resolve(data);
      return;
    }
    switch (header) {
      case PKT_D2H_LED_TEMP:
        if (data.length >= 4) this.emit("telemetry", { ledTempMdegc: data.readInt32BE(0) });
        break;
      case PKT_D2H_VBUS:
        if (data.length >= 4) this.emit("telemetry", { vbusMv: data.readInt32BE(0) });
        break;
      case PKT_D2H_DEFAULT_RGB:
        if (data.length >= 3) this.emit("defaults", { r: data[0], g: data[1], b: data[2] });
        break;
      case PKT_D2H_TRIM:
        if (data.length >= 4) this.emit("trim", [0, 1, 2, 3].map((i) => data.readInt8(i)));
        break;
      default:
        break; // unknown/unsolicited packets: drop
    }
  }
}
