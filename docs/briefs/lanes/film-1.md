# Lane E · Film 1 "Setting up a hotel" (D27-306) · Sonnet

Work in **C:\videos** (git worktree of branch `videos`). Read C:\videos\RESUME.md fully
first, then `script\film1.json` (written and committed: 11 chapter videos, ~21 minutes,
every scene names its live recording; the `needs` list at its end gives each recording's
exact screen and state). Do not commit; the master commits.

Film 1 follows the setup wizard "Set up this hotel" (decisions D27-311, D27-312, D27-316 (6)
in D:\fidato pms\docs\briefs\decisions-2026-09-27.md) from a brand-new, empty, NON-test
hotel to "Ready to go live", including Add a room's "Several rooms" (From/To).

1. On the LOCAL demo only (web http://localhost:5173, API http://localhost:8787 - never the
   live system), create the film's new hotel the way the film shows it (Add a property; the
   local test sign-in; the local provisioning works only with a key made for the local
   database - if Add a property refuses for want of a key, say so in your report and stop
   that step rather than inventing a key; ask the master).
2. Make the recordings the script names, with the recording tool (`tools/record.mjs` takes
   steps from a shots file - write `D:\fidato pms\.claude\worktrees\manual-rest\docs\manual\
   shots\film1.mjs` like the chapter shots files, or extend record.mjs minimally; say which).
   Its own Chrome on CDP port 9387; never start Microsoft Edge.
3. Voice: `node tools/voice.mjs film1`. Then render ONE video first, look at it, then the
   rest: `node tools/render.mjs film1`; check sound (`node tools/audiocheck.mjs
   out/film1/*.mp4`); copy to `D:\fidato\final videos\Film 1 Setting up a hotel\`.
Every sentence must stay true to the screens; if a recording shows something the script
does not say (or the reverse), fix the script line and re-make its voice.

Another lane (Watch it done) uses the demo at the same time on 5 Elements Akkalkot (5EL) -
leave that hotel alone, and only one render may run at a time: before rendering, check no
other `render.mjs` is running (wait if one is). No npm install, no downloads; never touch any
.env; nothing leaves this machine. Report to `D:\fidato pms\.local\lanes\e-report.md`:
recordings made, voice, videos rendered and copied, script lines changed, anything wrong in
the PMS seen.

**Progress log:** append a line to `D:\fidato pms\.local\lanes\progress.log` at the start, after each finished piece, at least every 30 minutes, and at the end ("DONE"; "BLOCKED: why" if stuck) - the format is in README.md.
