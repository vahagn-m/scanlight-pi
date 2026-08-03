// Server entry: Express (static UI) + Socket.io + hardware lifecycle.
// Env: PORT (default 3000), HOST (default 0.0.0.0), MOCK_SERIAL=1, MOCK_CAMERA=1.

import express from "express";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import { SerialManager } from "./serial/manager.js";
import * as camera from "./camera/gphoto2.js";
import * as presets from "./presets/store.js";
import { state, statusSnapshot } from "./state.js";
import { registerSocketHandlers } from "./sockets.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 3000);
const WEB_DIST = path.resolve(HERE, "../web/dist");

const TELEMETRY_TICK_MS = 200;
const CAMERA_REDETECT_MS = 10000;

async function main() {
  await presets.load();

  const app = express();
  const server = http.createServer(app);
  const io = new Server(server);

  if (fs.existsSync(WEB_DIST)) {
    app.use(express.static(WEB_DIST));
    app.get("*", (_req, res) => res.sendFile(path.join(WEB_DIST, "index.html")));
  } else {
    app.get("/", (_req, res) =>
      res
        .status(503)
        .send("web build not found — run `npm run build`, or use `npm run dev` during development")
    );
  }

  const serial = new SerialManager();
  registerSocketHandlers(io, { serial });

  // Telemetry broadcast: 5 Hz max, only when values changed.
  let lastTemp = null;
  let lastVbus = null;
  const telemetryTimer = setInterval(() => {
    const { ledTempMdegc, vbusMv } = state.telemetry;
    if (
      state.serial.connected &&
      (ledTempMdegc !== lastTemp || vbusMv !== lastVbus)
    ) {
      lastTemp = ledTempMdegc;
      lastVbus = vbusMv;
      io.emit("telemetry:update", { ledTempMdegc, vbusMv });
    }
  }, TELEMETRY_TICK_MS);

  // Camera presence: detect at boot, re-detect periodically while absent.
  const refreshCamera = async () => {
    const cam = await camera.detect();
    state.camera = { connected: cam.connected, model: cam.model || "" };
    io.emit("status:update", statusSnapshot());
  };
  await refreshCamera();
  const cameraTimer = setInterval(() => {
    if (!state.camera.connected) refreshCamera();
  }, CAMERA_REDETECT_MS);

  await serial.start();

  server.listen(PORT, HOST, () => {
    console.log(`scanlight-pi app listening on http://${HOST}:${PORT}`);
    if (process.env.MOCK_SERIAL === "1") console.log("(MOCK_SERIAL: emulated Pico)");
    if (process.env.MOCK_CAMERA === "1") console.log("(MOCK_CAMERA: emulated camera)");
  });

  // Graceful shutdown: close the serial port so the OS never holds it locked.
  let shuttingDown = false;
  const shutdown = async (reason) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${reason}: shutting down...`);
    clearInterval(telemetryTimer);
    clearInterval(cameraTimer);
    try {
      await serial.close();
    } catch (err) {
      console.error("serial close failed:", err.message);
    }
    try {
      camera.close(); // kill the persistent gphoto2 --shell session
    } catch (err) {
      console.error("camera close failed:", err.message);
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("uncaughtException", (err) => {
    console.error("uncaughtException:", err);
    shutdown("uncaughtException");
  });
  process.on("unhandledRejection", (err) => {
    console.error("unhandledRejection:", err);
  });
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
