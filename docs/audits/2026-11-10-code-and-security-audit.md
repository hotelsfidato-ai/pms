# Fidato PMS: code and security audit (read-only, 10 November 2026)

Asked for by the owner. Scope: branch `cp6` at `b3c24097` on this PC, and the live system
(release 21, `e77c41a8`) read only. Nothing was changed, on this PC or on the server. No `.env`
file was opened; where a settings file is mentioned, only the names of its settings were read.

## The short answer

- **No security protection has been removed.** I compared the security files and the role rules
  with 28 September. Everything taken out since then was replaced by something stronger. The one
  deliberate loosening is the owner's own (D27-387): Google is asked whether a sign-in was
  cancelled once a minute, not on every click.
- **The code's own protections are in good order.** I found no way for one hotel to read another's
  data, for a stranger to get in, or for typed text to reach the database as a command.
- **The real risks today are on the server, not in the code.** Three need the owner:
  backups never leave the server, the server has not been restarted for 69 days, and two-step
  sign-in is built but switched off.

## 1 · Act on these first

| # | What | Evidence | Who |
|---|---|---|---|
| 1 | **Backups never leave the server.** Every backup sits on the same disk as the database. If the server is lost, deleted or locked by an attacker, all 7 hotels' data goes with it. | The backup log's last six nights each end `uploaded=no`. 15 backup files, all in `/var/backups/fidato`. | Owner (release 15, Part B: the bucket) |
| 2 | **"Restore to any minute" is off on live.** Even with a good backup, up to a day's work would be lost. | `archive_mode = off`; nothing has ever been archived. | Owner (release 15, Part C) |
| 3 | **The server is running August's kernel.** Three newer ones with "Important" security fixes are installed but only take effect after a restart. Updates are set never to restart by themselves. | Up 69 days; running `204.92`, newest installed `208.112`; 7 Important notices open. | Owner: one restart at a quiet hour |
| 4 | **Two-step sign-in is off, and nobody has set it up.** The owner, 3 Admins and 6 GMs are protected by a password alone. A guessed or reused password opens every hotel. | `two_step_required = false`; 0 people enrolled. | Owner: switch it on in Settings |

Items 1 and 2 were already on the owner's list from release 15. They are still open.

## 2 · Worth fixing in the next release

| # | What | Why it matters | Fix |
|---|---|---|---|
| 5 | **The API listens on every network address**, not only the server's own. The file `deploy/nginx.conf` says otherwise. | Only the firewall keeps port 8787 private. I tested from outside: it is blocked today. If a firewall rule ever changes, the request limits and HTTPS are bypassed. | One line: start the API on `127.0.0.1`. |
| 6 | **The website's script rules are on "report only".** The enforced rule says nothing about scripts, and the reports go nowhere. | If a bad script ever got onto a page, the browser would not stop it. Risk is low today: the website has no place where typed text is shown as HTML. | Enforce the policy already written in `firebase.json`. |
| 7 | **No request limit on the signed-in API or the outside-till door.** The guest page and the booking channel have limits; `/api/` and `/api/pos` have none. | A stolen sign-in or a faulty script could flood the server. A till key cannot realistically be guessed, but attempts are unlimited. | A generous limit in nginx. |
| 8 | **Guest ID numbers are stored as plain text**, so they are in every backup file, and backup files are not encrypted. ID photos are encrypted. | 6 numbers held today; it grows with every check-in. India's data protection law expects reasonable safeguards. | Encrypt backup files before they leave the server. |
| 9 | **Four packages have published fixes.** `hono` and `@hono/node-server` (moderate), and two inside Firebase (high). | None is reachable in how the PMS uses them: no static files, no JSX on the server, no Firestore. They should still be updated. | `npm audit fix` in both folders, then the gates. |
| 10 | **80 privileged database functions can be run by any database login.** | Harmless while the API is the only login and every query is parameterised, which is the case. | Take the default permission away in one migration. |
| 11 | **An upload between 10 and 20 MB fails with a raw error page.** The API allows 20 MB; nginx stops at 10. | A clerk attaching a large scan sees a broken page, not a sentence. | Make the two limits agree. |

