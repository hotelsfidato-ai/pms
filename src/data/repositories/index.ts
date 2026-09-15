/* ══════════════════════════════════════════════════════════════════
   THE SEAM — the core's half of it

   Since the service-folder move (15 September) each service keeps its own
   data calls in `src/modules/<service>/data/`, and other services reach
   them through its front door. This index carries only what belongs to no
   one service: the model's types, the business date, properties, rooms,
   notifications, your own preferences, the import report, and the query
   keys. The rule below still holds for all of it.

   Screens import from here and from nowhere else in `src/data`.
   Importing `@/data/fixtures/*` from a screen is a defect, not a
   shortcut — the CRS replaced its entire backend by rewriting this
   folder instead of touching 34 screens, and that only worked
   because nothing reached around it.

   Every function takes `hotelId` as its first argument. There is one
   property today. The signatures assume seven.

   Reads come from `src/data/store.ts` rather than straight from the
   fixtures, because the five flows have to change something: a
   check-in that does not visibly drop the arrivals count has not
   been demonstrated.
   ══════════════════════════════════════════════════════════════════ */

export * from "./types";
/* The property's operating day — core. Exported here by name, so that a
   service's data file which passes it along (stays.ts, statistics.ts) is
   never taken for its home: an explicit export wins over `export *`. */
export { BUSINESS_DATE, PTD_FROM, PTD_TO } from "./businessDate";
export * from "./properties";
export * from "./rooms";
export * from "./notifications";
/* The two shapes a write answers with, shared by every service's data. */
export type { OperationResult, AdminResult } from "./result";
export * from "./me";
export * from "./importReport";

/* ── Query keys ────────────────────────────────────────────────────
   Rule 5: `hotelId` in every TanStack Query key. Miss it and
   switching property serves the previous hotel's cache — arrivals
   for the wrong city.

   Built here so a screen cannot forget.                          ═══ */

export const queryKeys = {
  properties: () => ["properties"] as const,
  property: (hotelId: string) => ["property", hotelId] as const,
  rooms: (hotelId: string) => ["rooms", hotelId] as const,

  stays: (hotelId: string, filter?: unknown) =>
    ["stays", hotelId, filter ?? null] as const,
  stay: (hotelId: string, id: string) => ["stay", hotelId, id] as const,

  arrivals: (hotelId: string, date: string) => ["arrivals", hotelId, date] as const,
  inHouse: (hotelId: string, date: string) => ["in-house", hotelId, date] as const,
  departures: (hotelId: string, date: string) => ["departures", hotelId, date] as const,

  folio: (hotelId: string, stayId: string) => ["folio", hotelId, stayId] as const,
  folioPostings: (hotelId: string, stayId: string) =>
    ["folio-postings", hotelId, stayId] as const,
  folioBalance: (hotelId: string, stayId: string) =>
    ["folio-balance", hotelId, stayId] as const,
  openFolios: (hotelId: string) => ["open-folios", hotelId] as const,

  banquetDiary: (hotelId: string, from: string, to: string) =>
    ["banquet-diary", hotelId, from, to] as const,
  banquetEvent: (hotelId: string, id: string) =>
    ["banquet-event", hotelId, id] as const,
  banquetSetup: (hotelId: string) => ["banquet-setup", hotelId] as const,

  groups: (hotelId: string) => ["groups", hotelId] as const,
  groupMembers: (hotelId: string, groupId: string) =>
    ["group-members", hotelId, groupId] as const,

  dailyStatistics: (hotelId: string, from: string, to: string) =>
    ["daily-statistics", hotelId, from, to] as const,
  periodStatistics: (hotelId: string, from: string, to: string) =>
    ["period-statistics", hotelId, from, to] as const,
  todaySnapshot: (hotelId: string, date: string) =>
    ["today-snapshot", hotelId, date] as const,

  stayView: (hotelId: string, start: string, businessDate: string) =>
    ["stay-view", hotelId, start, businessDate] as const,
  stayViewCounts: (hotelId: string, date: string) =>
    ["stay-view-counts", hotelId, date] as const,

  housekeeping: (hotelId: string, date: string) =>
    ["housekeeping", hotelId, date] as const,
  assignableRooms: (hotelId: string, roomType: string, date: string) =>
    ["assignable-rooms", hotelId, roomType, date] as const,

  notifications: (hotelId: string) => ["notifications", hotelId] as const,

  users: (hotelId: string) => ["users", hotelId] as const,
  user: (hotelId: string, id: string) => ["user", hotelId, id] as const,
  roles: () => ["roles"] as const,
  integrations: (hotelId: string) => ["integrations", hotelId] as const,
  auditLog: (hotelId: string, from?: string, to?: string) =>
    ["audit-log", hotelId, from ?? null, to ?? null] as const,
  settings: (scope: "property" | "system", hotelId?: string) =>
    ["settings", scope, hotelId ?? null] as const,
};