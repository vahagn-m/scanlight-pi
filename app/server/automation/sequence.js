// Server-side automation engine: multi-exposure scan sequences.
// Per step: switch light channel (SET_COLOR) -> pre-capture delay ->
// gphoto2 capture (verified; retried 3x with backoff) -> post-capture delay.
// All timing lives here; the browser only starts/aborts and shows progress.

import {
  Sequences,
  channelLabel,
  CAPTURE_RETRIES,
  CAPTURE_BACKOFF_MS,
} from "../config.js";
import { PKT_H2D_SET_COLOR } from "../protocol/constants.js";
import * as camera from "../camera/gphoto2.js";
import { state } from "../state.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Sleep in 100 ms slices so an abort request interrupts delays promptly. */
async function waitSeconds(seconds, control) {
  const total = Math.round(seconds * 1000);
  for (let t = 0; t < total; t += 100) {
    if (control.abortRequested) return;
    await sleep(Math.min(100, total - t));
  }
}

function setColorPayload(mask) {
  const { r, g, b } = state.light;
  return [
    (r * mask[0]) & 0xff,
    (g * mask[1]) & 0xff,
    (b * mask[2]) & 0xff,
    (255 * mask[3]) & 0xff,
    (255 * mask[4]) & 0xff,
    0, // save-preset flag: never persist during sequences (NVM wear)
  ];
}

/**
 * @param {{name: string, preDelay: number, postDelay: number, keepLightOn: boolean}} opts
 * @param {{serial: import("../serial/manager.js").SerialManager}} deps
 * @param {{abortRequested: boolean}} control Set abortRequested to stop after the current phase.
 * @param {{progress: () => void, lightState: () => void}} emit
 * @returns {Promise<{ok: boolean, aborted: boolean, errors: string[], warnings: string[], captures: number}>}
 */
export async function runSequence(opts, deps, control, emit) {
  const { name, preDelay, postDelay, keepLightOn } = opts;
  const { serial } = deps;
  const steps = Sequences[name];
  const errors = []; // fatal: channel never captured
  const warnings = []; // recovered: capture succeeded after failed attempts
  let captures = 0;

  const sendColor = async (mask) => {
    state.light.channels = [...mask];
    await serial.sendPacket(PKT_H2D_SET_COLOR, setColorPayload(mask));
    emit.lightState();
  };

  try {
    for (let i = 0; i < steps.length; i++) {
      if (control.abortRequested) break;
      if (!serial.isConnected()) throw new Error("serial disconnected during sequence");

      const mask = steps[i];
      const label = channelLabel(mask);
      Object.assign(state.sequence, {
        step: i + 1,
        total: steps.length,
        channelLabel: label,
      });

      state.sequence.phase = "setting";
      emit.progress();
      await sendColor(mask);

      state.sequence.phase = "preDelay";
      emit.progress();
      await waitSeconds(preDelay, control);
      if (control.abortRequested) break;

      state.sequence.phase = "capture";
      emit.progress();
      let captured = false;
      const attemptErrors = [];
      for (let attempt = 0; attempt < CAPTURE_RETRIES; attempt++) {
        if (control.abortRequested) break;
        try {
          await camera.captureImage({ shouldAbort: () => control.abortRequested });
          captured = true;
          captures++;
          if (attemptErrors.length) {
            warnings.push(
              `channel ${label}: captured on attempt ${attempt + 1} (${attemptErrors.join("; ")})`
            );
          }
          break;
        } catch (err) {
          attemptErrors.push(`channel ${label}, attempt ${attempt + 1}: ${err.message}`);
          if (attempt < CAPTURE_RETRIES - 1) {
            await waitSeconds((CAPTURE_BACKOFF_MS[attempt] ?? 1000) / 1000, control);
          }
        }
      }
      if (control.abortRequested) break;
      if (!captured) {
        errors.push(...attemptErrors);
        throw new Error(`capture failed on channel ${label} after ${CAPTURE_RETRIES} attempts`);
      }

      state.sequence.phase = "postDelay";
      emit.progress();
      await waitSeconds(postDelay, control);
    }
  } catch (err) {
    errors.push(err.message);
  }

  // End state: light off on abort/failure; otherwise per "keep light on".
  const failed = control.abortRequested || errors.length > 0;
  let endMask;
  if (!failed && keepLightOn) {
    endMask = name === "BWIR" ? [0, 0, 0, 1, 0] : [1, 1, 1, 0, 0];
  } else {
    endMask = [0, 0, 0, 0, 0];
  }
  try {
    if (serial.isConnected()) {
      await sendColor(endMask);
    }
  } catch (err) {
    errors.push(`end-state light command failed: ${err.message}`);
  }

  return {
    ok: !failed,
    aborted: control.abortRequested,
    errors,
    warnings,
    captures,
  };
}
