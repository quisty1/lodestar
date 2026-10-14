import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

// Separate from vite.config.ts on purpose: the CRXJS plugin assumes an
// extension build context and breaks under the test runner. Tests only need
// Vue SFC compilation + jsdom.
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@lib': fileURLToPath(new URL('./src/lib', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts', 'scripts/**/*.test.mjs'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,vue}'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        'src/**/*.d.ts',
        'src/**/*.test-fixture.ts',
        'src/**/fixtures/**',
        'src/**/__fixtures__/**',
        'src/lib/types.ts',
        'src/**/contracts.ts',
        'src/lib/ports.ts',
        'src/**/index.ts',
        'src/**/main.ts',
      ],
      thresholds: {
        lines: 87.81,
        functions: 88.59,
        branches: 83.87,
        statements: 87.81,
      },
    },
  },
});
