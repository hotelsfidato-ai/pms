import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAnalytics, isSupported, type Analytics } from "firebase/analytics";
import { getAuth, type Auth } from "firebase/auth";

/* ══════════════════════════════════════════════════════════════════
   FIREBASE — initialised, deliberately not yet wired to the data layer

   Firebase belongs to **Stage 3**, the auth bridge: a real sign-in
   reaches Postgres and returns only that user's properties. Stage 1
   has no data layer (Rule 1), and the point of that rule is that the
   interface gets locked before it is plumbed — otherwise Stage 3
   becomes a redesign instead of wiring.

   So this module does three things and stops:

     · initialises the app once, from environment variables
     · exposes `auth` for Stage 3 to build on
     · starts analytics, which is the one piece that is genuinely
       useful now and touches nothing else

   It does NOT read or write application data. Screens still go
   through `@/data/repositories` (Rule 2). When the auth bridge lands,
   the repositories change implementation and no screen changes.

   The config values are not secrets. A Firebase web config identifies
   the project; it does not authorise anything — access is governed by
   Firebase Security Rules and API key restrictions. They live in
   `.env` so environments can differ without a code change.
   ══════════════════════════════════════════════════════════════════ */

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

/** True when every required value is present. */
export const isConfigured = Boolean(
  config.apiKey && config.projectId && config.appId,
);

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let analytics: Analytics | null = null;

if (isConfigured) {
  app = initializeApp(config);
  auth = getAuth(app);

  /* Analytics is unsupported in some environments — jsdom under test,
     a browser blocking it, a webview. `isSupported()` settles that,
     and a failure here must never take the application down. */
  void isSupported()
    .then((supported) => {
      if (supported && app) analytics = getAnalytics(app);
    })
    .catch(() => {
      /* Analytics is optional. The product works without it. */
    });
} else if (import.meta.env.DEV) {
  console.warn(
    "[firebase] Not configured — copy .env.example to .env. " +
      "The application runs on demo data regardless; only analytics and " +
      "the Stage 3 auth bridge need this.",
  );
}

export { app, auth };

/** Analytics resolves asynchronously, so read it through a function. */
export const getAnalyticsInstance = () => analytics;

/* ── Stage 3 will build on this ────────────────────────────────────
   The auth bridge exchanges a Firebase ID token for a Postgres
   session. `staff.firebase_uid` already exists in the schema, and
   `app.current_user_id()` already accepts a Firebase uid alongside a
   uuid — migration 017 did that work.

   Until then `src/lib/ui.ts` holds a PREVIEWED role, which is a demo
   control and not identity. When real auth arrives, every
   `useUi(s => s.role)` becomes `useSession(s => s.role)` and nothing
   else changes.
   ═══════════════════════════════════════════════════════════════════ */
