module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    project: "./tsconfig.json",
  },
  plugins: ["@typescript-eslint"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
  ],
  env: {
    node: true,
    es2022: true,
  },
  rules: {
    "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-non-null-assertion": "warn",
    "no-console": "off",
    "no-debugger": "error",
    "no-duplicate-imports": "warn",
    "prefer-const": "warn",
    "@typescript-eslint/consistent-type-imports": ["warn", {
      prefer: "type-imports",
      fixStyle: "inline-type-imports",
    }],
    "@typescript-eslint/no-restricted-imports": ["warn", {
      patterns: [{
        group: ["../core/ai-guard"],
        message: "AIGuard has been moved to permissions/ai-guard. Import from '../permissions/ai-guard.js' or '../permissions/index.js' instead."
      }]
    }],
  },
  ignorePatterns: [
    "dist",
    "node_modules",
    "coverage",
    "desktop",
    "web",
    "*.js",
    "*.cjs",
    "*.mjs",
  ],
  overrides: [
    {
      files: ["*.d.ts"],
      rules: {
        "@typescript-eslint/no-explicit-any": "off",
      },
    },
    {
      files: ["src/cli/**/*.tsx"],
      rules: {
        "no-console": "off",
      },
    },
  ],
};
