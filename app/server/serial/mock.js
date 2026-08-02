// Mock serial port emulating a Scanlight Pico, for hardware-free development.
// Enabled with MOCK_SERIAL=1. Same event surface as a SerialPort instance:
// "open", "data", "close", "error" events plus write(buf, cb) and close(cb).
//
// Env knobs: MOCK_HW_ID (default 0 = big scanlight v1, all features),
// MOCK_FW_ID (default 2).

import { EventEmitter } from "node:events";
import { PacketParser } from "../protocol/parser.js";
import { buildPacket } from "../protocol/framer.js";
import {
  PKT_H2D_SET_COLOR,
  PKT_H2D_GET_DEFAULT_RGB,
  PKT_H2D_GET_FW_VERSION,
  PKT_H2D_SET_TRIM,
  PKT_H2D_GET_TRIM,
  PKT_D2H_LED_TEMP,
  PKT_D2H_VBUS,
  PKT_D2H_FW_VERSION,
  PKT_D2H_DEFAULT_RGB,
  PKT_D2H_TRIM,
} from "../protocol/constants.js";

const TELEMETRY_INTERVAL_MS = 200;
const MOCK_LED_TEMP_MDEGC = 25000;
const MOCK_VBUS_MV = 5100;

function int32BE(value) {
  const buf = Buffer.alloc(4);
  buf.writeInt32BE(value, 0);
  return [...buf];
}

export class MockSerialPort extends EventEmitter {
  constructor(options = {}) {
    super();
    this.fwId = options.fwId ?? Number(process.env.MOCK_FW_ID ?? 2);
    this.hwId = options.hwId ?? Number(process.env.MOCK_HW_ID ?? 0);
    this.defaultRgb = [255, 255, 255];
    this.trim = [0, 0, 0, 17]; // BSL1 firmware defaults
    this.isOpen = false;
    this.telemetryTimer = null;

    this.parser = new PacketParser();
    this.parser.on("packet", (header, data) => this.onPacket(header, data));
  }

  open(cb) {
    setTimeout(() => {
      this.isOpen = true;
      this.emit("open");
      this.telemetryTimer = setInterval(() => {
        this.respond(PKT_D2H_LED_TEMP, int32BE(MOCK_LED_TEMP_MDEGC));
        this.respond(PKT_D2H_VBUS, int32BE(MOCK_VBUS_MV));
      }, TELEMETRY_INTERVAL_MS);
      if (cb) cb(null);
    }, 50);
  }

  write(buf, cb) {
    if (!this.isOpen) {
      if (cb) process.nextTick(cb, new Error("port not open"));
      return false;
    }
    this.parser.feed(buf);
    if (cb) process.nextTick(cb, null);
    return true;
  }

  close(cb) {
    if (this.telemetryTimer) {
      clearInterval(this.telemetryTimer);
      this.telemetryTimer = null;
    }
    this.isOpen = false;
    process.nextTick(() => {
      this.emit("close");
      if (cb) cb(null);
    });
  }

  respond(header, data) {
    this.emit("data", buildPacket(header, data));
  }

  onPacket(header, data) {
    switch (header) {
      case PKT_H2D_GET_FW_VERSION: {
        const word = (this.fwId & 0xffff) | ((this.hwId & 0xffff) << 16);
        const buf = Buffer.alloc(4);
        buf.writeUInt32BE(word >>> 0, 0);
        this.respond(PKT_D2H_FW_VERSION, [...buf]);
        break;
      }
      case PKT_H2D_GET_DEFAULT_RGB:
        this.respond(PKT_D2H_DEFAULT_RGB, this.defaultRgb);
        break;
      case PKT_H2D_GET_TRIM:
        this.respond(
          PKT_D2H_TRIM,
          this.trim.map((t) => t & 0xff)
        );
        break;
      case PKT_H2D_SET_COLOR:
        // Firmware: store as default only when the save-preset flag (byte 5) is set.
        if (data.length >= 6 && data[5] !== 0) {
          this.defaultRgb = [data[0], data[1], data[2]];
        }
        break;
      case PKT_H2D_SET_TRIM:
        if (data.length >= 4) {
          this.trim = [0, 1, 2, 3].map((i) => Buffer.from([data[i]]).readInt8(0));
        }
        break; // firmware sends no response for SET_TRIM
      default:
        break;
    }
  }
}
