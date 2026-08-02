import { createApp } from "vue";
import App from "./App.vue";
import vuetify from "./plugins/vuetify";
import "./assets/main.css";

// Barlow bundled locally (no CDN — the rig may be offline).
import "@fontsource/barlow/300.css";
import "@fontsource/barlow/400.css";
import "@fontsource/barlow/500.css";
import "@fontsource/barlow/700.css";

createApp(App).use(vuetify).mount("#app");
