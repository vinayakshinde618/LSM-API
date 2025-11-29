import globals from "globals";
import pluginJs from "@eslint/js";
import pluginPromise from "eslint-plugin-promise"; // Add this import

/** @type {import('eslint').Linter.FlatConfig[]} */
export default [
  {
    files: ["**/*.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: globals.node
    },
    ignores: [
      "node_modules/",
      "logs/",
      "dist/",
      "coverage/"
    ],
    plugins: {
      promise: pluginPromise
    },
    rules: {
      "indent": ["error", 2],
      "quotes": ["error", "single"],
      "semi": ["error", "always"],
      "no-unused-vars": ["warn"],
      "eqeqeq": ["error", "always"],
      "no-console": ["warn"],
      "curly": ["error", "all"],
      "no-multiple-empty-lines": ["error", { "max": 1 }],
      "camelcase": ["error", { "properties": "always" }],
      "no-var": "error",
      "prefer-const": "error",
      "consistent-return": "error",
      "callback-return": "warn",
      "promise/always-return": "error" // Now this will work
    }
  },
  {
    files: ["migrations/**/*.js", "seeders/**/*.js"],
    rules: {
      "no-console": "off"
    }
  },
  pluginJs.configs.recommended
];
