import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.local/**",
      "**/backups/**",
      "apps/web/public/sw.js",
      "apps/web/public/offline.html"
    ]
  },
  js.configs.recommended,
  {
    files: ["**/*.js", "**/*.jsx"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true }
      },
      globals: {
        ...globals.node,
        ...globals.browser
      }
    },
    plugins: { react },
    settings: { react: { version: "detect" } },
    rules: {
      // Core ESLint does not treat JSX tags as variable references.
      "react/jsx-uses-vars": "error",
      "react/jsx-uses-react": "off",
      "react/react-in-jsx-scope": "off",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-console": "off",
      eqeqeq: ["error", "smart"],
      "no-var": "error",
      "prefer-const": "error"
    }
  }
];
