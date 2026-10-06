// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      // Node cannot load Electron's built-in module, and keytar's native
      // binding is built against Electron's ABI. Neither is needed by anything
      // under test — see test/stubs/electron.ts.
      electron: path.resolve(__dirname, 'test/stubs/electron.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Every file runs in a worker of its own, and that is a choice rather than
    // a default left alone: the files replace modules with `vi.mock`, and the
    // code under test keeps state at module level (the data root, the stores),
    // so no file may be handed a module another one has already loaded.
    isolate: true,
  },
});
