// Socket.io event layer: client<->server control surface plus wiring of
// serial manager events into shared state + broadcasts.
// Event naming convention: domain:action (per project CLAUDE.md).

import { state, statusSnapshot } from "./state.js";
import * as presets from "./presets/store.js";
import * as camera from "./camera/gphoto2.js";
import { runSequence } from "./automation/sequence.js";
import {
  Sequences,
  FWVersionStrings,
  SEQUENCE_PRE_DELAY_MIN_S,
  SEQUENCE_PRE_DELAY_MAX_S,
  SEQUENCE_POST_DELAY_MIN_S,
  SEQUENCE_POST_DELAY_MAX_S,
} from "./config.js";
import {
  PKT_H2D_SET_COLOR,
  PKT_H2D_SET_TRIM,
  PKT_H2D_GET_DEFAULT_RGB,
} from "./protocol/constants.js";

const HW_BSL1 = "big scanlight v1";

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

function lightStatePayload() {
  return {
    r: state.light.r,
    g: state.light.g,
    b: state.light.b,
    channels: [...state.light.channels],
  };
}

function buildSetColorPayload(saveFlag) {
  const { r, g, b, channels } = state.light;
  return [
    (r * channels[0]) & 0xff,
    (g * channels[1]) & 0xff,
    (b * channels[2]) & 0xff,
    (255 * channels[3]) & 0xff,
    (255 * channels[4]) & 0xff,
    saveFlag ? 1 : 0,
  ];
}

function isByte(v) {
  return Number.isInteger(v) && v >= 0 && v <= 255;
}

function isChannelMask(ch) {
  return Array.isArray(ch) && ch.length === 5 && ch.every((c) => c === 0 || c === 1);
}

/**
 * @param {import("socket.io").Server} io
 * @param {{serial: import("./serial/manager.js").SerialManager}} deps
 */
