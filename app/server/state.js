// Centralized server-side state. Socket handlers and the sequence engine
// read and mutate this object; newly connected sockets receive a snapshot.

export const state = {
  serial: {
    connected: false,
    fwId: null,
    hwId: null,
    fwVersion: "",
    hwVersion: "",
  },
  camera: {
    connected: false,
    model: "",
  },
  telemetry: {
    ledTempMdegc: 0,
    vbusMv: 0,
  },
  light: {
    r: 255,
    g: 255,
    b: 255,
    channels: [1, 1, 1, 0, 0],
  },
  trim: [0, 0, 0, 0],
  presets: [],
  sequence: {
    running: false,
    name: null,
    step: 0,
    total: 0,
    channelLabel: "",
    phase: "",
    abortRequested: false,
  },
};

export function statusSnapshot() {
  return {
    serial: { ...state.serial },
    camera: { ...state.camera },
    sequence: {
      running: state.sequence.running,
      name: state.sequence.name,
      step: state.sequence.step,
      total: state.sequence.total,
      channelLabel: state.sequence.channelLabel,
      phase: state.sequence.phase,
    },
  };
}
