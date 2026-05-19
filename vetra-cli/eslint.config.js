// @clint:begin eslint
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import jest from "eslint-plugin-jest";

export default tseslint.config(
  { ignores: ["dist/", "gen/", "coverage/"] },
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.eslint.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // The defineCommand contract (and Mastra's async-generator hooks) requires
      // `async` even when the body has no awaits — the rule mis-flags valid code.
      "@typescript-eslint/require-await": "off",
      // Fires on destructured helper exports that don't depend on `this`.
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    // src/agents/ is the Mastra boundary, and src/cli.ts wires ph-clint
    // service-lifecycle event handlers whose payloads upstream types as `any`.
    // Disable type-aware unsafe-* and unnecessary-assertion rules here so the
    // strictness still applies to our own code.
    files: ["src/agents/**/*.ts", "src/cli.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      // Mastra's Agent typing disagrees with tsc on whether the template-literal
      // cast is needed; tsc still requires it, so silence the lint complaint.
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
    },
  },
  {
    files: ["tests/**/*.ts"],
    ...jest.configs["flat/recommended"],
  },
  prettier,
);
// @clint:end eslint
