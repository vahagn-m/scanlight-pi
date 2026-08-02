// Scanlight host<->device packet protocol constants.
// Authoritative spec: scanlight/automation/bsl_control_interface.md
//
// Frame (both directions): [0xFE][header][length][data...]
// Max data length 127 bytes. Multi-byte integers are BIG-ENDIAN.
// The device never sends ACKs; GET_* requests are matched to responses by header.

export const PACKET_START = 0xfe;
export const PACKET_MAX_LENGTH = 128; // Max data bytes + framing slack (spec value).
export const PACKET_MAX_DATA = 127;

// Host-to-device headers.
export const PKT_H2D_SET_COLOR = 0; // 6 bytes: R, G, B, White, IR, save-preset flag
export const PKT_H2D_GET_DEFAULT_RGB = 1; // 0 bytes
export const PKT_H2D_GET_FW_VERSION = 2; // 0 bytes
export const PKT_H2D_SHUTTER_PULSE = 3; // unused: shutter is handled host-side via gphoto2
export const PKT_H2D_DFU_MODE = 4; // unused: firmware update UI removed
export const PKT_H2D_SET_TRIM = 5; // 4 bytes: R, G, B, W trim (int8 two's complement)
export const PKT_H2D_GET_TRIM = 6; // 0 bytes
export const PKT_H2D_SET_FOCUS = 7; // unused: focus GPIO removed

// Device-to-host headers.
export const PKT_D2H_ACK = 0; // defined in firmware but never sent
export const PKT_D2H_LED_TEMP = 1; // int32 BE: LED temperature, millidegrees C (every 200 ms)
export const PKT_D2H_VBUS = 2; // int32 BE: USB input voltage, mV (every 200 ms)
export const PKT_D2H_FW_VERSION = 3; // uint32 BE: low 16 = FW version ID, high 16 = HW version ID
export const PKT_D2H_DEFAULT_RGB = 4; // 3 bytes: R, G, B
export const PKT_D2H_TRIM = 5; // 4 bytes: int8 trims
