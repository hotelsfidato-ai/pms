# Lane F · Film 2 "A day at the hotel" (D27-306) · Sonnet

Work in **C:\videos** (git worktree of branch `videos`). Read C:\videos\RESUME.md fully first,
then `script\film2.json` (written and committed: 15 chapter videos, ~24 minutes, every scene
names its live recording or picture; the `needs` list at the end gives each one's exact
screen and state). Do not commit; the master commits.

Film 2 follows one whole hotel day, as the day check did (C:\videos\day\day.shots.mjs and
its pictures C:\videos\day\check\*.png): open the day, arrivals and check-ins, the restaurant
and room service, housekeeping, check-outs and the tax invoice (emailed when issued, only
when made out to the guest - D27-313), cash, closing the restaurant day, the night audit,
then the four daily report emails (D27-280).

**Your OWN demo, so you never disturb lanes D and E (they record on the main demo):**
1. Database `fidato_film2`: `.local\backups\fidato-before-day-check-10oct.dump` restored into
   it, then `DB=fidato_film2 bash db/migrate.sh` - both through `.local/dbq.sh` (AGENTS.md).
   Never write to `fidato`. Never start or stop Postgres.
2. API on port **8796** against it: from `D:\fidato pms\api`, PORT=8796, DATABASE_URL to
   fidato_film2 as the local `pms_app` user (its local password is in db/migrations/010_roles.sql
   - read it into a variable, never print it), CRS_N8N_URL=http://127.0.0.1:5299/webhook/pms-send
   CRS_N8N_SECRET=standin-only (the local stand-in records messages; nothing is sent).
3. Website on port **5196** talking to it: `VITE_API_URL=http://localhost:8796 npx vite --port 5196
   --strictPort` from D:\fidato pms.
4. On your demo only: switch the Tax invoice email on, and set test report addresses
   (example.test) for 5EL, so the film can show both emails.
Record with the day-check tool or record.mjs pointed at YOUR website (APP=http://localhost:5196;
its own Chrome on CDP port **9389**; never start Microsoft Edge). Voice: `node tools/voice.mjs
film2`. Render ONE video first and look at it, then the rest - and before every render check no
other `render.mjs` runs on this PC; WAIT until it has finished (poll every minute). NEVER stop a
process you did not start. Copy to `D:\fidato\final videos\Film 2 A day at the hotel\`. Stop your
own servers by their own pid and drop fidato_film2 (through dbq) when the film is done.

Every sentence must stay true to the screens; fix a script line (and re-make its voice) if a
recording shows otherwise. No npm install, no downloads; never touch any .env; nothing leaves
this machine. The PC is short of memory: keep one Chrome at a time.
Report to `D:\fidato pms\.local\lanes\f-report.md`: recordings, voice, videos rendered and copied,
script lines changed, anything wrong in the PMS seen.

**Progress log:** append a line to `D:\fidato pms\.local\lanes\progress.log` at the start, after each finished piece, at least every 30 minutes, and at the end ("DONE"; "BLOCKED: why" if stuck) - the format is in README.md.
