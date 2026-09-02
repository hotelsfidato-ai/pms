# MASTER — Fidato PMS

**This is the complete handoff file. A fresh agent needs nothing else to continue.**

Everything below was established in the session of **26 August 2026**. Where this file and the
code disagree, **the code is what shipped** — fix this file.

| | |
|---|---|
| Project | Property Management System · **7 owned Fidato properties · 175 rooms** (~25 each) |
| Location | `D:\PMS FIDATO` |
| Reference system | `D:\fidato crs` — design system, stack conventions, process framework |
| Status | **10 migrations written, never executed.** No application code. |
| Active phase | **Phase 1.1** — blocked on Docker Desktop not starting |
| Decided by | Claude Opus 5, 26 Aug 2026 |

**Contents**
[1 What this is](#1) · [2 Commercial position](#2) · [3 Protocol](#3) · [4 Stack](#4) ·
[5 Architecture](#5) · [6 Infrastructure](#6) · [7 Design system](#7) · [8 Traps](#8) ·
[9 Review findings](#9) · [10 Build plan](#10) · [11 References](#11) · [12 State](#12) ·
[13 Handoff](#13)

---

<a name="1"></a>
## 1 · What this is, and what it is not

Fidato runs two systems. Confusing them builds the wrong thing.

| | **CRS** (`D:\fidato crs`) | **PMS** (this project) |
|---|---|---|
| Properties | 32 **partner** properties Fidato does not own | 7 **owned** properties |
| Does | Sells room nights into someone else's inventory | Runs the property — front desk, housekeeping, POS |
| Occupancy | Never from reservations — Fidato books a *slice* | Normal derivation; Fidato owns every room |
| State | Phase 2 deployed, in use, Firebase/Firestore, Spark plan | Not started |
| Repo | `github.com/hotelsfidato-ai/Crs-Test-` (public) · Firebase `crstest-9a0c5` | — |

The CRS's own `CLAUDE.md` states it is **not** a PMS. Do not copy its data model. Copy its
design system, stack, and process framework — all three are good.

**The user works with the company that wants this built.** It is not a solo side project, which
materially reduces the bus-factor risk raised during review.

---

<a name="2"></a>
## 2 · Commercial position — the decision this rests on

### Build vs buy

Building survives **only because of the quoted price**.

| | Cost |
|---|---|
| eZee, **as quoted** | ₹1 lakh per property per year = **₹7 lakh/year** |
| eZee, at fair market | ₹2,000–8,000/property/month = **₹2.5–3.8 lakh/year** |
| Hotelogix | ₹250–599/room/month, per-property minimum ≈ **₹5.3 lakh/year** |
| Build | **₹4–8 lakh once**, then ~₹1.2 lakh/year |

At ₹7 lakh, break-even is **14–18 months** and three-year saving is ₹9.4–13.4 lakh.

> ⚠️ **₹1 lakh/year is ₹8,333 per property per month — the top of the Indian market for
> 25-room properties, and ~3.7× eZee's own entry pricing. THE QUOTE HAS NEVER BEEN
> NEGOTIATED.** If it lands **below ~₹4 lakh/year for the group, buy and stop this project.**
> This is the single highest-leverage open item.

### The channel manager — settled, act on it

| | Per month | Per year |
|---|---|---|
| Current — ₹5,000 **per property** × 7 | ₹35,000 | ₹4.2 lakh |
| STAAH at ₹50/room × 175 | ₹8,750 | ₹1.05 lakh |
| **Saving** | **₹26,250** | **₹3.15 lakh** |

They pay ₹200/room; STAAH offers ₹50. **Take it** — independent of the PMS decision. Verify
like-for-like on channels and booking engine first. STAAH is a **channel manager, not a PMS**;
it integrates with 250+ PMSs.

### The real long-term case

Not seven properties — **thirty-nine**. If eZee quotes Fidato ₹1 lakh/property, it quotes the
32 partners similarly. A Fidato PMS at ₹40–50k/year undercuts by half. Ten partners converting
is ₹4.5 lakh/year on top of ₹5.8 lakh saved internally.

That means **becoming a software company** — support obligations at 22:00 at properties you do
not own. Sequence it: run the seven first, sell second.

---

<a name="3"></a>
## 3 · Operating protocol — strict

Violating one of these is a defect regardless of whether the code works.

### 3.1 Tests before solutions
**Write the failing test first. Run it. Watch it fail. Then implement.** This is the guard
against code that looks correct and was never executed. A test written afterwards tests what
the code does, not what it should do.

### 3.2 Never claim unrun code works
**"Written but unrun" is an acceptable status. "Done" applied to unexecuted code is a lie.**
If a tool is unavailable, say so and stop — never substitute a plausible-looking result.

### 3.3 One sub-section at a time
Do not generate ahead. Finish, show, confirm, move on.

### 3.4 The repository seam is absolute
`React UI → @/data/repositories → driver → Postgres`. Screens import **only** from the barrel.
This is why the CRS swapped its entire backend by replacing one folder instead of rewriting 34
screens.

### 3.5 Business rules live in `src/lib/rules.ts` only
A rule duplicated in a component will drift, and the copy nobody remembers is the one that runs.

### 3.6 Report failures honestly
Show failing output. Name skipped steps. No silent scope reduction.

### 3.7 Agent-phase rules
- Migrations are **additive and immutable** — never edit an applied one
- Each phase **publishes a contract** to `docs/CONTRACTS.md`
- **No phase edits a previous contract**
- **Exit gate output must be pasted** before a phase is complete
- `main` builds at every phase boundary

Full list: **`docs/CONSTRAINTS.md`** — 25 numbered constraints.

---

<a name="4"></a>
## 4 · Stack — decided

### Frontend (carried from CRS, proven in production)
React 19 · Vite · TypeScript **strict** · Tailwind v4 · React Router v7 · TanStack Query v5 ·
Zustand · Radix UI · react-hook-form + Zod · Recharts · Inter Variable

### Database
**PostgreSQL 13+, use 17.** Floor is set by RLS and `on conflict` (both 9.5). Deliberately
portable: `gen_random_uuid()` via the `pgcrypto` extension rather than assuming built-in, and
triggers use `drop … ; create …` rather than `create or replace trigger` (which needs 14+).

**Rejected:** Firestore (no multi-table transactions, no aggregation, bills per document read —
the CRS trap list already records *"a report that reads all reservations costs one read per row,
per view"*). MongoDB (wrong shape, M0 has no backups, 100 ops/sec).

### Firebase hybrid — approved

| Service | Verdict | Why |
|---|---|---|
| **Auth** | ✅ Use | 50,000 MAU free |
| **Hosting** | ✅ Use | 10 GB storage, 360 MB/day transfer, CDN + SSL |
| **Firestore** | ❌ No | Data is in Postgres. Two sources of truth is the bug. |
| **Storage** | ❌ Unavailable | **Removed from Spark 3 Feb 2026** — needs a billing account |
| **Functions** | ❌ Not needed | The VPS is the server |

**Firestore rules cannot protect Postgres data.** RLS does that.

**This resolves the CRS's Blaze blocker.** `docs/supabase/register-security.md` records that
custom claims need the Admin SDK → needs a server → needed Blaze. A VPS is that server.

**No schema change needed** — `app.current_user_id()` reads either the JWT `sub` claim or a
`SET LOCAL app.user_id` session variable.

> ⚠️ **One change IS required:** Firebase UIDs are 28-char strings, not UUIDs. Add
> `firebase_uid text unique` to `staff`. **Do not change `staff.id`** — every FK points at it.

---

<a name="5"></a>
## 5 · Architecture

### Multi-tenancy: one schema, `hotel_id`, RLS

All 7 properties in one database, one schema. Every operational table carries
`hotel_id not null`. Isolation enforced by Row Level Security, which rewrites every query.

**Rejected alternatives:**

| Model | Rejected because |
|---|---|
| Schema per hotel | Migrations ×7, drift, `UNION ALL` for group reports |
| **Table set per hotel** | Puts `CREATE TABLE` in a web request; group dashboard becomes dynamic SQL; isolation depends on the app concatenating a table name |
| Database per hotel | Cross-hotel reporting impossible without a warehouse |

The legitimate version of "separate storage per property" is **declarative partitioning**
(`partition by list (hotel_id)`) — one logical table, separate physical storage. Not needed at
7 properties; **addable later without changing application code.**

### The expensive line: group-level vs hotel-scoped

**Group-level (no `hotel_id`):** `hotels`, `staff`, `staff_hotels`, `guests`, `companies`,
`room_type_templates`

**Hotel-scoped (`hotel_id not null`):** `room_types`, `rooms`, `room_status_log`,
`reservations`, `folios`, `folio_postings`, `night_audit_runs`

Guests are group-level deliberately: one person across seven properties, or you lose history,
loyalty, and a blacklist that can be walked around by booking elsewhere.

### Adding a property is DATA, never DDL
`app.provision_property()` clones ~90% from templates; you supply the ~10% unique. No migration,
no deploy, no restart.

### M4 resolved — how the browser reaches the API

For a while `deploy/launch.sh` served the frontend off the VPS on one origin.
That removed the CORS question instead of answering it, and it contradicted the
Hosting ✅ above without saying so. Reverted; the approved shape is what ships.

| | Served by | Address |
|---|---|---|
| The app | Firebase Hosting | `pms.…` (or the free `web.app`) |
| The API | Oracle, nginx → 127.0.0.1:8787 | `api.…` |

Four clients already speak to this API — the staff app, the admin console, the
tills and the CRS — so **one shared origin was never a design that could hold**.
The decision is not hosting convenience; it is that the API is the contract.

Three things make the split safe, and all three are checked rather than assumed:

* **`CORS_ORIGIN` is a LIST** (`api/src/env.ts`). A single string capped the
  system at one browser client forever.
* **`maxAge: 86400`** (`api/src/server.ts`). Without it Chrome re-preflights
  about every five seconds, so a busy front desk pays a round trip continually.
* **The preflight checks every origin** and names the offending entry. A
  mismatch renders a blank screen with no error a clerk can report, which is the
  single worst failure mode this shape introduces.

**The frontend resolves the API address at RUNTIME**, from a `config.json` beside
`index.html` (`src/lib/api.ts`). Vite inlines `VITE_*` at build, so baking it in
meant moving the backend forced a rebuild of every client — the one thing that
genuinely tied this system to a vendor. Editing that file and redeploying static
assets is now the whole failover procedure: seconds, no rebuild, no DNS wait.

### Runtime topology

```
Staff browser ──sign in──> Firebase Auth ──ID token──> App API
                                                        │ verify token
                                                        │ SET LOCAL app.user_id
                                                        │ connects as pms_app
Admin portal ───────────────────────────> Admin server  │ connects as pms_admin
                                                        │
                                            ┌───────────┴───────────┐
                                            │  RLS — both paths     │
                                            │  hotel_id in          │
                                            │  auth_hotel_ids()     │
                                            └───────────┬───────────┘
                                                        ▼
                                                   PostgreSQL
```

**Firebase stores credentials, not users.** It answers *who are you*. Postgres answers *what may
you do* (`staff`, `staff_hotels`, under RLS). Linked by `firebase_uid`. Roles never live in
Firebase; custom claims may cache them but never own them.

**Both paths pass through RLS.** The admin sees all seven because its staff row is
`is_group_admin`, not because it bypasses the gate — `force row level security` filters even the
table owner.

### Roles

| Role | May do | Used by |
|---|---|---|
| `pms_migrate` | DDL — owns the schema | Migration runner, by hand only |
| `pms_admin` | Create users, provision properties | Admin server |
| `pms_app` | Rows only — **cannot** create/alter/drop | The React app |
| `pms_readonly` | Select only | Reporting, BI |

The control that matters is **which role the connection uses**, not which port the admin panel
listens on.

> ⚠️ **Guard the admin server.** It holds a Firebase service account key and a privileged DB
> role. Bind to localhost behind an SSH tunnel, or its own authenticated subdomain. Never the
> app's public route, never sharing the app's environment.

---

<a name="6"></a>
## 6 · Infrastructure

### Free tier research (verified 26 Aug 2026)

| Provider | Free tier | Verdict |
|---|---|---|
| **Neon** | 100 CU-hr + 0.5 GB **per project**, 100 projects | Dev only — 100 CU-hr ÷ 0.25 CU floor = 400 awake hours ≈ 13 hr/day. A 24/7 front desk exhausts it ~**day 15**, then compute suspends. 6-hour PITR. |
| **Supabase** | 500 MB, **2 projects**, pauses after 7 days idle, **no backups** | Free disqualified. **Pro $25** = Postgres + Auth + Storage + Realtime + RLS. |
| **CockroachDB** | 50M RU + 10 GiB | Most generous raw allowance, but distributed SQL ≠ full Postgres, RU budgeting opaque, bare DB. |
| **MongoDB M0** | 512 MB, 100 ops/sec, 1 cluster/project, **no backups** | Wrong shape, no safety net. |
| **Prisma** | 200k ops/month, 500 MB, **no backups** | ~950 ops/hotel/day. One check-in is 10–15. Lasts days. |
| **DigitalOcean** | None; from $15/mo, free daily backups | Solid, predictable, but DB only. |

**The blocker across free tiers is backups, not storage.** 7 hotels generate ~2,000–2,500
rows/day ≈ **150–200 MB/year**. Storage is never the constraint.

### Oracle Always Free

- Mumbai and Hyderabad regions, arm64 Ampere A1
- **HALVED 15 June 2026** from 4 OCPU/24 GB to **2 OCPU/12 GB — with no announcement.**
  Over-limit instances **terminated from 18 August 2026**.
- **Idle reclamation:** instances below **20% CPU at the 95th percentile over 7 days** may be
  reclaimed. A quiet Postgres *will* look idle. Co-locate app, n8n and scheduled jobs to raise
  baseline CPU legitimately. Do not use CPU-burn scripts.
- **Pick Compute (Ampere A1), NOT "Autonomous Database"** — the latter is Oracle Database, not
  Postgres, and would invalidate the entire schema.

### Hostinger VPS — DO NOT USE FOR PRODUCTION

| | |
|---|---|
| Plan held | **KVM 2** — 2 vCPU, 8 GB, 100 GB NVMe, 8 TB bandwidth |
| Price | ₹799/mo now, **₹1,199/mo renewal** (₹14,400/year) |
| IP / host | `72.61.169.92` · `srv1114484.hstgr.cloud` |
| Region | Mumbai available |

**Diagnosed 26 Aug 2026:** server alive (80/443 open), IP correct, **user's ISP is fine**
(github.com:22 connects). **SSH ports 22/2222/2200/22022/62222 all filtered** — a firewall
drops them. Only 80/443 open. **Traefik is running with an n8n instance at
`n8n.srv1114484.hstgr.cloud`** (live, owner account already created, SMTP unconfigured so no
email password reset).

> ⚠️ **Someone else built this box.** The user has no hPanel access, so the firewall cannot be
> changed. Those n8n workflows may be wired to the live CRS — the CRS lists Phase 2.5 as
> *"blocked on DNS and a Supabase key"*, which this box may already resolve. **Find the owner
> before touching anything.**

**Capacity if it were usable:** disk 100 GB vs ~5 GB/year needed; bandwidth 8 TB vs ~30 GB/mo;
CPU low single digits. **RAM is the only resource to plan** — Postgres 2–3 GB plus Coolify, n8n,
Docker and OS 2–3 GB. Full self-hosted Supabase on top is tight; drop imgproxy, Edge Runtime and
the Logflare/Vector override. Give Postgres CPU priority and schedule n8n away from the checkout
rush and night audit.

### Where things should run

| Stage | Where |
|---|---|
| Development | **Local Docker Postgres** — fastest loop, fully controlled |
| Staging | Oracle Always Free, Mumbai |
| **Production** | **A paid instance with a contract.** A database is the worst thing to run free and the best thing to pay for. |

**Backups are non-negotiable:** nightly `pg_dump` to Cloudflare R2 or Backblaze B2 (both 10 GB
free), **off-box**, restored once on purpose before go-live. See finding **C3** — nightly alone
is an inadequate RPO for a ledger.

---

<a name="7"></a>
## 7 · Design system — Fidato

Source of truth: `D:\fidato crs\docs\design-system.md` and `src/styles/theme.css`.

| Token | Hex | Used for |
|---|---|---|
| `ink-900` | `#031728` | Fidato Black — sidebar, headings, primary text |
| `brand-orange` | `#DF6128` | Primary action, active navigation |
| `brand-tangerine` | `#EB8C00` | Secondary accent, second chart series |
| `brand-yellow` | `#FFB600` | Pending, warning |
| `brand-rose` | `#DB536A` | Attention, no-show |
| `brand-red` | `#E0301E` | Destructive, error, overdue |
| `success` | `#1F6F5C` | Confirmed, paid, reconciled — **documented departure** |
| `grey-700` | `#354552` | Body text |
| `grey-500` | `#67737E` | Secondary text |
| `grey-400` | `#9AA2A9` | Tertiary text, icons |
| `grey-300` | `#CCD0D4` | Borders, disabled |

Surfaces: page `#F7F8F9`, cards white, hairlines `#E6E9EC`.
Logo gradient `#FE611F → #F4BF54` — mark, collapsed rail, one hero accent. **Never on buttons.**

**Type scale:** `text-2xl` 24 KPI · `text-xl` 20 page titles · `text-lg` 18 sections ·
`text-md` 15 card titles · `text-base` 14 body/tables · `text-sm` 13 secondary ·
`text-xs` 12 captions · `text-2xs` 11 pills

**Two documented departures:** `success` green added (brand has five warm colours and nothing
for "this went well"); **Inter** replaces Georgia + Arial in the interface. **Georgia is
retained for printed documents** — invoices, report covers, briefings — via `.print-serif`.

**Visual language:** 8pt grid, radius 10px · **hairline borders, never shadows** (shadows only
on things that float) · colour reserved for status and one accent · 150–200 ms ease-out, nothing
bounces · dense tables, quiet rows, no zebra striping · `.tabular` figures on every comparable
number.

**Behaviour:** blocked actions shown **disabled with a reason, never hidden** (`{ allowed,
reason }`) · **forbidden, not 404** · empty ≠ no-results · one primary button per view.

**Brand mark:** `logo-full.svg` / `logo-mark.svg` used **verbatim** — never recoloured, redrawn
or stretched. One "O" of clear space.

---

<a name="8"></a>
## 8 · Traps

| Trap | Where |
|---|---|
| `business_date` ≠ calendar date — a 01:40 bar bill belongs to yesterday | `006_folio.sql` |
| Never update or delete a posting; post a reversal | `006_folio.sql` |
| Money is `numeric(12,2)`, never float | `006_folio.sql` |
| Night audit must be idempotent and advisory-locked | `006_folio.sql` |
| `occupancy_status` and `housekeeping_status` are independent | `003_rooms.sql` |
| A reservation is for a room **type**; a stay is in a **room** | `005_reservations.sql` |
| Every index on a scoped table must **lead** with `hotel_id` | `003_rooms.sql` |
| `security definer` without pinned `search_path` is privilege escalation | `002_tenancy.sql` |
| GST is per **line**, not per folio | CRS `lib/rules.ts` |
| Put `hotelId` in every TanStack Query key | §5 |
| **A superuser bypasses RLS entirely** — `force row level security` does not change it. Testing isolation as `postgres` returns every property's rows and proves nothing | `007_rls.sql` |
| `010` re-creates `provision_property` from `009` and wins. Editing 009 alone changes nothing | `009` / `010` |
| `add constraint` has no `IF NOT EXISTS` — guard it in a `DO` block or the file breaks on re-run | `005_reservations.sql` |

### Machine-specific — this Windows box

- **Never round-trip a file through PowerShell 5.1.** `Get-Content` without `-Encoding` decodes
  as ANSI and mangles UTF-8. Corrupted nine CRS files and survived a typecheck, a build and 103
  tests. **Use python/perl or the editing tools.**
- **AVG Web/Mail Shield intercepts TLS** — confirmed from a cert issuer during diagnostics. This
  is why `npm install` must run from PowerShell, not Git Bash.
- **`tsc --noEmit` reports zero errors on a broken build** — `tsconfig.json` is a solution file
  with project references. Always `tsc -b`.
- **Python needs Windows paths** (`D:\...`), not Git Bash `/d/...`.
- **Set `PYTHONIOENCODING=utf-8`** or printing non-ASCII raises `UnicodeEncodeError` (cp1252).
- **Docker Desktop will not start** — launched, waited 3 minutes, daemon never came up. Likely
  needs a login or WSL prompt. **This is the current blocker.**

---

<a name="9"></a>
## 9 · Review findings — 15 open

Full detail: `docs/architecture-review.html`. Four are defects in work produced this session.

### Critical — fix before a real guest

| # | Finding |
|---|---|
| **C1** | **Guest passports readable by all staff at all properties.** `007_rls.sql` uses `using ( app.is_active_staff() )` on `guests`, exposing `id_number`, `passport_expiry`, `visa_number` group-wide. DPDP exposure. *Group-level storage was right; the read policy is not.* **Fix in Phase 1.** |
| **C2** | **Session-mode connection pooling leaks `SET LOCAL app.user_id`** onto the next request → cross-property data leak. Transaction mode only, asserted at start-up, with a two-user pooled test. |
| **C3** | **Nightly backups = 24-hour RPO on money.** Needs WAL archiving (pgBackRest/WAL-G → R2) for an RPO in minutes. Write RPO/RTO as numbers and test them. |
| **C4** | **No idempotency key on `folio_postings` / `pos_bills`.** Offline tolerance guarantees retries; a retry is a second charge. **Fix in Phase 1** — expensive once postings exist. |

### High

| # | Finding |
|---|---|
| **H1** | One server, no replica, no stated RTO, no documented paper fallback |
| **H2** | Piloting real guests on Oracle Free is wrong — a pilot has real money |
| **H3** | **No audit trail.** Only `room_status_log` exists. Needs trigger-based `audit_log` |
| **H4** | Phase plan built screens before the folio engine — contradicts `README.md`. **Fixed in the 13-phase plan** |
| **H5** | `next_reference()` full-scans reservations with a per-row regex under a lock. Use a `hotel_counters` table |
| **H6** | No `schema_migrations` table — no way to ask an environment its version |

### Medium
**M1** secrets management undesigned · **M2** no DPDP retention/deletion policy ·
**M3** business-date boundary rule unspecified · ~~**M4** Firebase↔VPS CORS undesigned~~ **designed — see below** ·
**M5** no rate limiting; staff offboarding has two undocumented steps

### Confirmed sound (12)
Postgres over Firestore · append-only ledger · `EXCLUDE` double-booking · single schema + RLS ·
rejecting table-per-property · guests group-level *(storage)* · role separation ·
`business_date` as a column · `numeric` money · Firebase Auth + Postgres · admin server ·
repository seam

---

<a name="10"></a>
## 10 · Build plan — 13 gated phases

Full detail: `docs/build-plan.html`. **Vertical slices, not horizontal layers** — the original
all-UI-then-all-backend order produces nothing runnable until the end and is the worst order for
agents, since no agent's work is exercised by another's.

| Phase | Scope | Weeks | Exit gate |
|---|---|---|---|
| **0** | Governance — the habit files | 0.5 | A cold agent can state the current phase and its gate |
| **1** | Foundation — schema runs, **fix C1, C4, H5, H6** | 1 | Migrations apply; smoke test fails in exactly 2 designed places; RLS tests prove isolation |
| **2** | Auth spine — Firebase → RLS, **assert C2** | 1 | Real sign-in returns only that user's properties; two-user pooling test passes |
| **3** | Domain data — your templates + app shell | 1 | 7 real properties seeded; roles show correct nav; switcher works |
| **4** | **Slice: front desk + folio** | 3 | A guest booked → checked in → charged → paid → checked out, folio balances |
| **5** | Slice: night audit | 2 | Run twice, posts once; 01:40 charge lands on previous date |
| **6** | Slice: housekeeping (mobile-first, offline) | 2 | Status survives a dropped connection, replays once |
| **7** | Slice: **POS integration — buy the POS** | 2 | Restaurant bill posts to folio with its own GST band |
| **8** | Slice: billing, GST, Form C, police register | 2 | Invoice with 12% and 5% lines totals correctly |
| **9** | Slice: rates + STAAH | 2 | Availability reaches OTAs; OTA booking creates a reservation |
| **10** | Slice: group overview + reports | 2 | Group figures reconcile against each day-close |
| **11** | Slice: **CRS bridge** — the only unique thing | 2 | Owned-property availability appears in the CRS |
| **12** | Hardening + go-live | 3 | WAL restore performed and verified; RTO measured; one property runs a week |

**~24 weeks to all seven.** The number that matters is **week 11** (end of Phase 6) — one
property could genuinely operate. Everything after adds value to a running system.

**Inventory/stores deliberately excluded** — a 300-room problem. A spreadsheet serves 25-room
properties for two years. Add as Phase 13 if asked.

### The agent-safety contract
Migrations additive and immutable (checksum in `schema_migrations`) · each phase publishes to
`docs/CONTRACTS.md` · no phase edits a previous contract · **exit gate output must be pasted** ·
`main` builds at every boundary.

### The habit framework — from the CRS

`D:\fidato crs\docs\FIELD-GUIDE.md` maps **15 habits from *Don't Just Trust the AI. Trace It.***
to files. Replicate for the PMS:

| # | Habit | File | Status |
|---|---|---|---|
| 1 | Handover | `docs/HANDOVER.md` | **to write** |
| 2 | Decisions | `docs/DECISIONS.md` | **to write** |
| 3 | Explicit comments | the source | done in migrations |
| 4 | Flow | `docs/FLOW.md` | **to write** |
| 5 | Traces | `docs/traces/` | **to create** |
| 6 | Architecture | `docs/architecture.html` | done |
| 7 | Constraints | `docs/CONSTRAINTS.md` | done |
| 8 | Test checklist | `docs/TEST-CHECKLIST.md` | **to write** |
| 9 | Rollback | `docs/ROLLBACK.md` | **to write** |
| 10–15 | Read the diff · why before what · small requests · session summary · version-pin context · own the mental model | habits, not files | — |

Plus two the CRS did not need: `docs/CONTRACTS.md` and `docs/GATES.md`.

> ⚠️ **The failure mode of these files is staleness, not incompleteness.** The CRS's own
> `CLAUDE.md` spent weeks claiming Phase 2 was undeployed after it shipped. **Rewrite
> `HANDOVER.md` every session — never append.**

---

<a name="11"></a>
## 11 · References

### Sawai demo — `https://sawai-demo-woad.vercel.app` (no login)

Two pages: `login.html` → `console.html`. ES modules, hash router, `js/store.js` + `js/ui.js`,
role in `localStorage`.

**7 roles:** owner, gm, frontdesk, waiter, kitchen, housekeeping, finance
**8 routes:** overview, reservations, frontdesk, dining, kitchen, billing, requests, payments

**Three things confirm the architecture independently:** a property switcher with crest/name/
city; routes labelled **"The Group" vs "Property"** in the breadcrumb (the group-level vs
hotel-scoped split surfaced in UI); role→route permission sets.

**Missing from the demo:** housekeeping room-status board (models housekeeping as service
*requests* only), night audit, rates, channel manager, inventory. **UI target, not scope.**

### WinCloud — `https://mu6.wincloudpms.net/WinLogin/Login/indiandemo`
Credentials were supplied. **I do not enter passwords into login forms, including ones the user
owns and supplies.** The user should sign in and send screenshots. Same for the eZee by Yanolja
screenshots — that is the better medium for a functional reference.

### Verified pricing sources (26 Aug 2026)
neon.com/pricing · supabase.com/pricing · cockroachlabs.com/pricing · mongodb.com/pricing ·
prisma.io/pricing · digitalocean.com/pricing · hostinger.com · oracle.com/cloud/free ·
Firebase Spark limits · eZee/Hotelogix/IDS Next Indian market pricing

---

<a name="12"></a>
## 12 · Current state

### Files in `D:\PMS FIDATO`

```
MASTER.md                          ← this file
PMS-MASTER-GUIDE.md                operational contract
README.md                          orientation + reading order
pms-architecture-decision.html     build-vs-buy, hosting, costs
db/migrations/
  001_foundation.sql               extensions, current_user_id, touch, forbid_mutation
  002_tenancy.sql                  hotels, staff, staff_hotels, auth_hotel_ids()
  003_rooms.sql                    room_types, rooms, room_status_log
  004_guests.sql                   guests, companies  (GROUP-LEVEL)
  005_reservations.sql             reservations + EXCLUDE double-booking + next_reference()
  006_folio.sql                    folios, folio_postings (append-only), night_audit_runs
  007_rls.sql                      RLS policies + verification queries
  008_seed.sql                     TEMPLATE — placeholders, plus smoke test
  009_provisioning.sql             templates + provision_property() + bulk_create_rooms()
  010_roles.sql                    pms_migrate / pms_app / pms_readonly + require_group_admin()
docs/
  CONSTRAINTS.md                   26 numbered constraints
  architecture.html                runtime topology + diagram
  architecture-review.html         15 findings
  build-plan.html                  13 gated phases
  oracle-capacity.html             Always Free capacity vs the workload
  architecture-canvas.html         EDITABLE canvas — saves its own state
  pms-briefing-print.html          → Fidato-PMS-Briefing.pdf (8pp, Georgia, branded)
  Fidato-PMS-Briefing.pdf          224 KB, generated
```

**Published artifacts** — the canvas is the live one; edits made in it are saved
into that artifact, not into this repo. Read it back before assuming the layout here
is current.

### Published artifacts
- Decision doc — `claude.ai/code/artifact/21b46be7-9c9f-4085-8a2d-f04826315ceb`
- Architecture — `claude.ai/code/artifact/15b1f624-be98-4d6d-a5c3-162f3828a1ce`
- Review — `claude.ai/code/artifact/6e007d18-dce8-42ba-bc3e-0ae2c6e1abd9`
- Build plan — `claude.ai/code/artifact/512824a5-a8f6-4b77-976c-6a601709a290`

### Not done
- **Migrations have NEVER been executed.** Docker Desktop would not start.
- No tests exist
- No application code
- 7 real properties are placeholders in `008_seed.sql`
- Oracle VPS not claimed
- **eZee renegotiation still open** — the decision rests on it
- STAAH deal not yet taken
- Phase 0 habit files: 6 of 9 still to write

### What could not be verified
All findings come from **reading, not running**. A real execution may surface more.

---

<a name="13"></a>
## 13 · Handoff

A new session should:

1. **Read this file completely.**
2. Check §12 — **trust the code over this file.**
3. Confirm the active phase and its entry gate before writing anything.
4. Re-read §3 and `docs/CONSTRAINTS.md`. The protocol is the point.
5. **Rewrite §12 before ending the session.** Do not append.

### Immediate next action

**Phase 1.1** — start Docker Desktop, then:

```bash
docker run --name fidato-pg -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=fidato -p 5432:5432 -d postgres:17
```

```bash
cd "/d/PMS FIDATO" && for f in db/migrations/*.sql; do docker exec -i fidato-pg psql -U postgres -d fidato -v ON_ERROR_STOP=1 < "$f" || break; done
```

Then the `008_seed.sql` smoke test — **steps 5 and 6 must fail loudly.** That is the proof the
safety nets are wired.

**Nothing else starts until those ten migrations apply clean.**

### What no handover carries

| Carried | Not carried |
|---|---|
| Decisions and their rejected alternatives | The conversation that produced them |
| The trap list | The hours spent finding each trap |
| Findings and their fixes | The judgement that ranked them |