## 3 · For the owner to confirm

- **Three keys can log in to the server** as `opc`. Confirm all three are yours.
- **2,258 failed login attempts on SSH in 24 hours.** This is ordinary internet noise. Password
  login is off, so none can succeed. Nothing blocks repeat offenders (`fail2ban` is not running).
- **Things I could not see:** the Firebase console (password rules, who is an owner of the
  project), the Oracle console (its own firewall list, who can log in), n8n's settings, and the
  CRS and leads apps. The mobile app was not part of this audit.

## 4 · What can go wrong in day-to-day running

- **About ten seconds of errors at each release.** On 7 November two requests failed at 13:22:29,
  ten seconds before the API restarted. Probably the old API met the new database. Staff would
  see one failed screen and a retry works.
- **One server, two cores, one API process.** The timers that send messages and push to the
  booking channel run inside that one process. A second copy of the API would send everything
  twice. This is fine at 7 hotels and is the first thing to change when growing.
- **Each release replays every database change from the first.** There are 273 now. It took
  under a minute on the server on 7 November, and it grows with every release.
- **A few very large files.** `api/src/modules/pos/till.ts` is 7,182 lines and holds the
  restaurant's money logic. Large files are where a change in one place breaks another.
- **184 routes decide for themselves who may use them.** The central role table lets every role
  through to these, and the route's own check is the only one. I sampled Admin's and found them
  sound, but did not review all 184. It is where a mistake would hide, so it deserves a focused
  review in batches: Stores 23, Admin 16, Purchasing 15.
- **On this PC:** 78 working copies are on disk, two chats share one folder, and the checks time
  out when the PC is busy. The other chat's latest full run on `cp6` failed in the API tests, so
  the next release needs its own clean green run.
- **Small ones:** `/health` tells anyone the API's start time and how many screens are connected.
  A file's type is taken from what the browser says, not from its contents. A badly formed `%` in
  an address answers "Something went wrong" instead of "bad address".

## 5 · What I checked and found sound

**Who gets in**
- Every address under `/api` needs a sign-in by default. A new route with no role rule is refused
  for everybody. About 685 routes are mapped to roles, for reads as well as writes.
- The test sign-in header is ignored on live (tested). The build refuses a website with a test
  sign-in in it. The API refuses to start with test sign-in on in production.
- The guest's page: links are 32 random bytes, stored only as a hash. Wrong codes are counted in
  the database, and nginx limits it to 30 requests a minute.
- Till and booking-channel keys are stored as hashes and compared in constant time.

**One hotel cannot read another**
- All 187 tables have row security on. Seven have no rule at all, which means locked: they are
  reached only through checked functions.
- The API's database login is not a superuser and cannot bypass row security. The health check
  fails if the API ever connects as anything else.
- 1,375 database statements in the API. 160 have a piece inserted into the text; every piece is a
  fixed constant or chosen from a fixed list. None carries typed text.

**Secrets and the server**
- No secret in the repository or its history. The server's settings file is readable by the API's
  own user only.
- HTTPS only, remembered by browsers for a year. The certificate is valid to 5 February 2027 and
  renews by itself.
- A website on another address is refused by the API (tested). Port 8787 cannot be reached from
  outside (tested). No source maps on the live site.
- SSH by key only. The database listens on the server itself only. SELinux is enforcing. The API
  runs boxed in by systemd.

**The record**
- 71 tables write to the audit log; it holds 11,649 rows since 4 September. The API's
  database login has no permission to change or delete a row in it.
- Each night's backup is restored and checked before it is called a backup.
- No test is skipped or switched off. The security tests are all present.

## 6 · Limits of this audit

I did not read all 254 API files line by line. I read the core (sign-in, the role gate, the
database session, uploads, the public doors) in full and swept the rest with searches. I did not
attempt any attack beyond harmless probes from outside. A paid penetration test before selling to
other hotel groups would still be worth its cost.
