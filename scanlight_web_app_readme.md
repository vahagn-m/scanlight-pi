# Scanlight `automation/app_sl2` Web App — How It Works

> Reference documentation for the browser-based controller in the cloned
> [`jackw01/scanlight`](https://github.com/jackw01/scanlight) repo
> (local path: `scanlight/automation/app_sl2`).

## What it is
`app_sl2` is a **browser-based controller for the "Scanlight" film-scanning light source**
(the repo is open hardware for scanning color negative film with narrowband RGB LEDs).
It is a **Vue 3 + Vite + Vuetify 3** single-page app whose real purpose is to act as a
**remote control over USB serial** for the light's microcontroller (a Raspberry Pi Pico,
per the firmware note in the UI). It does not talk to a backend server — it talks directly
to hardware through the browser's **Web Serial API**.

### Key files
- `scanlight/automation/app_sl2/package.json` — Vue 3, Vuetify 3, Vite 7, apexcharts (chart lib, present but not used in the main UI), webfontloader. Scripts: `dev`, `build`, `serve`/`preview`.
- `scanlight/automation/app_sl2/vite.config.js` — Vite + `@vitejs/plugin-vue` + `vite-plugin-vuetify` (auto-import); relative `base` in production so the built `dist/` can be hosted on GitHub Pages.
- `scanlight/automation/app_sl2/index.html` — Vite entry mounting `#app`.
- `scanlight/automation/app_sl2/src/main.js` — creates the Vue app, installs the Vuetify plugin, loads fonts, mounts `App.vue`.
- `scanlight/automation/app_sl2/src/App.vue` — thin shell: `<v-app><v-main><Main /></v-main></v-app>`.
- `scanlight/automation/app_sl2/src/components/Main.vue` — the entire UI and app logic.
- `scanlight/automation/app_sl2/src/serial.js` — the Web Serial driver (a singleton class instance).
- `scanlight/automation/app_sl2/src/plugins/` — Vuetify + webfontloader setup.

## Architecture at a glance
```
User (sliders/buttons/presets)
        │  Vue reactive state (red/green/blue %, scaling[])
        ▼
   Main.vue  ──update()──►  serial.setColor(r,g,b)
                                 │  builds a binary packet
                                 ▼
                        Web Serial API (navigator.serial)
                                 │  USB CDC @ 115200 baud
                                 ▼
                  Pi Pico firmware → drives RGB LED array
```

## The serial protocol (`src/serial.js`)
A `SerialInterface` class is exported as a **singleton**. It implements a small framed
binary protocol shared with the firmware:

- **Frame format (host → device):** `[254][cmdType][length][...payload][255]`
  - `254` = start byte, `255` = end byte.
  - `cmdType`: `set = 0`, `reset = 1`.
  - `length`: number of payload bytes.
- **`connect(baudRate)`** — `navigator.serial.requestPort()` (browser shows a port picker),
  opens at the given baud (the UI uses **115200**), grabs a writer, and starts `readUntilClosed()`.
- **`setColor(r, g, b)`** — sends `[254, 0(set), 3, r, g, b, 255]` with each channel masked to a byte.
- **`sendCommand(command)`** — sends a zero-length command frame (e.g. reset).
- **Inbound parsing (`readUntilClosed`)** — a byte-by-byte state machine (`packetIndex`)
  reassembles frames: wait for start byte, read a type byte, read 4 data bytes, expect the end
  byte, then `handlePacket()` dispatches to a registered callback keyed by packet type
  (`addCallback(type, cb)`). In the current UI no callbacks are registered and `messageTypes`
  is empty, so inbound data is effectively scaffolded but unused — the app is send-only today.
- It also registers `connect`/`disconnect` listeners on `navigator.serial` (logging only).

## The UI and logic (`src/components/Main.vue`)
Two-column Vuetify layout.

**Left column**
- *Scanlight card* — a **Connect** button. `connect()` opens the serial port at 115200,
  sets `connected = true` (disabling the button), resets R/G/B to 100% and scaling to
  `[1,1,1]`, and calls `update()` to push that state to the device.
- *Manual Control card* — for each of R, G, B there is a number input (0–100) **and** a
  color-matched slider bound to the same value. Editing the number input fires
  `@update:modelValue="update"` (live), while the slider fires `@end="update"` (on release).
  Below are 8 quick-select buttons that call `setScaling([...])`:
  - Row 1: R `[1,0,0]`, G `[0,1,0]`, B `[0,0,1]`, white/power `⏽ [1,1,1]`
  - Row 2: C `[0,1,1]`, M `[1,0,1]`, Y `[1,1,0]`, off `◯ [0,0,0]`
  These scaling vectors multiply the brightness percentages to isolate/add color channels —
  useful for the film-scanning workflow (exposing through individual color channels).

**The math — `update()`:**
```
new_r = red   * scaling[0] * 255 / 100
new_g = green * scaling[1] * 255 / 100
new_b = blue  * scaling[2] * 255 / 100
serial.setColor(new_r, new_g, new_b)
```
So brightness % × channel scaling → 8-bit value sent to the device.

**Right column**
- *Presets card* — a `v-select` of preset names plus Load / Create / Rename / Delete buttons.
  Presets are **stored in `localStorage` under the key `rgb_presets`** as a JSON array of
  `{name, red, green, blue}`. `loadPresetsFromStorage()` runs on `mounted()`. Create/Rename
  use `prompt()`, Delete uses `confirm()`. Loading a preset restores R/G/B and calls `update()`.
  (Presets are purely client-side; they are not written to the device.)
- *Info card* — static note (dated July 2026) explaining that the v4/"big" scanlight firmware
  and web app now also support v2/v3, with links to download the `.uf2` firmware and to the
  hosted `app_bsl` build, plus instructions to flash the Pi Pico via BOOTSEL/DFU mass-storage mode.

## How it's built/served
- `npm run dev` — Vite dev server (base `/`).
- `npm run build` — produces `dist/` with relative asset paths (`base: "./"`) so it can be
  opened/hosted statically (GitHub Pages), which matters because Web Serial only works over
  HTTPS or localhost.
- Requires a Chromium-based browser (Chrome/Edge/Opera) since `navigator.serial` (Web Serial)
  is not supported in Firefox/Safari.

## Summary in one sentence
`app_sl2` is a static Vuetify control panel that connects to the Scanlight's Pi Pico over the
Web Serial API at 115200 baud and lets the user set RGB LED brightness via sliders/presets,
translating each change into a framed `[254][cmd][len][r][g][b][255]` binary packet sent to
the firmware.

## Run it locally
```bash
cd scanlight/automation/app_sl2
npm install
npm run dev        # open the printed URL in Chrome/Edge, then click Connect with a Pico attached
```
