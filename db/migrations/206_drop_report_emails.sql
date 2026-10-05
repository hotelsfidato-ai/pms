-- =============================================================================
-- 206 · The old report_emails goes (the owner's D27-282 (1), scheduled by
--       D27-284 (5), 5 October)
-- =============================================================================
-- D27-261's reports to staff's own sign-in emails were never released;
-- D27-280's daily report emails (204, daily_report_emails) replaced them.
-- Nothing reads 193's report_emails or app.report_emails_owed. The function
-- first: its body names the table. The table takes its policies and its
-- activity-log trigger with it.
--
-- Re-runnable.
-- =============================================================================

drop function if exists app.report_emails_owed(integer, uuid);
drop table if exists report_emails;
