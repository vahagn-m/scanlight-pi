<template>
  <v-container>
    <v-row>
      <v-col cols="12" md="6">
        <v-card>
          <v-card-title>Scanlight</v-card-title>
          <v-card-text>
            <v-chip
              :color="serialConnected ? 'success' : 'error'"
              variant="flat"
              class="mr-2 mb-2"
            >
              <v-icon start>{{ serialConnected ? "mdi-check-circle" : "mdi-close-circle" }}</v-icon>
              {{ serialConnected ? `Scanlight connected — ${hwVersionString}` : "Scanlight disconnected" }}
            </v-chip>
            <v-chip
              :color="cameraConnected ? 'success' : 'error'"
              variant="flat"
              class="mr-2 mb-2"
            >
              <v-icon start>{{ cameraConnected ? "mdi-camera" : "mdi-camera-off" }}</v-icon>
              {{ cameraConnected ? `Camera — ${cameraModel}` : "Camera not found" }}
            </v-chip>
            <v-btn class="mb-2 mr-2" color="secondary" @click="rescan">
              Rescan devices
            </v-btn>
            <v-btn class="mb-2" color="secondary" :disabled="!cameraConnected || sequenceRunning" @click="testCapture">
              Test Shutter
            </v-btn>
            <v-alert
              v-if="showPowerCableWarning"
              class="mt-4"
              title="Connect Power Cable"
              text="Connect the other USB port to a power supply to enable LEDs"
              type="warning"
              variant="tonal"
            ></v-alert>
          </v-card-text>
        </v-card>
        <br />
        <v-card :disabled="controlsDisabled">
          <v-card-title>Manual Control</v-card-title>
          <v-card-text>
            <v-alert
              v-if="sequenceRunning"
              class="mb-4"
              title="Sequence in progress"
              text="Manual controls are locked while a scan sequence runs."
              type="info"
              variant="tonal"
            ></v-alert>
            <v-number-input
              label="Red brightness"
              v-model="red"
              :min="0"
              :max="255"
              variant="outlined"
              @update:modelValue="update"
            ></v-number-input>
            <v-slider
              v-model="red"
              color="red"
              :min="0"
              :max="255"
              @end="update"
            ></v-slider>
            <v-number-input
              label="Green brightness"
              v-model="green"
              :min="0"
              :max="255"
              variant="outlined"
              @update:modelValue="update"
            ></v-number-input>
            <v-slider
              v-model="green"
              color="green"
              :min="0"
              :max="255"
              @end="update"
            ></v-slider>
            <v-number-input
              label="Blue brightness"
              v-model="blue"
              :min="0"
              :max="255"
              variant="outlined"
              @update:modelValue="update"
            ></v-number-input>
            <v-slider
              v-model="blue"
              color="blue"
              :min="0"
              :max="255"
              @end="update"
            ></v-slider>
            <v-row justify="space-between">
              <v-col>
                <v-btn
                  block
                  color="cyan-lighten-3"
                  elevation="2"
                  x-large
                  @click="setEnabledChannels([1, 1, 1, 0, 0])">RGB</v-btn>
              </v-col>
              <v-col>
                <v-btn
                  block
                  color="amber-lighten-3"
                  elevation="2"
                  x-large
                  @click="setEnabledChannels([0, 0, 0, 1, 0])"
                  v-if="hwSupportsWhite">WHITE</v-btn>
              </v-col>
              <v-col>
                <v-btn
                  block
                  color="black"
                  elevation="2"
                  x-large
                  @click="setEnabledChannels([0, 0, 0, 0, 0])">OFF</v-btn>
              </v-col>
            </v-row>
            <v-row justify="space-between">
              <v-col>
                <v-btn
                  block
                  color="red"
                  elevation="2"
                  x-large
                  @click="setEnabledChannels([1, 0, 0, 0, 0])">R</v-btn>
              </v-col>
              <v-col>
                <v-btn
                  block
                  color="green"
                  elevation="2"
                  x-large
                  @click="setEnabledChannels([0, 1, 0, 0, 0])">G</v-btn>
              </v-col>
              <v-col>
                <v-btn
                  block
                  color="blue"
                  elevation="2"
                  x-large
                  @click="setEnabledChannels([0, 0, 1, 0, 0])">B</v-btn>
              </v-col>
              <v-col>
                <v-btn
                  block
                  color="pink-darken-4"
                  elevation="2"
                  x-large
                  @click="setEnabledChannels([0, 0, 0, 0, 1])"
                  v-if="hwSupportsIR">IR</v-btn>
              </v-col>
            </v-row>
            <v-alert v-if="showReducedPowerWarning" class="mt-4" text="Operating at reduced brightness. Use a USB-C power source with 9V 18W or higher output for full brightness." type="info" variant="tonal"></v-alert>
            <v-alert v-if="showTemperatureWarning" class="mt-4" text="LED temperature high. Light will turn off automatically at 80°C." type="warning" variant="tonal"></v-alert>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" md="6">
        <v-card :disabled="controlsDisabled">
          <v-card-title>RGB Presets</v-card-title>
          <v-card-text class="pb-2">
            <v-select
              v-model="selectedPresetName"
              :items="presets.map(p => p.name)"
              label="Select Preset"
              variant="outlined"
              @update:modelValue="loadPreset"
            ></v-select>
            <v-btn class="mr-2 mb-2" color="primary" @click="loadPreset" :disabled="!selectedPresetName">Load</v-btn>
            <v-btn class="mr-2 mb-2" color="primary" @click="openPresetDialog('create')">Create</v-btn>
            <v-btn class="mr-2 mb-2" color="primary" @click="openPresetDialog('rename')" :disabled="!selectedPresetName">Rename</v-btn>
            <v-btn class="mr-2 mb-2" color="primary" @click="deleteDialog = true" :disabled="!selectedPresetName">Delete</v-btn>
            <v-btn class="mr-2 mb-2" color="primary" @click="defaultsDialog = true">Set as default</v-btn>
            <v-btn class="mr-2 mb-2" color="primary" @click="loadDefault">Load default</v-btn>
            <v-btn class="mr-2 mb-2" color="primary" v-if="hwSupportsTrimming" @click="trimDialog = true">Brightness Trimming</v-btn>

            <v-dialog v-model="defaultsDialog" max-width="400" persistent>
              <v-card
                title="Overwrite default?"
                text="The current RGB setting will be stored to the light's memory and will be used at startup, or whenever the light is not connected to a computer."
              >
                <template v-slot:actions>
                  <v-spacer></v-spacer>
                  <v-btn @click="defaultsDialog = false">Cancel</v-btn>
                  <v-btn class="text-accent" @click="writeDefault(); defaultsDialog = false;">OK</v-btn>
                </template>
              </v-card>
            </v-dialog>

            <v-dialog v-model="trimDialog" max-width="400" persistent>
              <v-card title="Brightness Trimming">
                <v-card-text class="mt-2 pb-0">
                  <v-number-input label="Red" v-model="trimR" :min="-127" :max="127" variant="outlined"></v-number-input>
                  <v-number-input label="Green" v-model="trimG" :min="-127" :max="127" variant="outlined"></v-number-input>
                  <v-number-input label="Blue" v-model="trimB" :min="-127" :max="127" variant="outlined"></v-number-input>
                  <v-number-input label="White" v-model="trimW" :min="-127" :max="127" variant="outlined"></v-number-input>
                  <div class="text-grey-darken-1 text-caption">
                    Range for all trimming values is -127 to +127 (-50% to +50% drive strength). Trimming values are stored in the light's memory.
                  </div>
                </v-card-text>
                <template v-slot:actions>
                  <v-spacer></v-spacer>
                  <v-btn @click="trimDialog = false">Cancel</v-btn>
                  <v-btn class="text-accent" @click="setTrim(); trimDialog = false;">OK</v-btn>
                </template>
              </v-card>
            </v-dialog>

            <v-dialog v-model="presetDialog.show" max-width="400" persistent>
              <v-card :title="presetDialog.mode === 'create' ? 'New preset' : 'Rename preset'">
                <v-card-text>
                  <v-text-field
                    v-model="presetDialog.name"
                    label="Preset name"
                    variant="outlined"
                    autofocus
                    @keyup.enter="submitPresetDialog"
                  ></v-text-field>
                </v-card-text>
                <template v-slot:actions>
                  <v-spacer></v-spacer>
                  <v-btn @click="presetDialog.show = false">Cancel</v-btn>
                  <v-btn class="text-accent" @click="submitPresetDialog">OK</v-btn>
                </template>
              </v-card>
            </v-dialog>

            <v-dialog v-model="deleteDialog" max-width="400" persistent>
              <v-card
                :title="`Delete preset &quot;${selectedPresetName}&quot;?`"
                text="This preset will be removed for all connected clients."
              >
                <template v-slot:actions>
                  <v-spacer></v-spacer>
                  <v-btn @click="deleteDialog = false">Cancel</v-btn>
                  <v-btn class="text-error" @click="deletePreset(); deleteDialog = false;">Delete</v-btn>
                </template>
              </v-card>
            </v-dialog>
          </v-card-text>
        </v-card>
        <br />
        <v-card :disabled="controlsDisabled" v-if="cameraConnected">
          <v-card-title>Automation</v-card-title>
          <v-card-text class="pb-2">
            <v-number-input
              label="Pre-capture Delay (s)"
              v-model="preCaptureDelay"
              :min="0.01"
              :max="1.0"
              :step="0.01"
              :precision="2"
              variant="outlined"
            ></v-number-input>
            <v-number-input
              label="Post-capture Delay (s)"
              v-model="postCaptureDelay"
              :min="0.1"
              :max="12.75"
              :step="0.05"
              :precision="2"
              variant="outlined"
              hide-details
            ></v-number-input>
            <v-checkbox hide-details label="Keep light on" v-model="keepLightOn"></v-checkbox>

            <div v-if="sequenceRunning" class="mb-4">
              <div class="text-body-2 mb-1">
                Step {{ sequence.step }}/{{ sequence.total }} — channel {{ sequence.channelLabel }} — {{ phaseLabel }}
              </div>
              <v-progress-linear
                :model-value="sequence.total ? (sequence.step / sequence.total) * 100 : 0"
                color="accent"
                height="8"
                rounded
              ></v-progress-linear>
            </div>

            <v-btn class="mr-2 mb-2" color="primary" :disabled="sequenceRunning" @click="startSequence('RGB')">Auto R,G,B</v-btn>
            <v-btn class="mr-2 mb-2" color="primary" :disabled="sequenceRunning" @click="startSequence('RGBIR')" v-if="hwSupportsIR">Auto R,G,B,IR</v-btn>
            <v-btn class="mr-2 mb-2" color="primary" :disabled="sequenceRunning" @click="startSequence('NWIR')" v-if="hwSupportsIR">Auto RGB,IR</v-btn>
            <v-btn class="mr-2 mb-2" color="primary" :disabled="sequenceRunning" @click="startSequence('BWIR')" v-if="hwSupportsIR">Auto W,IR</v-btn>
            <v-btn class="mr-2 mb-2" color="error" variant="tonal" :disabled="!sequenceRunning" @click="abortSequence">Abort</v-btn>
          </v-card-text>
        </v-card>
        <br />
        <v-card>
          <v-card-title>Info</v-card-title>
          <v-card-text>
            <div class="text-grey-darken-1 text-caption">
              <span v-if="hwSupportsADC" class="mr-4">Input voltage: {{ inputVoltageV }}V</span><span v-if="ledTemperatureC > 5" class="mr-4">LED temperature: {{ ledTemperatureC }}C</span><span>{{ hwVersionString }}</span><span> firmware {{ fwVersionString }}</span>
              <br />
              <a class="text-accent" href="https://jackw01.github.io/scanlight/big">big scanlight info &amp; instructions</a>
              <br />
              scanlight-pi controller — Node/Socket.io port of scanlight control app v2.1 by jackw01
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <v-snackbar v-model="snackbar.show" :color="snackbar.color" :timeout="5000">
      {{ snackbar.text }}
    </v-snackbar>
  </v-container>
