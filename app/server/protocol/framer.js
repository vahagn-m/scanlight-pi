// Build a Scanlight protocol frame: [0xFE][header][length][data...].

import { PACKET_START, PACKET_MAX_DATA } from "./constants.js";

/**
 * @param {number} header Packet type header.
 * @param {number[]} [data] Payload bytes (0-255 each; values are masked).
 * @returns {Buffer} Complete frame ready for the wire.
 */
export function buildPacket(header, data = []) {
  if (data.length > PACKET_MAX_DATA) {
    throw new Error(`packet data too long: ${data.length} > ${PACKET_MAX_DATA}`);
  }
  const buf = Buffer.alloc(3 + data.length);
  buf[0] = PACKET_START;
  buf[1] = header & 0xff;
  buf[2] = data.length;
  for (let i = 0; i < data.length; i++) {
    buf[3 + i] = data[i] & 0xff;
  }
  return buf;
}
