import { defineConfig, searchForWorkspaceRoot } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'
import fs from 'fs'

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
     5173. A real environment variable, not a .env setting. */
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

    /* ── The service worker ──────────────────────────────────────────
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
    VitePWA({
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
        /* The one app bundle passed Workbox's 2 MiB default on 27 Sep
           (1.98 MB at 40c9510, 2.04 MB after Phase 1, Form III and the
           redesign), and the build refuses a file it cannot precache.
           ponytail: one bundle, a 3 MiB ceiling; split routes with
           lazy() when it nears 3 MiB rather than raising this again. */
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
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
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  }
})
