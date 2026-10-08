// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

// Reads the fuses back off a packaged binary and holds them to the config.
//
// electron-builder flips them as it packs, from `electronFuses` in
// electron-builder.config.js. Nothing about the result shows from outside: a
// binary whose fuses were never flipped installs, starts and updates exactly
// like one whose were. So the binary that goes into the installer is read, by
// the packaging job and by the release.
//
//   node .github/scripts/verify-fuses.mjs <the packaged executable>
//
// Exit codes: 0 every fuse the config names is as it says, 1 one is not,
// 2 the check itself could not be made.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { getCurrentFuseWire, FuseV1Options } = require('@electron/fuses');
const config = require('../../electron-builder.config.js');

// How a fuse is written in the binary: the characters '0' and '1'. Anything
// else is a fuse this Electron has removed, or does not have.
const STATES = new Map([
  [48, false],
  [49, true],
]);

const binary = process.argv[2];
if (!binary) {
  console.error('usage: verify-fuses.mjs <the packaged executable>');
  process.exit(2);
}

const wanted = Object.entries(config.electronFuses ?? {});
if (wanted.length === 0) {
  console.error('::error::electron-builder.config.js names no fuses, so there is nothing to hold');
  process.exit(2);
}

let wire;
try {
  wire = await getCurrentFuseWire(binary);
} catch (err) {
  console.error(`::error::could not read the fuses of ${binary}: ${err?.message ?? err}`);
  process.exit(2);
}

let wrong = 0;
for (const [key, expected] of wanted) {
  // The config spells a fuse as electron-builder does, the library as Electron
  // does: the same name with its first letter raised.
  const name = key[0].toUpperCase() + key.slice(1);
  const actual = STATES.get(wire[FuseV1Options[name]]);
  const reads = actual === undefined ? 'not there' : actual ? 'on' : 'off';
  if (actual === expected) {
    console.log(`  OK      ${name} is ${reads}`);
  } else {
    wrong += 1;
    console.error(
      `::error::${name} is ${reads} in ${binary}, and the config says ${expected ? 'on' : 'off'}`,
    );
  }
}

process.exit(wrong > 0 ? 1 : 0);
