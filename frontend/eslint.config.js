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
      ],
    },
  },
  { ignores: ["node_modules/", "dist/"] },
];
