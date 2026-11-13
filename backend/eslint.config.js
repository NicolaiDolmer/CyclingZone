import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-useless-assignment": "off",
      "no-console": "off",
    },
  },
  // #6110 (AGENTS regel 40): dommerens faelles fixture-fil maa ikke aendres af
  // byggebanen, saa denne ene regel slaas fra for netop den fil her i stedet.
  {
    files: ["lib/dommer6110.fixtures.mjs"],
    rules: { "preserve-caught-error": "off" },
  },
  { ignores: ["node_modules/"] },
];
