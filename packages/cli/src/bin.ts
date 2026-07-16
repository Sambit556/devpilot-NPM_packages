#!/usr/bin/env node

/**
 * DevsPilot CLI Entry Point
 *
 * This is the binary that runs when you type `DevsPilot`.
 * It parses arguments and routes to the appropriate command.
 */

import { run } from './index.js';

run(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
