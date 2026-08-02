# Scanlight Web App (`automation/app_bsl`) — How It Works

> Reference documentation for the browser-based controller in the cloned
> [`jackw01/scanlight`](https://github.com/jackw01/scanlight) repo
> (local path: `scanlight/automation/app_bsl`).

## What it is
`app_bsl` ("scanlight control app v2.1") is the **current, unified web controller for all
Scanlight hardware** — scanlight v2/v3, scanlight v4a, scanlight v4b, and big scanlight v1 —
running the unified firmware (≥ v1.2). It is a **Vue 3 + Vite + Vuetify 3** single-page app
with no backend: it talks directly to the light's Raspberry Pi Pico over USB serial using the
browser's **Web Serial API** at **115200 baud**. Besides manual LED control and presets, it
provides **Automation**: timed multi-exposure scan sequences that switch the light between
color channels and trigger the camera shutter for each exposure.

The built app is checked in at `app_bsl/dist/` and hosted on GitHub Pages (the app's Info
card links to `https://jackw01.github.io/scanlight/big`).

### Key files
- `scanlight/automation/app_bsl/package.json` — name `big-scanlight-app`; Vue 3, Vuetify 3, Vite 7, webfontloader; `apexcharts` is a dependency but unused in the UI. Scripts: `dev`, `build`, `serve`/`preview`.
- `scanlight/automation/app_bsl/vite.config.js` — Vite + `@vitejs/plugin-vue` + `vite-plugin-vuetify` (auto-import); relative `base` in production so `dist/` can be hosted statically on GitHub Pages.
- `scanlight/automation/app_bsl/index.html` — Vite entry mounting `#app`.
- `scanlight/automation/app_bsl/src/main.js` — creates the Vue app, installs the Vuetify plugin, loads fonts, mounts `App.vue`.
- `scanlight/automation/app_bsl/src/App.vue` — thin shell: `<v-app><v-main><Main /></v-main></v-app>`.
- `scanlight/automation/app_bsl/src/config.js` — voltage/temperature thresholds, firmware & hardware version strings, and the scan **sequences**.
- `scanlight/automation/app_bsl/src/protocol.js` — singleton `Protocol` class: bidirectional packet framing, parser, and callback dispatch.
- `scanlight/automation/app_bsl/src/components/Main.vue` — the entire UI and app logic (~550 lines).
- `scanlight/automation/app_bsl/src/plugins/` — Vuetify + webfontloader setup.

Related repo files:
- `scanlight/automation/bsl_control_interface.md` — the authoritative host↔device protocol spec.
- `scanlight/automation/firmware_bsl1/` — unified firmware source (`main.c`, `protocol.c/h`, `config.h`).
- `scanlight/automation/*.uf2` — compiled firmware binaries per hardware (see table below).
- `scanlight/automation/autoflasher.py` — host-side flashing helper.

## Architecture at a glance
```
User (sliders / buttons / presets / Automation)
        │  Vue reactive state (RGB, enabledChannels, timing params)
        ▼
   Main.vue methods ──► protocol.sendPacket(header, data)
        ▲                       │  [254][header][len][data…]
        │  callbacks            ▼
        │               Web Serial API (navigator.serial)
        │                       │  USB CDC @ 115200 baud
        └───────────────┐       ▼
    telemetry/answers   └── Pico unified firmware ──► PWM LED drivers,
                     (LED temp, VBUS, FW version,      shutter + focus GPIO
                      default RGB, trim)
```

Unlike a send-only controller, this app is fully **bidirectional**: the device answers
queries and streams telemetry, and the UI state (sliders, trim values, warnings) is driven
by those responses.

## The serial protocol (`src/protocol.js`)
A `Protocol` class exported as a **singleton**. Packet format (both directions, per
`bsl_control_interface.md`):

| byte | meaning |
|---|---|
| 0 | start byte, always `254` (`0xFE`) |
| 1 | packet header |
| 2 | data length (may be 0 — then it is the last byte) |
| ≥ 3 | data |

Note: framing is **length-delimited** (parser computes `packetEnd = len + 2`); there is no
end byte. `PACKET_MAX_LENGTH` is 128; payloads are parsed with `DataView` (multi-byte fields
are little-endian integers).

**Host-to-device headers:**
```
PKT_H2D_SET_COLOR      = 0   // 6 bytes: R, G, B, White, IR, save-preset flag
PKT_H2D_GET_DEFAULT_RGB= 1   // 0 bytes
PKT_H2D_GET_FW_VERSION = 2   // 0 bytes
PKT_H2D_SHUTTER_PULSE  = 3   // 1 byte: pulse length in 10 ms units (1–255)
PKT_H2D_DFU_MODE       = 4   // 0 bytes: reboot into BOOTSEL/DFU mass-storage mode
PKT_H2D_SET_TRIM       = 5   // 4 bytes: R,G,B,W trim, int8 two's complement (−127…127)
PKT_H2D_GET_TRIM       = 6   // 0 bytes
PKT_H2D_SET_FOCUS      = 7   // 1 byte: focus signal state
```

**Device-to-host headers:**
```
PKT_D2H_ACK         = 0
PKT_D2H_LED_TEMP    = 1   // int32, LED temp in millidegrees C — auto-sent every 200 ms
PKT_D2H_VBUS        = 2   // int32, USB input voltage in mV — auto-sent every 200 ms
PKT_D2H_FW_VERSION  = 3   // uint32: low 16 bits = FW version ID, high 16 = HW version ID
PKT_D2H_DEFAULT_RGB = 4   // 3 bytes: R, G, B stored power-on defaults
PKT_D2H_TRIM        = 5   // 4 bytes: int8 trims
```

Methods: `connect()` (`requestPort()` → `open({baudRate: 115200})` → writer → `readUntilClosed()`
byte-by-byte parser → `handlePacket()` dispatch), `sendPacket(header, data)`,
`addCallback(header, cb)`.

## Connection handshake and telemetry (`Main.vue`)
1. **Connect** button → `protocol.connect()`, registers callbacks for `FW_VERSION`,
   `LED_TEMP`, `VBUS`, `DEFAULT_RGB`, `TRIM`, then sends `PKT_H2D_GET_FW_VERSION`.
   A 1.5 s timeout with no answer raises the "Connection Failed" alert.
2. `checkFWVersion` decodes the version word (`fw = word & 0xFFFF`, `hw = word >> 16`) and
   maps IDs through `config.FWVersionStrings` / `config.HWVersionStrings`. Hardware strings:
   `0 = big scanlight v1`, `1 = scanlight v4a`, `2 = scanlight v2/v3`, `3 = scanlight v4b`.
   If the firmware ID is older than `config.LatestFWVersionID`, a "Firmware Update
   Available" alert and an **Enter Firmware Update Mode** button appear (sends `PKT_H2D_DFU_MODE`).
   Then it requests `GET_DEFAULT_RGB` and `GET_TRIM`.
3. `updateRGB` fills the sliders from the device's stored defaults, sets `connected = true`,
   and pushes the current state back with `update()`.
4. Telemetry arrives every 200 ms: LED temperature (warning banner above 77 °C
   (`config.OverTemperatureThresholdMdegc`); the firmware itself shuts the LEDs off at 80 °C)
   and VBUS voltage. On hardware with an ADC, all control cards are disabled
   (`controlsDisabled`) until VBUS exceeds 4000 mV — the "Connect Power Cable" warning shows
   until then. Big scanlight v1 on a 5 V supply shows a reduced-brightness note (thresholds
   `USBVBUSThreshold5V`/`USBVBUSThreshold9V` in `config.js`).

## Hardware feature gating (computed properties)
Which UI features appear depends on the reported hardware version:

| capability | available on |
|---|---|
| ADC telemetry, white channel, shutter | all hardware **except** scanlight v2/v3 |
| focus signal control | scanlight v4b only |
| IR channel, brightness trimming | big scanlight v1 only |

## Manual control
- R, G, B number inputs (0–255) paired with color-matched sliders; number inputs send live
  (`@update:modelValue`), sliders send on release (`@end`).
- Channel-enable buttons call `setEnabledChannels([R,G,B,W,IR])`: **RGB** `[1,1,1,0,0]`,
  **WHITE** `[0,0,0,1,0]`, **OFF** all zeros, and individual **R / G / B / IR** buttons.
- `update()` builds `PKT_H2D_SET_COLOR`: `[r·enR, g·enG, b·enB, 255·enW, 255·enIR, 0]`
  (last byte = save-preset flag). The firmware validates input: it reduces maximum power
  when several channels run on an underpowered supply and prevents white/IR from running
  simultaneously with RGB.

## Presets and device-stored settings
- **Browser presets** — `localStorage` key `rgb_presets`, a JSON array of
  `{name, red, green, blue}`; Load / Create / Rename / Delete via `prompt()`/`confirm()`.
  Purely client-side.
- **Set as default** — confirmation dialog, then `PKT_H2D_SET_COLOR` with the save-preset
  flag set to 1: the device stores current RGB in nonvolatile memory and uses it at power-on
  or when running standalone (no computer attached). The app only sets this flag on explicit
  request because the NVM has finite write cycles.
- **Load default** — requests `GET_DEFAULT_RGB`; the response repopulates the sliders.
- **Brightness Trimming** (big scanlight v1 only) — per-channel R/G/B/W trim from −127 to
  +127 (−50 % to +50 % drive strength, balancing left vs. right LED driver halves); sent via
  `PKT_H2D_SET_TRIM` and auto-saved to device NVM.

## Automation (automated multi-exposure scan sequences)

### Purpose
Scanning color negative film with narrowband LEDs needs a separate camera exposure per color
channel (trichromatic scanning): light the film with pure red and shoot, then pure green and
shoot, then pure blue — optionally plus an IR exposure for dust/scratch removal. The
Automation card mechanizes the whole cycle: **switch the light to a channel, wait for
settling, pulse the camera's shutter release line, wait for the exposure to finish, move to
the next channel.**

### Controls (the "Automation" card)
Shown only when the hardware supports a shutter output (all hardware except scanlight v2/v3).

- **Pre-shutter Delay (s)** — 0.01–1.0 s. Pause after switching channels, before firing the
  shutter (lets the LEDs/camera settle).
- **Shutter Pulse Length (s)** — 0.01–0.5 s. How long the device holds the camera's shutter
  release line high. Converted to 10 ms units and clamped to 1–255 before sending.
- **Post-shutter Delay (s)** — 0.1–12.75 s. Pause after the pulse (exposure time plus camera
  write/busy time) before the next channel.
- **Keep light on** — leave the light on (white) after the sequence instead of turning off.
- **Send focus signal** (scanlight v4b only) — assert the camera focus line (half-press)
  during the sequence; some cameras need this to release the shutter.
- Buttons: **Auto R,G,B**, **Auto R,G,B,IR**, **Auto RGB,IR**, **Auto W,IR** (IR variants
  only on big scanlight v1), **Test Shutter** (one pulse at the configured length),
  **Test Focus** (hold-to-assert).

### Scan sequences (`config.js`)
Each sequence is an ordered list of 5-channel enable masks `[R, G, B, White, IR]`. At each
step the mask multiplies the current RGB brightness (white/IR run at full 255):

| Sequence | Steps | Use |
|---|---|---|
| `SequenceRGB` | R `[1,0,0,0,0]`, G `[0,1,0,0,0]`, B `[0,0,1,0,0]` | Standard trichromatic scan (3 exposures) |
| `SequenceRGBIR` | R, G, B, IR `[0,0,0,0,1]` | Trichromatic + IR for dust/scratch removal |
| `SequenceNWIR` | RGB-on `[1,1,1,0,0]`, IR | Normal white + IR (2 exposures, B&W-style) |
| `SequenceBWIR` | White `[0,0,0,1,0]`, IR | Broadband white LED + IR |

### `runSequence()` — the automation loop, step by step
For each step `i` of the chosen sequence:

1. **Set the light**: `enabledChannels = config[sequence][i]`, then `update()` sends
   `PKT_H2D_SET_COLOR` so the firmware switches the LED drivers to that channel mix.
2. **Optionally half-press**: if "Send focus signal" is checked, send `PKT_H2D_SET_FOCUS`
   with data `[1]`.
3. **Wait** `preShutterDelay` seconds (`setTimeout`-based promise).
4. **Fire the shutter**: send `PKT_H2D_SHUTTER_PULSE` with the pulse length in 10 ms units.
   The **device firmware** drives the shutter GPIO for exactly that long — pulse *width*
   timing is the firmware's job.
5. **Wait** `shutterPulseLength + postShutterDelay` seconds, then loop to the next channel.

After the last step: if "Keep light on" is checked, set the light to white (or the white
channel for `SequenceBWIR`); otherwise all channels off. Then release focus
(`PKT_H2D_SET_FOCUS` data `[0]`).

**Division of timing responsibility** (per the protocol doc): the firmware times each
shutter pulse; **the application software is responsible for the timing between pulses**.
Practical camera limits noted there: Fujifilm mirrorless bodies need ≈300 ms minimum pulse
and ≈1000 ms minimum interval in single-shot drive mode — faster scanning requires the
camera in bracketing or continuous drive mode.

## Device side (firmware and flashing)
- Unified firmware source: `scanlight/automation/firmware_bsl1/` (`main.c`, `protocol.c/h`,
  `config.h`); hardware variant selected by compile-time flags / `FW_VERSION_ID`.
  Checked-in `.uf2` binaries per hardware (`automation/README.md`):

  | hardware | HW version ID | firmware binary |
  |---|---|---|
  | scanlight v2/v3 | 2 | `sl2_controller_*` |
  | scanlight v4, 26a901a PCB | 1 | `sl4a_controller_*` |
  | scanlight v4, 26a901b PCB (focus) | 3 | `sl4b_controller_*` |
  | big scanlight | 0 | `bsl1_controller_*` |

- LED drive: hardware PWM (~120 kHz); `SET_COLOR` bytes become duty cycles
  (`level = pwm_wrap × value / 255`). Shutter/focus are GPIO outputs; `PKT_H2D_DFU_MODE`
  reboots the Pico into BOOTSEL mass-storage mode so reflashing needs no physical BOOTSEL press.
- `autoflasher.py` — host helper: `python3 autoflasher.py <firmware.uf2>` polls for a mounted
  volume named `RPI-RP2` (Windows/macOS/Linux mount-table implementations included) and
  auto-copies the `.uf2` onto it whenever a Pico in DFU mode appears. Combined with
  `DFU_MODE` packets, this enables a fully hands-off flash loop.

## Build, run, hosting
- `npm run dev` — Vite dev server (base `/`).
- `npm run build` — produces `dist/` with relative asset paths (`base: "./"`); the built
  bundle is checked in and served from GitHub Pages.
- Requires a Chromium-based browser (Chrome/Edge/Opera) — `navigator.serial` (Web Serial)
  is unsupported in Firefox/Safari — and a secure context (HTTPS or localhost).

## Run it locally
```bash
cd scanlight/automation/app_bsl
npm install
npm run dev        # open the printed URL in Chrome/Edge, then click Connect with a Pico attached
```

## Summary in one sentence
`app_bsl` is a static Vuetify control panel that connects to any Scanlight Pico over the Web
Serial API at 115200 baud using a length-delimited `[254][header][len][data…]` bidirectional
protocol, providing manual RGB/white/IR control, browser and device-stored presets, channel
trimming, live telemetry, and — its headline feature — one-click automated R/G/B(/IR)
multi-exposure scan sequences that interleave `SET_COLOR` and `SHUTTER_PULSE` packets with
configurable delays to drive the whole camera cycle.
