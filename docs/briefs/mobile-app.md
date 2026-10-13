# The Fidato PMS mobile app (React Native + Expo) · brief for its own chat (14 Oct 2026)

**The owner, 14 Oct 03:40:** build a mobile app with **React Native and Expo**, in the same style as the
PMS, so the system works as a modern app on phones; the development lives in **D:\fidato pms moblie**
(the owner's folder name), run from its own chat.

## Where you are
- `D:\fidato pms moblie` is a **git worktree of this PMS repository**, on its own branch `mobile/app`
  (made from cp6). The whole PMS is there to read; put the app in **`mobile/`** (an Expo project).
- `CLAUDE.md`, `AGENTS.md`, `HANDOVER.md` and `docs/briefs/decisions-2026-09-27.md` apply in full:
  **no decision without the owner's yes** (ask with a recommendation, wait), **nothing leaves this
  machine** (no push, no deploy, no app-store upload), never touch or print any `.env`, no default
  prices (a missing figure is a dash), open the screen before claiming it works, Indian context.
- The main chat (the master) merges your branch when the owner says so. You never merge into cp6.
- The PMS's final launch is **15 Oct**; the app is new work alongside it - never disturb the main
  checkout, the running lanes, the local demo database `fidato`, or Postgres (never start/stop it).

## What the app talks to
- The same API: `api/` (Hono, Node 22), live at https://api.fidatohotels.com, local dev on 8787 with
  the `x-dev-staff-id` header (dev sign-in, `ALLOW_DEV_AUTH`) - for the app's own dev run use your own
  API port (e.g. 8860) and your own scratch database (AGENTS.md: `.local/dbq.sh`, never `fidato`).
- Sign-in is Firebase Auth (project in `.firebaserc`; the web config is public, `src/lib/firebase.ts`);
  every API call carries the Firebase ID token. Roles and rights: `api/src/roleGate.ts`,
  `src/lib/permissions.ts`; hotels, business date and modules come from the API.
- The look: the **fidato-design** skill (the owner-approved "Fidato custom" theme: tokens in
  `src/styles/theme.css`, brand orange / ink / grey, the Type Ladder) - carry the same tokens into the
  app; reuse the web app's data shapes (`src/data/repositories/*`, `src/modules/*/data/*`) rather than
  inventing new ones.

## First step: plan WITH the owner, before any code
Ask (AskUserQuestion, a recommendation first in each) and record the answers as a decision row:
1. Who uses the app first, and for what (e.g. housekeeping on the move, the front desk on a phone,
   the owner's figures, the restaurant waiter)? Recommend: the jobs people do away from a desk.
2. Android, iOS or both; Expo Go for trying it, a development build, and later store builds?
3. Offline: the web app has an outbox for some writes - same rules on the phone?
4. Sign-in: the same Firebase accounts and roles.
5. "The system mobile optimised": also more phone work on the web app itself, or only the new app?
Then propose a small first slice (one role, two or three screens), build it, show it running (Expo on
the PC, the owner's phone through Expo Go on the same network), and go on slice by slice.
- **Packages:** Expo and React Native are installed inside `mobile/` only (the owner asked for them);
  say which versions before installing, and never add a package to the PMS's own package.json.
- Commit locally on `mobile/app` in small steps; a short report at `.local/mobile-report.md` after
  each slice; the owner's tracker is kept by the master.
