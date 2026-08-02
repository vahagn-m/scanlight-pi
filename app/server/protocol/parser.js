// Byte-level packet parser for the Scanlight protocol.
// Feed raw serial chunks via feed(); complete packets are emitted as
// "packet" events with (header, Buffer).
//
// State machine mirrors the firmware parser: any unexpected byte resyncs to
// scanning for the start byte. Unlike the original web app parser, zero-length
// packets (length byte == 0) are emitted correctly instead of being dropped.

import { EventEmitter } from "node:events";
import { PACKET_START, PACKET_MAX_DATA } from "./constants.js";

const STATE_SCAN = 0;
const STATE_HEADER = 1;
const STATE_LEN = 2;
const STATE_PAYLOAD = 3;

export class PacketParser extends EventEmitter {
  constructor() {
    super();
    this.reset();
  }

  reset() {
    this.state = STATE_SCAN;
    this.header = 0;
    this.expected = 0;
    this.payload = [];
  }

  /** Feed a chunk of raw bytes (Buffer or Uint8Array). */
  feed(chunk) {
    for (const byte of chunk) {
      switch (this.state) {
        case STATE_SCAN:
          if (byte === PACKET_START) {
            this.state = STATE_HEADER;
          }
          break; // anything else is garbage: stay scanning (resync)

        case STATE_HEADER:
          this.header = byte;
          this.state = STATE_LEN;
          break;

        case STATE_LEN:
          if (byte === 0) {
            // Zero-length packet: the length byte is the last byte.
            this.emit("packet", this.header, Buffer.alloc(0));
            this.reset();
          } else if (byte > PACKET_MAX_DATA) {
            this.reset(); // impossible length: resync
          } else {
            this.expected = byte;
            this.payload = [];
            this.state = STATE_PAYLOAD;
          }
          break;

        case STATE_PAYLOAD:
          this.payload.push(byte);
          if (this.payload.length === this.expected) {
            this.emit("packet", this.header, Buffer.from(this.payload));
            this.reset();
          }
          break;
      }
    }
  }
}
