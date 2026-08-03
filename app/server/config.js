// Central configuration: thresholds, version strings, scan sequences, timing.
// Ported from scanlight/automation/app_bsl/src/config.js with host-side additions.

// --- Serial / host-side timing -------------------------------------------
export const SERIAL_VID = "2e8a"; // Raspberry Pi (Pico RP2040 USB CDC). SerialPort reports lowercase.
export const BAUD_RATE = 115200; // Mandatory open arg; USB CDC ignores the actual rate.
export const HANDSHAKE_TIMEOUT_MS = 1500; // Per GET_* request. Covers the ~600 ms power-on self-test.
export const HANDSHAKE_RETRIES = 3;
export const RECONNECT_POLL_MS = 2000; // Port re-enumeration cadence when disconnected.
export const RECONNECT_MAX_BACKOFF_MS = 10000;

// --- Camera (gphoto2) ------------------------------------------------------
export const GPHOTO2_BIN = process.env.GPHOTO2_BIN || "gphoto2";
export const GPHOTO2_DETECT_TIMEOUT_MS = 10000; // Per-process --auto-detect (enumerate-only, no USB claim).
export const GPHOTO2_KILL_GRACE_MS = 2000; // SIGTERM -> wait -> SIGKILL.
// Persistent `gphoto2 --shell` session (warm PTP connection, fast triggers):
export const GPHOTO2_SHELL_READY_MS = 10000; // Wait for the first shell prompt after spawn.
export const GPHOTO2_SHELL_CMD_MS = 10000; // Generic shell command round-trip timeout.
export const GPHOTO2_CAPTURE_CMD_MS = 15000; // Shutter command round-trip timeout.
export const GPHOTO2_RESTART_BACKOFF_MS = 2000; // Respawn backoff after session death.
export const GPHOTO2_RESTART_MAX_BACKOFF_MS = 10000;
// Shutter trigger issued inside the shell. Canon EOS fastest path; override for
// other cameras, e.g. GPHOTO2_SHUTTER_COMMAND="capture-image".
export const SHUTTER_COMMAND =
  process.env.GPHOTO2_SHUTTER_COMMAND || "set-config eosremoterelease=Immediate";

// --- Automation ------------------------------------------------------------
export const CAPTURE_RETRIES = 3; // Attempts per channel before aborting the sequence.
export const CAPTURE_BACKOFF_MS = [1000, 2000, 4000]; // Delay before retry 1/2/3.
export const SEQUENCE_PRE_DELAY_MIN_S = 0.01;
export const SEQUENCE_PRE_DELAY_MAX_S = 1.0;
export const SEQUENCE_POST_DELAY_MIN_S = 0.1;
export const SEQUENCE_POST_DELAY_MAX_S = 12.75;

// --- Device thresholds (from the original app config) -----------------------
export const USBVBUSThreshold5V = 4000; // mV: below this the controls stay disabled ("Connect Power Cable").
export const USBVBUSThreshold9V = 8000; // mV: above this big scanlight v1 runs at full power.
export const OverTemperatureThresholdMdegc = 77000; // UI warning; firmware itself shuts off at 80000.

// --- Version ID -> display string ------------------------------------------
export const FWVersionStrings = {
  0: "v1.0.0",
  1: "v1.1.0",
  2: "v1.2.0",
};

export const HWVersionStrings = {
  0: "big scanlight v1",
  1: "scanlight v4a",
  2: "scanlight v2/v3",
  3: "scanlight v4b",
};

// --- Scan sequences ----------------------------------------------------------
// Each step is a 5-element channel enable mask: [R, G, B, White, IR].
export const Sequences = {
  RGB: [
    [1, 0, 0, 0, 0],
    [0, 1, 0, 0, 0],
    [0, 0, 1, 0, 0],
  ],
  RGBIR: [
    [1, 0, 0, 0, 0],
    [0, 1, 0, 0, 0],
    [0, 0, 1, 0, 0],
    [0, 0, 0, 0, 1],
  ],
  NWIR: [
    [1, 1, 1, 0, 0],
    [0, 0, 0, 0, 1],
  ],
  BWIR: [
    [0, 0, 0, 1, 0],
    [0, 0, 0, 0, 1],
  ],
};

// Human-readable label for a channel mask (used in sequence progress UI).
export function channelLabel(mask) {
  const key = mask.join("");
  const labels = {
    "10000": "R",
    "01000": "G",
    "00100": "B",
    "00010": "W",
    "00001": "IR",
    "11100": "RGB",
  };
  return labels[key] || "?";
}