</template>

<script>
import { socket } from "../socket";

// Thresholds mirrored from server/config.js (original app_bsl values).
const USBVBUSThreshold5V = 4000;
const USBVBUSThreshold9V = 8000;
const OverTemperatureThresholdMdegc = 77000;

const PHASE_LABELS = {
  starting: "starting",
  setting: "setting light",
  preDelay: "pre-capture delay",
  capture: "exposing",
  postDelay: "post-capture delay",
};

export default {
  name: "Main",
  data() {
    return {
      // Connection status (server-side connections, pushed via status:update)
      serialConnected: false,
      cameraConnected: false,
      cameraModel: "",
      hwVersionString: "",
      fwVersionString: "",
      // Light state
      red: 255,
      green: 255,
      blue: 255,
      enabledChannels: [1, 1, 1, 0, 0],
      trimR: 0,
      trimG: 0,
      trimB: 0,
      trimW: 0,
      // Telemetry
      inputVoltageMv: 5000,
      ledTemperatureMdegc: 0,
      // Presets (server-authoritative)
      presets: [],
      selectedPresetName: null,
      // Automation
      preCaptureDelay: 0.1,
      postCaptureDelay: 1.0,
      keepLightOn: false,
      sequenceRunning: false,
      sequence: { step: 0, total: 0, channelLabel: "", phase: "" },
      // Dialogs / feedback
      defaultsDialog: false,
      trimDialog: false,
      deleteDialog: false,
      presetDialog: { show: false, mode: "create", name: "" },
      snackbar: { show: false, text: "", color: "info" },
    };
  },
  computed: {
    controlsDisabled() {
      if (this.sequenceRunning) return true;
      if (!this.hwSupportsADC) return !this.serialConnected;
      return !(this.serialConnected && this.inputVoltageMv > USBVBUSThreshold5V);
    },
    showPowerCableWarning() {
      return this.serialConnected && this.hwSupportsADC && this.controlsDisabled;
    },
    inputVoltageV() {
      return (this.inputVoltageMv / 1000).toFixed(2);
    },
    ledTemperatureC() {
      return (this.ledTemperatureMdegc / 1000).toFixed(1);
    },
    showReducedPowerWarning() {
      if (this.hwVersionString === "big scanlight v1") {
        return (
          this.inputVoltageMv > USBVBUSThreshold5V &&
          this.inputVoltageMv < USBVBUSThreshold9V
        );
      }
      return false;
    },
    showTemperatureWarning() {
      return this.ledTemperatureMdegc > OverTemperatureThresholdMdegc;
    },
    hwSupportsADC() {
      return this.hwVersionString !== "scanlight v2/v3" && this.hwVersionString !== "";
    },
    hwSupportsWhite() {
      return this.hwVersionString !== "scanlight v2/v3" && this.hwVersionString !== "";
    },
    hwSupportsIR() {
      return this.hwVersionString === "big scanlight v1";
    },
    hwSupportsTrimming() {
      return this.hwVersionString === "big scanlight v1";
    },
    phaseLabel() {
      return PHASE_LABELS[this.sequence.phase] || this.sequence.phase;
    },
  },
  mounted() {
    socket.on("status:update", (status) => {
      this.serialConnected = status.serial.connected;
      this.hwVersionString = status.serial.hwVersion || "";
      this.fwVersionString = status.serial.fwVersion || "";
      this.cameraConnected = status.camera.connected;
      this.cameraModel = status.camera.model || "";
      this.sequenceRunning = status.sequence.running;
      if (status.sequence.running) {
        this.sequence = {
          step: status.sequence.step,
          total: status.sequence.total,
          channelLabel: status.sequence.channelLabel,
          phase: status.sequence.phase,
        };
      }
    });
    socket.on("telemetry:update", (t) => {
      this.ledTemperatureMdegc = t.ledTempMdegc;
      this.inputVoltageMv = t.vbusMv;
    });
    socket.on("light:state", (light) => {
      this.red = light.r;
      this.green = light.g;
      this.blue = light.b;
      this.enabledChannels = [...light.channels];
    });
    socket.on("light:defaults", ({ r, g, b }) => {
      this.red = r;
      this.green = g;
      this.blue = b;
      this.update();
    });
    socket.on("trim:values", (trim) => {
      [this.trimR, this.trimG, this.trimB, this.trimW] = trim;
    });
    socket.on("presets:list", (list) => {
      this.presets = list;
      if (this.selectedPresetName && !list.some((p) => p.name === this.selectedPresetName)) {
        this.selectedPresetName = null;
      }
    });
    socket.on("sequence:progress", (progress) => {
      this.sequenceRunning = true;
      this.sequence = {
        step: progress.step,
        total: progress.total,
        channelLabel: progress.channelLabel,
        phase: progress.phase,
      };
    });
    socket.on("sequence:done", (result) => {
      this.sequenceRunning = false;
      this.sequence = { step: 0, total: 0, channelLabel: "", phase: "" };
      if (result.ok) {
        this.notify(`Sequence complete — ${result.captures} capture${result.captures === 1 ? "" : "s"}`, "success");
      } else if (result.aborted) {
        this.notify("Sequence aborted", "warning");
      } else {
        this.notify(`Sequence failed: ${(result.errors || []).join("; ")}`, "error");
      }
    });
    socket.on("camera:test:done", (result) => {
      if (result.ok) {
        this.notify("Test shutter OK", "success");
      } else {
        this.notify(`Test shutter failed: ${result.message}`, "error");
      }
    });
    socket.on("system:error", (err) => {
      this.notify(`${err.source}: ${err.message}`, "error");
    });
  },
  methods: {
    notify(text, color = "info") {
      this.snackbar = { show: true, text, color };
    },
    setEnabledChannels(ch) {
      this.enabledChannels = ch;
      this.update();
    },
    update() {
      if (!this.serialConnected || this.sequenceRunning) return;
      socket.emit("light:update", {
        r: this.red,
        g: this.green,
        b: this.blue,
        channels: this.enabledChannels,
        saveFlag: 0,
      });
    },
    rescan() {
      socket.emit("system:rescan");
    },
    // Presets
    openPresetDialog(mode) {
      this.presetDialog = {
        show: true,
        mode,
        name: mode === "rename" ? this.selectedPresetName : "",
      };
    },
    submitPresetDialog() {
      const name = (this.presetDialog.name || "").trim();
      this.presetDialog.show = false;
      if (!name) return;
      if (this.presetDialog.mode === "create") {
        socket.emit("presets:create", {
          name,
          red: this.red,
          green: this.green,
          blue: this.blue,
        });
        this.selectedPresetName = name;
      } else {
        socket.emit("presets:rename", { oldName: this.selectedPresetName, newName: name });
        this.selectedPresetName = name;
      }
    },
    deletePreset() {
      socket.emit("presets:delete", { name: this.selectedPresetName });
      this.selectedPresetName = null;
    },
    loadPreset() {
      const preset = this.presets.find((p) => p.name === this.selectedPresetName);
      if (!preset) return;
      this.red = preset.red;
      this.green = preset.green;
      this.blue = preset.blue;
      this.update();
    },
    loadDefault() {
      socket.emit("default:load");
    },
    writeDefault() {
      socket.emit("default:save");
    },
    setTrim() {
      socket.emit("trim:set", [this.trimR, this.trimG, this.trimB, this.trimW]);
    },
    // Automation
    startSequence(sequence) {
      socket.emit("sequence:start", {
        sequence,
        preDelay: this.preCaptureDelay,
        postDelay: this.postCaptureDelay,
        keepLightOn: this.keepLightOn,
      });
    },
    abortSequence() {
      socket.emit("sequence:abort");
    },
    testCapture() {
      socket.emit("camera:test");
    },
  },
};
</script>
