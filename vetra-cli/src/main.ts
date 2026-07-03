#!/usr/bin/env node
import './ensure-home.js';
import './allow-fresh-deps.js';
import './version-banner.js';
import { cli } from './cli.js';

cli.run(process.argv).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
