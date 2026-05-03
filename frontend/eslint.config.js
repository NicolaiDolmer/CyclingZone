import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  // Pin js.configs.recommended til .js only. Pre-S3 var lint de facto .js-only
  // (eslint.config.js havde ingen files-pattern, og uden plugin-imports for jsx
  // blev .jsx ikke discovered af `eslint .`). Vi bevarer den baseline her.
  { ...js.configs.recommended, files: ["**/*.js"] },
  {
    files: ["**/*.js"],
    plugins: { react, "react-hooks": reactHooks },
    languageOptions: {
      globals: { ...globals.browser },
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: "18.3" } },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-console": "off",
    },
  },
  // Dark mode S3 color-guard: forhindrer regression af S2-token-migrering ved at fejle
  // hvis nogen introducerer Tailwind slate-*/gray-* i stedet for cz-tokens. Scoped til
  // .jsx + .js (statBg.js returnerer className-strings). Bevidst surgical: vi aktiverer
  // IKKE øvrige react-rules på .jsx her — der ligger 71 pre-eksisterende issues der
  // skal saneres i en separat sanity-pass før vi løfter scope.
  //
  // v2.10: udvidet til at fange text/border/ring/divide/outline-(white|black)/N opacity-
  // classes — disse antager mørk/lys baggrund og gav Panic Board light-mode contrast-bug
  // i v2.09. bg-(white|black)/N er bevidst tilladt fordi modal-scrims (ConfettiModal,
  // OnboardingModal, SetupWizardModal, Layout, TeamPage) idiomatisk bruger bg-black/60-70.
  {
    files: ["**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/(?:slate|gray)-(?:50|100|200|300|400|500|600|700|800|900|950)\\b/]",
          message: "Dark mode S3: brug cz-tokens (text-cz-1/2/3, bg-cz-card, border-cz-border, …) i stedet for Tailwind slate-*/gray-*. Se frontend/tailwind.config.js for fulde token-liste.",
        },
        {
          selector: "TemplateElement[value.raw=/(?:slate|gray)-(?:50|100|200|300|400|500|600|700|800|900|950)\\b/]",
          message: "Dark mode S3: brug cz-tokens (text-cz-1/2/3, bg-cz-card, border-cz-border, …) i stedet for Tailwind slate-*/gray-*. Se frontend/tailwind.config.js for fulde token-liste.",
        },
        {
          selector: "Literal[value=/(?:text|border|ring|divide|outline)-(?:white|black)\\/\\d+\\b/]",
          message: "Dark mode S3: text/border-(white|black)/N antager fast tema-baggrund og bryder light mode. Brug cz-tokens (text-cz-1/2/3, border-cz-border, …). bg-(white|black)/N er tilladt for modal-scrims.",
        },
        {
          selector: "TemplateElement[value.raw=/(?:text|border|ring|divide|outline)-(?:white|black)\\/\\d+\\b/]",
          message: "Dark mode S3: text/border-(white|black)/N antager fast tema-baggrund og bryder light mode. Brug cz-tokens (text-cz-1/2/3, border-cz-border, …). bg-(white|black)/N er tilladt for modal-scrims.",
        },
      ],
    },
  },
  { ignores: ["node_modules/", "dist/"] },
];
