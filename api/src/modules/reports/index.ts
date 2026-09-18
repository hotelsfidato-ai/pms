import type { Mount } from "../../mount.ts";
import { statistics } from "./statistics.ts";
import { reports } from "./reports.ts";
import { documents } from "./documents.ts";

/* The front door of the reports service on the server — the only file
   the core or another service may import (src/test/boundaries.test.ts).
   Its routers, and where each is mounted (see ../../mount.ts).

   `buildReport` and its types are for the master's PDF, .xlsx and CSV
   routes (the contract of 17 September): every report as one object. */
export const mounts: readonly Mount[] = [
  ["/api/hotels", documents],
  ["/api/hotels", statistics],
  ["/api/hotels", reports],
];

export { buildReport, BUILT_KEYS } from "./build.ts";
export { REPORT_KEYS } from "./document.ts";
export type {
  ReportDoc, ReportKey, ReportParams, ReportSection, ReportRow, ReportColumn,
  ReportFact, ReportChart, CellKind, Cell,
} from "./document.ts";
