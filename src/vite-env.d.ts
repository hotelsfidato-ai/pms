/// <reference types="vite-plugin-pwa/client" />
/// <reference types="vite/client" />

/* Typed environment. Vite only exposes vars prefixed VITE_ to the client. */
interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN: string;
  readonly VITE_FIREBASE_PROJECT_ID: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string;
  readonly VITE_FIREBASE_APP_ID: string;
  readonly VITE_FIREBASE_MEASUREMENT_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Changes with every production build, so `PersistQueryClientProvider`
    discards a persisted cache whose response SHAPE predates the code
    now reading it. Injected by `vite.config.ts`; "dev" in development,
    where a per-restart value would throw away the offline cache while
    somebody is testing offline. */
declare const __CACHE_BUSTER__: string;
