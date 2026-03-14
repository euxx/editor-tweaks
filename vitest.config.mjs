import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Uncomment and add setup files if needed:
    // setupFiles: ['./tests/setup.js'],
  },
});
