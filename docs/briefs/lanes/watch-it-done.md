# Lane D · "Watch it done" recorded into every chapter (D27-306) · Sonnet

Work in **C:\videos** (git worktree of branch `videos`). Read C:\videos\RESUME.md fully
first (its newest section explains the recording tool). Do not commit; the master commits.

The recording tool `tools/record.mjs` now takes any chapter, and 13 chapters have their
"record" lists (A0 is already recorded). Record the rest, ONE chapter at a time, on the
LOCAL demo only (web http://localhost:5173, API http://localhost:8787, printers
http://localhost:5199 - never the live system):

    export PMS="D:/fidato pms/.claude/worktrees/manual-rest" CDP_PORT=9383
    node tools/record.mjs <ch> --plan     # look first
    node tools/record.mjs <ch>
    node tools/voice.mjs <ch>             # speaks the new recordSay lines

Order: a0 (retake A0-11 only: `--only=A0-11`), then a2 a4 a6 a7 a9 a10 a11 a12 a14 a15 a16
a17. RESUME.md lists what test data each chapter's shots need (a4's stay in house, a9's
"A9 Test" items, a2's "A2 Test Kumar", a10's two test bookings, a12's decided requests,
a15's Rates days) - make it on the demo if missing and note it. For a16 check the first
frames of A16-16 do not show the real owner account. After each chapter: look at a few
frames, then render it with `node tools/render.mjs <ch> --stale`, check
`node tools/audiocheck.mjs out/<ch>/*.mp4`, and copy `out/<ch>/*.mp4` into
`D:\fidato\final videos\<the chapter's existing folder>` (replace). Renders are heavy: one
at a time, never two - before each render check no other `render.mjs` is running on this PC
(the master and Lane E render too); WAIT until it has finished (poll every minute). NEVER stop,
kill or restart a process you did not start yourself - not a render, not Chrome, not a server
(on 14 Oct 01:31 a lane killed the master's A3 render).

Never start Microsoft Edge; no npm install, no downloads; never touch any .env; never
write in D:\fidato pms except the final videos copy; nothing leaves this machine. Another
lane (Film 1) uses the demo at the same time on a NEW hotel - leave that hotel alone.
Report to `D:\fidato pms\.local\lanes\d-report.md`: each chapter recorded (clips,
seconds), rendered and copied, anything skipped and why, anything wrong in the PMS seen.

**Progress log:** append a line to `D:\fidato pms\.local\lanes\progress.log` at the start, after each finished piece, at least every 30 minutes, and at the end ("DONE"; "BLOCKED: why" if stuck) - the format is in README.md.

**14 Oct 17:35, the master:** record on **http://localhost:5180** (`APP=http://localhost:5180`), the BUILT
website copy: it answers at once, where the development server on 5173 kept freezing on the hard disk. The
database now runs from the SSD (much faster). Your runner now uses FLAGS (README.md): a wait that clears by
itself is never a reason to stop - wait and poll.
