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
    // Anything that talks to the network, the keychain or a child process is
    // out of scope here; these cover the pure logic where a silent wrong answer
    // is worse than a crash.
    coverage: {
      include: [
        'src/core/minecraft/launch-args.ts',
        'src/core/mods/integrity.ts',
        'src/core/updater/canonical.ts',
        'src/core/auth/offline-uuid.ts',
      ],
    },
  },
});
