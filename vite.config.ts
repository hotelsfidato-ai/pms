import { defineConfig, searchForWorkspaceRoot } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'
import fs from 'fs'

/* The preview build is ONE html file: script, styles and the captured
   demo snapshot all inlined. That is what lets it be opened from any
   static host — or emailed — with no server, no asset paths and no
   rewrite rule to get wrong.

   Only in demo mode. The real build keeps hashed, cacheable assets,
   which is what nginx is configured for in deploy/nginx.conf. */
/** Where node_modules really is — through a junction, in a chat's copy. */
function realNodeModules(): string {
  const here = path.resolve(process.cwd(), 'node_modules')
  try { return fs.realpathSync(here) } catch { return here }
}

/** This checkout's .local and the copies beneath it, as lower-case "dir/". */
const UNWATCHED = ['.local', '.claude/worktrees']
  .map((d) => path.resolve(__dirname, d).replace(/\\/g, '/').toLowerCase() + '/')

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
  /* Each checkout's own dependency cache. The default lives in
     node_modules/.vite, which every copy shares through its junction, so one
     copy re-optimising left another's page blank with "504 Outdated Optimize
     Dep" (the Store session, 26 Sep). .local is ignored by git and the watch. */
  cacheDir: path.resolve(__dirname, '.local/vite-cache'),
  /* THE DEV SERVER TAKES THE PORT IT IS GIVEN. The preview pane assigns
     one through PORT, because on this machine 5173 is often already held
     by the CRS project's own dev server — a fixed 5173 meant the PMS
     could not start beside it. Strict when given, so the pane and Vite
     never disagree about where the app is; unset, it is Vite's usual
     5173. A real environment variable, unlike the .env files above. */
  server: {
    port: Number(process.env.PORT) || 5173,
    strictPort: Boolean(process.env.PORT),
    /* ⚠ A SERVICE CHAT'S COPY SHARES THE MAIN node_modules THROUGH A
       JUNCTION (docs/briefs/README.md). Vite follows it to the real folder,
       which is outside the copy, and refused to serve the Inter font from
       there — two 403s on every page load in every copy, and the page in a
       fallback font (reported by the store and equipment chats, 16
       September). Allowing the junction's real target fixes it; in the main
       folder it is the same folder and changes nothing. */
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd()), realNodeModules()],
    },
    /* The local Postgres writes inside .local/ all day, and every helper
       agent's copy of the repo sits in .claude/worktrees/ (D22-1). Neither
       is part of the app, so the dev server does not watch them.
       THIS folder's own two only, never a match-anywhere glob: a copy
       itself lives in .claude/worktrees, and the glob that matched that
       folder anywhere made every copy's dev server ignore its own edits
       (the front desk session, 24 Sep). */
    watch: {
      ignored: (p: string) => {
        const file = p.replace(/\\/g, '/').toLowerCase() + '/'
        return UNWATCHED.some((dir) => file.startsWith(dir))
      },
    },
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
        /* The room-card sheet's QR library (qrcode's browser.js, loaded by
           import() on the desk only) is not cached onto every guest's
           phone (D26-14). ponytail: matches any chunk named browser-*; name
           the chunk if another library ever produces one. */
        globIgnores: ['**/browser-*.js'],
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
