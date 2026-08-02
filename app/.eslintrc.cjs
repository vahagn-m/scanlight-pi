/* ESLint config (CommonJS because the package is "type": "module"). */
module.exports = {
  root: true,
  env: {
    node: true,
    browser: true,
    es2022: true,
  },
  extends: ["eslint:recommended", "plugin:vue/vue3-recommended"],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
  },
  rules: {
    "vue/multi-word-component-names": "off",
    // "Main" matches the original app_bsl component naming.
    "vue/no-reserved-component-names": "off",
    // Template formatting below matches the original app_bsl style
    // (dense single-line elements); keep it for a faithful port.
    "vue/max-attributes-per-line": "off",
    "vue/singleline-html-element-content-newline": "off",
    "vue/html-self-closing": "off",
    "vue/attributes-order": "off",
    "vue/first-attribute-linebreak": "off",
    "vue/html-indent": "off",
    "vue/html-closing-bracket-newline": "off",
    "vue/multiline-html-element-content-newline": "off",
    "vue/v-on-event-hyphenation": "off",
    "vue/v-slot-style": "off",
    "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
  },
  ignorePatterns: ["node_modules/", "web/dist/"],
};
