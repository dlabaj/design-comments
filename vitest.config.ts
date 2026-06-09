/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./demo/src/test/setup.ts'],
    globals: true,
    css: true,
    include: ['src/**/*.test.{ts,tsx}', 'demo/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: {
      '@app': path.resolve(__dirname, './demo/src/app'),
      '@design-comments': path.resolve(__dirname, './src/commenting-system'),
    },
  },
});
