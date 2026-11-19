import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'
import { transformWithOxc } from 'vite'

export default defineConfig({
  plugins: [{
    name: 'app-jsx-in-js',
    enforce: 'pre',
    transform(code, id) {
      if (/\/app\/.*\.js$/.test(id)) {
        return transformWithOxc(code, id, { lang: 'jsx', jsx: { runtime: 'automatic' } })
      }
    },
  }],
  css: { postcss: { plugins: [] } },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    clearMocks: true,
    restoreMocks: true,
  },
})
