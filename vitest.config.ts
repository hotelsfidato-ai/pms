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
  /* ⚠ THIS FILE DOES NOT INHERIT FROM `vite.config.ts`, so every global
     that config injects has to be repeated here. `__CACHE_BUSTER__`
     was added there and eighteen tests died with "__CACHE_BUSTER__ is
     not defined" — App.tsx reads it to decide whether a persisted cache
     outlived the code that wrote it.

     A fixed value: a test run must not depend on when it ran. */
  define: {
    __CACHE_BUSTER__: JSON.stringify('test'),
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
