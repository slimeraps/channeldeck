import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Tests run under Electron's own Node (ELECTRON_RUN_AS_NODE=1, see package.json) so
// native modules such as better-sqlite3 only need the Electron build.
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@renderer': resolve('src/renderer/src')
    }
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
    environment: 'node',
    restoreMocks: true
  }
})
