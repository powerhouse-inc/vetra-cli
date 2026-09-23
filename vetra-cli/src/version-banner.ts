// Side-effecting startup banner. Imported first in main.ts so it logs the
// running vetra version before the rest of the import graph evaluates —
// a crash in a downstream import (e.g. a mismatched ph-clint dependency)
// still leaves the version in the logs. Reads package.json directly to avoid
// importing ph-clint.
import { createRequire } from 'node:module';
import { DEFAULT_PH_VERSION } from './ph-version.gen.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { name: string; version: string };

// Resolved here (not at each call site) because this module sits at src/ root,
// where `../package.json` resolves the same in the src tree and the flat bundle.
export const VETRA_CLI_VERSION = pkg.version;

console.log(`${pkg.name} v${pkg.version} (ph ${DEFAULT_PH_VERSION})`);
