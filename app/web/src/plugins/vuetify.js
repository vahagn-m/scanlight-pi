// Theme ported from the original app_bsl.
import "@mdi/font/css/materialdesignicons.css";
import "vuetify/styles";

import { createVuetify } from "vuetify";
import colors from "vuetify/lib/util/colors";

// VNumberInput is a stable component in Vuetify >=3.13 and is auto-imported
// from templates by vite-plugin-vuetify (autoImport: true).

export default createVuetify({
  theme: {
    defaultTheme: "system",
    themes: {
      light: {
        dark: false,
        colors: {
          background: colors.grey.lighten3,
          primary: colors.grey.darken1,
          secondary: colors.teal.base,
          accent: colors.teal.base,
          error: colors.deepOrange.accent4,
        },
      },
      dark: {
        dark: true,
        colors: {
          primary: colors.grey.darken3,
          secondary: colors.teal.base,
          accent: colors.teal.base,
          error: colors.deepOrange.accent4,
        },
      },
    },
  },
});
