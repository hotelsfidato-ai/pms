-- =============================================================================
-- 202 · The two spare logins cannot sign in (the owner, D27-279, 4 October)
-- =============================================================================
-- 010 made pms_migrate and pms_readonly LOGIN roles with the placeholder
-- passwords printed in that file, and nothing ever changed them. pms_migrate
-- owns every table and function and has BYPASSRLS. Read-only on live, 4 Oct:
-- both could log in, nothing uses either (the API is pms_app, migrations run as
-- postgres), and Postgres listens on localhost only - where n8n runs too.
-- NOLOGIN keeps every grant and every object they own; it only stops a sign-in.
-- Roles are cluster-wide, so this holds for every database on the server.
-- A reporting tool that wants pms_readonly later gets its own login role.
-- Re-runnable.
-- =============================================================================

alter role pms_migrate  nologin;
alter role pms_readonly nologin;
