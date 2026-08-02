import { io } from "socket.io-client";

// Single connection to the server that serves this page (dev: Vite proxy).
export const socket = io({
  reconnectionDelayMax: 5000,
});
