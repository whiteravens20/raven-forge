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
  },
});
