import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { VitePWA } from 'vite-plugin-pwa'
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
  // undefined and the build would quietly come out wrong.
  //
  // TWO demo builds, because they are hosted differently:
  //   preview   Firebase Hosting — hashed cacheable assets and a
  //             rewrite, so routes stay real paths
  //   artifact  one self-contained file — no host and no rewrite, so
  //             routing has to be hash-based and assets inlined
  const single = mode === 'artifact'
  const demo = mode === 'preview' || mode === 'artifact'

  /* ⚠ WHAT THROWS AWAY THE PERSISTED READ CACHE ON A NEW BUILD.
     `src/lib/persist.ts` keeps query results in IndexedDB for a week
     with `staleTime: Infinity`, so a browser can hold a RESPONSE SHAPE
     from before a deploy. That is not hypothetical: adding
     `prepMinutes` to the menu rendered the literal string
     "undefined min" on a screen, because the cached menu predated the
     field.
     A week is the right life for the DATA and the wrong life for the
     SHAPE. This changes per build, so a deploy discards the cache and
     the first load refetches — which a deploy requires anyway.
     Fixed in dev, or every restart would throw away the offline cache
     while somebody is testing offline. */
  const cacheBuster = mode === 'development'
    ? 'dev'
    : `build-${Date.now()}`

  return {
  define: {
    __CACHE_BUSTER__: JSON.stringify(cacheBuster),
  },
  plugins: [
    react(),
    tailwindcss(),
    ...(single ? [viteSingleFile()] : []),

    /* ── The service worker ──────────────────────────────────────────
       PRODUCTION ONLY, and that is not a detail. The `artifact` build
       inlines everything into one file with no host and no asset
       paths — a service worker there has nothing to cache and a scope
       it cannot claim. The `preview` build is a demo somebody opens
       once; caching it means shipping a stale fictional hotel that
       will not go away when it is replaced.

       WHAT IT CACHES: the application shell — the HTML, the JavaScript,
       the CSS, the fonts and the icon. That is what stops a dropped
       connection being a white screen, which is what it is today.

       WHAT IT DOES NOT CACHE: anything under /api. Deliberately, and
       this is the decision most likely to be undone by somebody being
       helpful later. Cached API responses and TanStack Query's own
       cache are two stores that answer the same question, and the day
       they disagree the screen shows one while the code reasons about
       the other. Reads are cached ONCE, in the query layer, where the
       age of the data can be shown to the person reading it.

       A folio balance from an unknown time, presented as current, is
       worse than no balance at all. */
    ...(demo ? [] : [VitePWA({
      /* Not autoUpdate. That activates a new worker and reloads, and a
         reload lands mid-check-in as easily as it lands on an idle
         screen. The desk is told, and chooses. */
      registerType: 'prompt',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Fidato PMS',
        short_name: 'Fidato',
        description: 'Property management for Fidato Hotels.',
        theme_color: '#df6128',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff,woff2}'],
        /* Every route is client-side, so a hard refresh on
           /h/5EL/banquet must serve index.html rather than 404. The
           same job deploy/nginx.conf does online. */
        navigateFallback: '/index.html',
        /* THE API IS NEVER SERVED FROM THE CACHE. Without this the
           fallback above answers a failed POST with the HTML shell,
           and the caller parses a page as JSON. */
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
      },
      devOptions: {
        /* Off in dev. A service worker holding the previous build is
           the single most confusing thing that can happen to somebody
           editing a screen — defect 77 is the same shape with a stale
           API, and it cost an afternoon. */
        enabled: false,
      },
    })]),
  ],
  resolve: {
    alias: {
      /* BEFORE '@', and that ordering is the whole thing. Vite walks
         the alias entries in order and takes the first match, so with
         '@' first this specific rule never fired and 271 KB of one
         property's bookings stayed in the production bundle — a real
         hotel shipping a fictional hotel's guests. Verified by
         grepping the built bundle, not by reading the config. */
      ...(demo ? {} : {
        '@/data/demo-snapshot.json':
          path.resolve(__dirname, './src/data/empty-snapshot.json'),
      }),
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    /* `virtual:pwa-register` is created by VitePWA, which runs for the
       PRODUCTION build only. The demo and artifact builds have no
       plugin and therefore no module, and Rollup resolves imports at
       build time — so the try/catch around the dynamic import in
       src/lib/sw.ts cannot save it. Both builds failed outright, and
       nothing caught it because the gate builds production and stops.

       Declared external rather than silenced: the import is genuinely
       absent here, and the guarded call in sw.ts already handles it
       being unavailable at runtime. */
    rollupOptions: demo
      ? { external: [/^virtual:pwa-register/] }
      : {},
    // The snapshot pushes the bundle past Vite's default warning. It is
    // one file on purpose; the warning is not telling us anything.
    chunkSizeWarningLimit: single ? 8000 : 500,
    /* Three builds, three directories. This was keyed to `single`, so
       `--mode preview` wrote to dist/ and overwrote the PRODUCTION
       build with demo data — the bundle deploy/launch.sh serves,
       quietly carrying a fictional hotel. */
    outDir: mode === 'artifact' ? 'dist-artifact'
      : mode === 'preview' ? 'dist-preview'
      : 'dist',
    // Everything as a data URI in the preview. An asset left on disk is
    // a second file to host, and in a single-file build it is a 404 the
    // moment anything renders it.
    assetsInlineLimit: single ? 100_000_000 : 4096,
  },
  }
})
