import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    /* docs/restore holds staged copies of working files, not tests.
       api/ is a separate package with its own runner — its tests need
       a live Postgres and a node environment, not jsdom. Run them with
       `npm test` inside api/. */
    exclude: ["**/node_modules/**", "**/dist/**", "docs/**", "api/**"],
    globals: true,
    environment: 'jsdom',
    /* Stubs @/lib/api for every frontend test — CP9 moved the
       repositories onto HTTP and jsdom has no server. See the file
       for the split between what these tests prove and what api/test
       proves against real Postgres. */
    setupFiles: ['./src/test/setup.ts'],
  },
})
