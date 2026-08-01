# Project: scanlight-pi

Working folder for the [Scanlight](https://github.com/jackw01/scanlight) film-scanning
light-source project (open hardware for scanning color negative film with narrowband RGB LEDs).

## Layout
- `scanlight/` — **git submodule** pinned to `https://github.com/jackw01/scanlight.git`
  (upstream repo; keep it clean — put project notes/docs at this root, not inside the clone).
  After a fresh clone of this project, run `git submodule update --init` to populate it.
- `scanlight_web_app_readme.md` — **how the `scanlight/automation/app_sl2` web app works**
  (Vue 3 + Vite + Vuetify control panel that drives the Pi Pico over the Web Serial API at
  115200 baud using a `[254][cmd][len][r][g][b][255]` framed packet protocol). Read this first
  for any work touching the web app or the host↔device serial protocol.

## Notes
- The web app requires a Chromium browser (Web Serial API) and HTTPS/localhost.
- Firmware target is a Raspberry Pi Pico; flashed via BOOTSEL/DFU mass-storage (`.uf2`).
