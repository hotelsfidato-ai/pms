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
    /* docs/restore holds staged copies of working files, not tests. */
    exclude: ["**/node_modules/**", "**/dist/**", "docs/**"],
    globals: true,
    environment: 'jsdom',
  },
})
