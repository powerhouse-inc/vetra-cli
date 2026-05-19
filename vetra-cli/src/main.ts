#!/usr/bin/env node
import { cli } from './cli.js';

cli.run(process.argv).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