export function registerSocketHandlers(io, { serial }) {
  let sequenceControl = null;

  // --- serial manager -> state + broadcasts --------------------------------
  serial.on("connected", ({ fwId, hwId, hwVersion }) => {
    state.serial = {
      connected: true,
      fwId,
      hwId,
      fwVersion: FWVersionStrings[fwId] || `Unknown (ID ${fwId})`,
      hwVersion,
    };
    io.emit("status:update", statusSnapshot());
  });

  serial.on("disconnected", () => {
    state.serial.connected = false;
    io.emit("status:update", statusSnapshot());
  });

  serial.on("defaults", ({ r, g, b }) => {
    state.light.r = r;
    state.light.g = g;
    state.light.b = b;
    io.emit("light:defaults", { r, g, b });
  });

  serial.on("trim", (trim) => {
    state.trim = [...trim];
    io.emit("trim:values", [...trim]);
  });

  serial.on("telemetry", (update) => {
    Object.assign(state.telemetry, update); // broadcast happens on the 200 ms tick
  });

  serial.on("error", (err) => {
    console.error("[serial]", err.message);
    io.emit("system:error", { source: "serial", message: err.message });
  });

  // --- per-client handlers ---------------------------------------------------
  io.on("connection", (socket) => {
    // Snapshot so a late/reconnecting client sees the full current state.
    socket.emit("status:update", statusSnapshot());
    socket.emit("telemetry:update", { ...state.telemetry });
    socket.emit("light:state", lightStatePayload());
    socket.emit("light:defaults", {
      r: state.light.r,
      g: state.light.g,
      b: state.light.b,
    });
    socket.emit("trim:values", [...state.trim]);
    socket.emit("presets:list", presets.list());

    const fail = (source, message) => {
      console.warn(`[socket] ${source}: ${message}`);
      socket.emit("system:error", { source, message });
    };

    socket.on("light:update", (payload) => {
      try {
        if (state.sequence.running) {
          return fail("light", "sequence in progress — manual controls locked");
        }
        if (!state.serial.connected) return fail("light", "scanlight not connected");
        const { r, g, b, channels, saveFlag } = payload ?? {};
        if (!isByte(r) || !isByte(g) || !isByte(b) || !isChannelMask(channels)) {
          return fail("light", "invalid light:update payload");
        }
        state.light = { r, g, b, channels: [...channels] };
        serial
          .sendPacket(PKT_H2D_SET_COLOR, buildSetColorPayload(saveFlag === 1))
          .catch((err) => fail("light", err.message));
        io.emit("light:state", lightStatePayload());
      } catch (err) {
        fail("light", err.message);
      }
    });

    socket.on("trim:set", (trim) => {
      try {
        if (!state.serial.connected) return fail("trim", "scanlight not connected");
        if (state.serial.hwVersion !== HW_BSL1) {
          return fail("trim", "this hardware does not support brightness trimming");
        }
        if (
          !Array.isArray(trim) ||
          trim.length !== 4 ||
          !trim.every((t) => Number.isInteger(t) && t >= -127 && t <= 127)
        ) {
          return fail("trim", "invalid trim values (need 4 integers in -127..127)");
        }
        // SET_TRIM always writes device NVM — callers only send this on dialog OK.
        serial
          .sendPacket(
            PKT_H2D_SET_TRIM,
            trim.map((t) => t & 0xff)
          )
          .catch((err) => fail("trim", err.message));
        state.trim = [...trim];
        io.emit("trim:values", [...trim]);
      } catch (err) {
        fail("trim", err.message);
      }
    });

    socket.on("default:save", () => {
      if (!state.serial.connected) return fail("default", "scanlight not connected");
      // Matches original app: persist current R,G,B; white/IR off, save flag = 1.
      const { r, g, b } = state.light;
      serial
        .sendPacket(PKT_H2D_SET_COLOR, [r & 0xff, g & 0xff, b & 0xff, 0, 0, 1])
        .catch((err) => fail("default", err.message));
    });

    socket.on("default:load", () => {
      if (!state.serial.connected) return fail("default", "scanlight not connected");
      serial
        .sendPacket(PKT_H2D_GET_DEFAULT_RGB)
        .catch((err) => fail("default", err.message));
      // Response arrives async via the serial "defaults" event -> light:defaults.
    });

    socket.on("presets:create", (payload) => {
      try {
        io.emit("presets:list", presets.create(payload ?? {}));
      } catch (err) {
        fail("presets", err.message);
      }
    });

    socket.on("presets:rename", (payload) => {
      try {
        io.emit("presets:list", presets.rename(payload ?? {}));
      } catch (err) {
        fail("presets", err.message);
      }
    });

    socket.on("presets:delete", (payload) => {
      try {
        io.emit("presets:list", presets.remove(payload ?? {}));
      } catch (err) {
        fail("presets", err.message);
      }
    });

    socket.on("sequence:start", (payload) => {
      try {
        if (state.sequence.running) {
          return fail("sequence", "a sequence is already running");
        }
        if (!state.serial.connected) return fail("sequence", "scanlight not connected");
        if (!state.camera.connected) return fail("sequence", "camera not connected");
        const { sequence, keepLightOn } = payload ?? {};
        if (!Sequences[sequence]) return fail("sequence", `unknown sequence "${sequence}"`);
        const preDelay = clamp(
          Number(payload?.preDelay ?? SEQUENCE_PRE_DELAY_MIN_S),
          SEQUENCE_PRE_DELAY_MIN_S,
          SEQUENCE_PRE_DELAY_MAX_S
        );
        const postDelay = clamp(
          Number(payload?.postDelay ?? SEQUENCE_POST_DELAY_MIN_S),
          SEQUENCE_POST_DELAY_MIN_S,
          SEQUENCE_POST_DELAY_MAX_S
        );

        const control = { abortRequested: false };
        sequenceControl = control;
        Object.assign(state.sequence, {
          running: true,
          name: sequence,
          step: 0,
          total: Sequences[sequence].length,
          channelLabel: "",
          phase: "starting",
          abortRequested: false,
        });
        io.emit("status:update", statusSnapshot());
        io.emit("sequence:progress", { ...state.sequence });

        runSequence(
          { name: sequence, preDelay, postDelay, keepLightOn: keepLightOn === true },
          { serial },
          control,
          {
            progress: () => io.emit("sequence:progress", { ...state.sequence }),
            lightState: () => io.emit("light:state", lightStatePayload()),
          }
        )
          .then((result) => {
            state.sequence.running = false;
            state.sequence.phase = "";
            sequenceControl = null;
            io.emit("sequence:done", result);
            io.emit("status:update", statusSnapshot());
            if (!result.ok) {
              io.emit("system:error", {
                source: "sequence",
                message: result.aborted
                  ? "sequence aborted"
                  : `sequence failed: ${result.errors.join("; ")}`,
              });
            }
          })
          .catch((err) => {
            state.sequence.running = false;
            state.sequence.phase = "";
            sequenceControl = null;
            io.emit("sequence:done", {
              ok: false,
              aborted: false,
              errors: [err.message],
              captures: 0,
            });
            io.emit("status:update", statusSnapshot());
            fail("sequence", err.message);
          });
      } catch (err) {
        fail("sequence", err.message);
      }
    });

    socket.on("sequence:abort", () => {
      if (sequenceControl) {
        sequenceControl.abortRequested = true;
        state.sequence.abortRequested = true;
      }
    });

    socket.on("camera:test", () => {
      if (!state.camera.connected) return fail("camera", "camera not connected");
      if (camera.isBusy()) return fail("camera", "camera busy");
      camera
        .captureImage()
        .then(() => io.emit("camera:test:done", { ok: true }))
        .catch((err) => {
          io.emit("camera:test:done", { ok: false, message: err.message });
          fail("camera", err.message);
        });
    });

    socket.on("system:rescan", () => {
      serial.rescan();
      camera.detect().then((cam) => {
        state.camera = { connected: cam.connected, model: cam.model || "" };
        io.emit("status:update", statusSnapshot());
      });
    });
  });
}
