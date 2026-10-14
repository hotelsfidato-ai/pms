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

**Unblocked (14 Oct 01:40, the master):** the LOCAL demo now has a test provisioning key for Add
a property - read it from `D:\fidato pms\.local\lanes\local-provisioning-key.txt` (local database
only; never print it into a report or a log line). The local API on 8787 already has the wizard
route (GET /api/hotels/5EL/setup answers 200). The GST figures and the film hotel's GSTIN come
from the owner - see the line below once the master adds it; until then record every scene that
does not need them.

**The owner's figures (14 Oct 01:45):** GST on rooms the same as the demo hotel - 5% on a room up
to ₹7,500 a night, 18% above ₹7,500. The film hotel keeps the standard DUMMY GSTIN: the film
shows the wizard catching it ("a real GSTIN" still missing), and ends with step 1 still to do -
say so plainly in the script (the owner chose this; do not invent a real-looking GSTIN).

**14 Oct 12:50, the owner (D27-321):** the practice figures are approved - rooms 3,000 and 4,000,
extra bed 600, discount 10%, commission 15% - typed into the practice hotel only, never read aloud
as advice (the voice says "your price", not the number).

**14 Oct 14:58, the master:** 5EL is restored (your F1-02/03 saves are undone). Go: add a guard to every
group (stop if the page does not show "Practice Hotel Nashik"), find why the hotel pick reset to 5EL after a
page load (if it is a PMS fault, report it), then retake F1-02 onwards on PHN.

**14 Oct 15:35, the master (D27-263, D27-322):** a new hotel has NO room types, by the owner's decision -
not a fault. Step 3 of Set up this hotel is To do on PHN; the script's step-3 lines must say the hotel adds
its room types there. After the final release the Add a property message reads "No room types yet - add
them in Set up this hotel."

**14 Oct 17:35, the master:** record on **http://localhost:5180** (`APP=http://localhost:5180`), the BUILT
website copy: it answers at once, where the development server on 5173 kept freezing on the hard disk. The
database now runs from the SSD (much faster). Your runner now uses FLAGS (README.md): a wait that clears by
itself is never a reason to stop - wait and poll.
