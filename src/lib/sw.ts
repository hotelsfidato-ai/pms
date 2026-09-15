import { toast } from "@/components/ui";

/* ══════════════════════════════════════════════════════════════════
   REGISTERING THE SERVICE WORKER

   What it buys: the application OPENS with no connection. Today a
   dropped line is a white screen, because index.html and the bundle
   are fetched every time — the offline queue underneath it never gets
   a chance to matter if the app itself will not load.

   NOT autoUpdate. Workbox's automatic mode activates a new worker and
   reloads the page, and a reload lands mid-check-in as readily as on
   an idle screen. A clerk halfway through a walk-in loses the form and
   has no idea why. The desk is told there is a new version and chooses
   its moment.

   The whole thing is behind a guard: `virtual:pwa-register` only
   exists in builds where the plugin ran, which is production only.
   Development has no worker at all, on purpose — a service worker
   serving yesterday's bundle is the single most confusing thing that
   can happen to somebody editing a screen, and defect 77 is that same
   shape with a stale API.
   ══════════════════════════════════════════════════════════════════ */

export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (import.meta.env.DEV) return;

  try {
    const { registerSW } = await import("virtual:pwa-register");

    registerSW({
      onNeedRefresh() {
        toast.info(
          "A new version is ready",
          "Reload when you are between guests to pick it up.",
        );
      },
      onOfflineReady() {
        /* Said once, plainly. It is the promise the feature makes, and
           a clerk who has not been told will not rely on it. */
        toast.success(
          "Ready to work offline",
          "The screens will open without a connection. What you do is held "
          + "and sent when the line is back.",
        );
      },
    });
  } catch {
    /* No worker in this build. Not an error — the demo and artifact
       builds deliberately have none. */
  }
}
