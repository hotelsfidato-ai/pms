import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import path from 'path'

/* The preview build is ONE html file: script, styles and the captured
   demo snapshot all inlined. That is what lets it be opened from any
   static host — or emailed — with no server, no asset paths and no
   rewrite rule to get wrong.

   Only in demo mode. The real build keeps hashed, cacheable assets,
   which is what nginx is configured for in deploy/nginx.conf. */
// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // The MODE, not process.env: Vite does not put .env files on
  // process.env, so reading VITE_DEMO_MODE here would always be
  // undefined and the preview would quietly build as a normal
  // multi-file app that cannot open without a server.
  const single = mode === 'preview'

  return {
  plugins: [
    react(),
    tailwindcss(),
    ...(single ? [viteSingleFile()] : []),
  ],
  resolve: {
    alias: {
      /* BEFORE '@', and that ordering is the whole thing. Vite walks
         the alias entries in order and takes the first match, so with
         '@' first this specific rule never fired and 271 KB of one
         property's bookings stayed in the production bundle — a real
         hotel shipping a fictional hotel's guests. Verified by
         grepping the built bundle, not by reading the config. */
      ...(single ? {} : {
        '@/data/demo-snapshot.json':
          path.resolve(__dirname, './src/data/empty-snapshot.json'),
      }),
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // The snapshot pushes the bundle past Vite's default warning. It is
    // one file on purpose; the warning is not telling us anything.
    chunkSizeWarningLimit: single ? 8000 : 500,
    outDir: single ? 'dist-preview' : 'dist',
    // Everything as a data URI in the preview. An asset left on disk is
    // a second file to host, and in a single-file build it is a 404 the
    // moment anything renders it.
    assetsInlineLimit: single ? 100_000_000 : 4096,
  },
  }
})
