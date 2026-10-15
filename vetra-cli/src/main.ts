#!/usr/bin/env node
import './ensure-node-version.js';
import './ensure-home.js';
import './allow-fresh-deps.js';
import './version-banner.js';
import { cli } from './cli.js';
import { ensureModelAuth } from './setup-auth.js';

await ensureModelAuth(process.argv);

cli.run(process.argv).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
