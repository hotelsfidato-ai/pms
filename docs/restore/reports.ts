import * as stats from "./statistics";

/* Object surface over ./statistics. The eight real reports are
   specified in docs/REPORTS-SPEC.md and land at Checkpoint 6. */

export const reportsRepo = {
  daily: stats.listDailyStatistics,
  period: stats.getPeriodStatistics,
  snapshot: stats.getTodaySnapshot,
};

export const reportRepo = reportsRepo;
