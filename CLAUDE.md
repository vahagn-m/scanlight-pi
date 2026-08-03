# Project: scanlight-pi

Working folder for the [Scanlight](https://github.com/jackw01/scanlight) film-scanning
light-source project (open hardware for scanning color negative film with narrowband RGB LEDs).

## Layout
- `scanlight/` — **git submodule** pinned to `https://github.com/jackw01/scanlight.git`
  (upstream repo; keep it clean — put project notes/docs at this root, not inside the clone).
  After a fresh clone of this project, run `git submodule update --init` to populate it.
- `scanlight_web_app_readme.md` — **how the `scanlight/automation/app_bsl` web app works**
  (Vue 3 + Vite + Vuetify control panel that drives the Pi Pico over the Web Serial API at
  115200 baud using a length-delimited `[254][header][len][data…]` bidirectional packet
  protocol — manual RGB/white/IR control, presets, trimming, telemetry, and the
  **Automation** feature: one-click multi-exposure scan sequences interleaving `SET_COLOR`
  and `SHUTTER_PULSE` packets). Read this first for any work touching the web app or the
  host↔device serial protocol. Authoritative protocol spec:
  `scanlight/automation/bsl_control_interface.md`.

## Notes
- The web app requires a Chromium browser (Web Serial API) and HTTPS/localhost.
- Firmware target is a Raspberry Pi Pico; flashed via BOOTSEL/DFU mass-storage (`.uf2`).

## 1. Project Overview & Tech Stack
This is a **Node.js** application that bridges client interfaces with physical hardware peripherals (camera and serial devices).

* **Runtime Engine:** Node.js (v18+)
* **Real-time WebSockets:** Socket.io
* **Serial Communication:** `serialport` (Node SerialPort library)
* **Camera Control:** `gphoto2` CLI invoked via Node `child_process` (`spawn` / `execFile`)

---

## 2. Common Dev Commands
* **Install Dependencies:** `npm install`
* **Development Server:** `npm run dev`
* **Production Start:** `npm start`
* **Run Tests:** `npm test`
* **Linting:** `npm run lint`

---

## 3. Critical Architecture & Hardware Rules

### 📷 gphoto2 (Child Process Management)
* **Never use raw string concatenation:** Always execute `gphoto2` using `execFile` or `spawn` with argument arrays to prevent command-injection vulnerabilities.
* **Process Timeouts:** Wrap every `gphoto2` process with an explicit timeout (e.g., 10–15s). Kill hung processes cleanly using `SIGTERM` followed by `SIGKILL`.
* **Handle Device Locks:** OS-level automount services (e.g., Linux `gvfs-gphoto2-volume-monitor` or macOS PTP daemons) often lock USB camera interfaces. Always check standard error (`stderr`) for camera-busy error codes (e.g., `-1: Unspecified error`, focus failed).
* **Temp File Cleanup:** Save captured images/files to a dedicated temporary directory (e.g., `/tmp` or `./storage/temp`) and ensure they are cleaned up after processing or streaming.

### 🔌 SerialPort Management
* **Resilient Lifecycle:** Never assume a serial port is permanently connected at boot. Implement connection retry loops and handle port disconnection events (`port.on('close')`, `port.on('error')`).
* **Stream Parsing:** Do not consume unbuffered raw `Buffer` streams directly from `port.on('data')`. Always use standard parsers (e.g., `@serialport/parser-readline` or `ByteLengthParser`).
* **Graceful Process Exit:** Close all active `SerialPort` connections on process shutdown signals (`SIGINT`, `SIGTERM`, `uncaughtException`) to avoid leaving OS system ports locked for subsequent runs.

### ⚡ Socket.io Conventions
* **Event Namespacing:** Use standard colon-delimited event names: `domain:action` or `hardware:domain:action` (e.g., `camera:capture`, `camera:ready`, `serial:write`, `serial:received`, `system:error`).
* **Hardware State Broadcasting:** Emit system state updates (`status:update`) to clients whenever hardware disconnects, reconnects, or errors out.
* **Listener Hygiene:** Always clean up Socket.io event listeners (`socket.off(...)` / `socket.removeAllListeners()`) during client disconnect or socket teardown to prevent memory leaks.

---

## 4. Error Handling & Coding Guidelines
* **Do Not Crash the Loop:** Hardware failures (camera focus error, unplugged USB) must **never** crash the main Node.js event loop. Catch hardware exceptions, log them with context, and relay error messages over Socket.io.
* **Async/Await:** Prefer `async/await` wrapped in explicit `try...catch` blocks over raw promise chains for hardware wrappers.
* **Idempotent Teardowns:** Cleanup and initialization procedures for hardware must be safe to execute multiple times sequentially.

---

## 5. Build Before Push (web app)
* `app/web/dist/` is checked into git — the Raspberry Pi Zero deployment pulls
  pre-built assets instead of building (see commit `0286d51`).
* Any change affecting the frontend bundle (`app/web/**`, `app/vite.config.js`,
  frontend dependencies) MUST be rebuilt and the new `dist/` committed before pushing:

  ```bash
  cd app && npm run build
  git add app/web/dist
  ```

* Pushing frontend changes without the rebuilt `dist/` leaves the deployed app
  serving a stale UI.
