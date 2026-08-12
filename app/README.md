# scanlight-pi app

Hosted web controller for the [Scanlight](https://github.com/jackw01/scanlight)
film-scanning light, designed to run on a Linux device (e.g. a Raspberry Pi)
with the Scanlight **and** the camera attached to it over USB.

- **Node server** owns all hardware I/O:
  - USB serial (115200 baud) to the Scanlight Pico, using the same
    `[0xFE][header][len][data…]` packet protocol as the original app
    (spec: `scanlight/automation/bsl_control_interface.md`).
  - Camera shutter via the `gphoto2` CLI, inside a **persistent
    `gphoto2 --shell` session** (warm PTP connection — no per-capture USB
    re-init). Default trigger: the first `eosremoterelease` value the
    installed gphoto2 accepts — auto-detected from the widget's choices,
    because the accepted labels differ across libgphoto2 builds and some
    builds silently ignore invalid values. Override via
    `GPHOTO2_SHUTTER_COMMAND`.
    Trigger only — images stay on the camera card. Each capture is verified;
    failures retry 3× then abort the scan sequence and turn the light off.
- **Vue 3 + Vuetify 3 UI** (a port of the original `app_bsl`) talks to the
  server over **Socket.io**. Any browser on the LAN can connect — no Web
  Serial, no Chromium requirement.

Features: manual R/G/B control (sliders + channel buttons), white/IR channels
(per hardware), server-shared RGB presets, device-stored defaults, brightness
trimming (big scanlight v1), live telemetry with temperature/power warnings,
and one-click automated **R/G/B(/IR/W) multi-exposure scan sequences** with
configurable pre/post-capture delays, live progress, and abort.

Differences from the original browser app:
- The Pico's shutter/focus GPIO outputs are **not used** — the camera is
  triggered host-side via gphoto2.
- No firmware-update UI (DFU). Flashing is handled out of band.
- Automation timing runs server-side; closing the browser tab does not
  interrupt a scan.

## Requirements

- Node.js ≥ 18
- `gphoto2` installed and the camera supported (`apt install gphoto2`)
- Linux: serial port access — add your user to the `dialout` group:
  ```bash
  sudo usermod -aG dialout $USER   # then log out/in
  ```
- Linux desktops: disable camera automount daemons or they will lock the
  camera USB interface and captures will fail with "Unspecified error":
  ```bash
  systemctl --user mask gvfs-gphoto2-volume-monitor
  ```

## Install & run

```bash
cd app
npm install
npm run build          # builds web/ -> web/dist
npm start              # serves UI + Socket.io on http://0.0.0.0:3000
```

Development (hot reload, server + Vite together):

```bash
npm run dev            # server on :3000, Vite on :5173 (proxies Socket.io)
```

Open the printed URL in any browser.

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP/Socket.io port |
| `HOST` | `0.0.0.0` | Listen address (no auth — keep to trusted LANs) |
| `GPHOTO2_BIN` | `gphoto2` | gphoto2 executable/path |
| `GPHOTO2_SHUTTER_COMMAND` | auto-detected `eosremoterelease` value | Shell command that fires the shutter (e.g. `capture-image` for non-Canon cameras) |
| `MOCK_SERIAL=1` | — | Emulated Pico (no hardware needed) |
| `MOCK_CAMERA=1` | — | Emulated camera (add `MOCK_CAMERA_FAIL=1` to force capture failures) |

## Deployment (systemd example)

```ini
# /etc/systemd/system/scanlight-pi.service
[Unit]
Description=Scanlight Pi controller
After=network.target

[Service]
WorkingDirectory=/home/pi/scanlight-pi/app
ExecStart=/usr/bin/node server/index.js
Restart=always
User=pi
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
```

## Troubleshooting

- **Scanlight disconnected chip / `EACCES` on open** — serial permissions;
  see the `dialout` note above.
- **Camera busy / `-1: Unspecified error` / `Could not claim the USB device`** —
  another process (gvfs, PTP daemon) holds the camera; disable automount
  daemons or replug the camera. On macOS the system `ptpcamerad` claims the
  camera (`sudo pkill -9 ptpcamerad` to test; it respawns) — the app targets
  Linux, where disabling gvfs-gphoto2-volume-monitor is enough.
- **Other gphoto2 tools fail while the server runs** — by design: the
  persistent shell session holds the camera USB lock for fast triggering.
  Stop the service to use another tool.
- **Capture timeouts** — some cameras need longer; the per-capture timeout is
  15 s (`GPHOTO2_TIMEOUT_MS` in `server/config.js`).

## Layout

```
server/            Node server (Express + Socket.io)
  protocol/        packet framer + byte-level parser (see constants.js)
  serial/          Pico auto-detect/handshake/hotplug + mock
  camera/          gphoto2 wrapper (timeouts, mutex, busy detection)
  automation/      server-side scan sequence engine
  presets/         server-side preset store (data/presets.json)
web/               Vue 3 + Vuetify UI (Vite build -> web/dist)
```
