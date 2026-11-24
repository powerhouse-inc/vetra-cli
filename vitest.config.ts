import os from "node:os";
import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// Not tests of this package: the playwright suite, lab scripts, the `.ph/`
// cache, build output, and sample reactor projects a dev run leaves at the
// root (e.g. `workout-tracker/`), which ship their own scaffolded suites.
const notOurs = [
  ...configDefaults.exclude,
  "**/dist/**",
  "**/.ph/**",
  "cli/e2e/**",
  "lab/**",
  "docs/**",
  "workout-tracker/**",
];

export default defineConfig({
  test: {
    globals: true,
    // No test meets the user's own supervisor or identities: the folders
    // hold none.
    env: {
      PH_SUPERVISOR_HOME: path.join(
        os.tmpdir(),
        "vetra-cli-test-no-supervisor",
      ),
      PH_IDENTITY_HOME: path.join(os.tmpdir(), "vetra-cli-test-no-identities"),
    },
    coverage: {
      provider: "v8",
      include: ["document-models/**/src/reducers/**", "cli/src/**/*.ts"],
      thresholds: {
        "document-models/**/src/reducers/**": {
          lines: 95,
          branches: 95,
          functions: 95,
          statements: 95,
        },
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: "app",
          // Node by default; the DOM test files set `// @vitest-environment happy-dom`.
          exclude: [...notOurs, "cli/**"],
          // Projects with different maxWorkers run in separate groups.
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: "cli",
          environment: "node",
          // Many tests spawn git and hit the 5 s default timeout when every
          // core is busy, so cap the workers.
          maxWorkers: 6,
          sequence: { groupOrder: 1 },
          include: ["cli/tests/**/*.test.ts"],
          exclude: notOurs,
        },
      },
    ],
  },
  // A linked package resolves React from its own node_modules; its hooks need
  // the one copy that react-dom renders with.
  resolve: { dedupe: ["react", "react-dom"] },
  plugins: [tsconfigPaths()],
});
