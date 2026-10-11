# The video series: where it stands (12 October; the 10 October notes follow)

## 12 October: the move back to the original desktop (D27-303)

The owner decided this on 12 Oct; it replaces D27-294's "never committed"
for the code only.
- **On GitHub:** this folder's code and scripts are on their own branch,
  `videos`, in github.com/hotelsfidato-ai/pms. That branch has no PMS code.
  It holds `script\`, `src\` (with `src\data\`), `tools\*.mjs`,
  `day\*.mjs`, this file and the config files.
- **Not on GitHub:** the large generated files come by hand in
  `videos-generated.zip`:
  - `public\` (voices, pictures, recordings);
  - `out\` (finished videos);
  - `tools\piper\` (the voice program and its model);
  - `day\check\` and `day\check.log` (the day check's pictures and log).
- **On the desktop:**
  1. `git clone -b videos --single-branch https://github.com/hotelsfidato-ai/pms.git C:\videos`
  2. Unzip `videos-generated.zip` into `C:\` (it holds `videos\…`).
  3. In `C:\videos`, run `npm ci`.
- **Paths:** `tools\marks.mjs` and `tools\record.mjs` find the PMS folder
  themselves. They try `D:/fidato pms`, then this PC's folder; `PMS=` still
  overrides.

### Where D27-301 (every Part A chapter, picture tours) stopped

On 10 Oct, 15 helpers ran at once. The usage limit stopped them all mid-work
(PMS MEMORY 406). Where each chapter stands:

| Chapter | script | voice (src/data/<ch>.json) | arrows (marks-<ch>.json) | state |
|---|---|---|---|---|
| a8 Restaurant | yes | yes | yes | RENDERED, out\a8 |
| a7 Night audit | yes | yes | yes | finished and checked |
| a14 Sales and loyalty | yes | yes | yes | finished and checked |
| a13 Banquets, spa, laundry | yes | yes | yes | finished; its pictures show the modules OFF - retake before rendering |
| a16 Across properties | yes | yes | yes | stopped before its report - check |
| a17 Settings | yes | no | yes | stopped - check the script, then voice |
| a0 a2 a4 a6 a9 a10 a11 a12 a15 | yes | yes | no | stopped - check each script against its pictures and the code, then arrows |
| a1 a3 a5 | - | - | - | no pictures yet |

The chapter texts and pictures are on the PMS branch `manual-rest`
(`docs/manual/chapters`, `img`, `shots`): run marks with
`PMS=<that copy>`, as the helpers did.

### The engine: changed for any chapter, NOT yet proven

The engine helper was stopped at 19:03 on 10 Oct, after these changes:
- `src\chapters.ts` registers any chapter from `src\data`.
- Root, TaskVideo, ChapterVideo, Cards and Scenes read it.
- `tools\lib.mjs` (shared), `tools\render.mjs`, `tools\stills.mjs` and
  `tools\render-all.mjs` were rewritten.

On 12 Oct, `tsc` was clean and every tool parsed. Nothing has been rendered
with the new engine yet.

**Before rendering any new chapter:**
1. Re-render ONE A8 video (A8-06).
2. Check that its length matches `out\a8` to the frame, and look at its stills.
3. Then run `node tools/render-all.mjs`, one chapter at a time.

### The day check (D27-300), stopped part way

`day\check.mjs` with `day\day.shots.mjs` ran on the LOCAL demo up to about
step 46: 9 Oct closed, check-outs with a late departure, housekeeping,
check-ins. Then it was stopped. One step showed a failure and has not been
judged yet: 46h, the check-in where "is in house" was not seen; it may be the
tool's timing.

To run it again:
1. Restore the PMS demo from `.local\backups\fidato-before-day-check-10oct.dump`.
2. Run it again.
3. Report every problem to the owner; fix nothing without their yes.
4. Then record, voice and render the day video.

### The next steps, in order

1. The A8 frame check.
2. Finish the stopped chapters, 3-4 helpers at a time.
3. render-all.
4. The day check.
5. Pictures for A1, A3, A5 and A13.

---

## 10 October, evening

(D27-294, now replaced for the code by D27-303: this folder was not
committed, and was C:\videos only.)

## What the owner chose (D27-294)
- Voice: free and local. Piper, voice en_US-lessac-medium.
- Series: short per-task videos first, then one video per chapter.
- Look: both. The manual's screenshots, animated (zooming to each numbered
  arrow as the voice names it), AND screen recordings of the task done live.
- Files: C:\videos, never committed.
- Chapter A8 (Restaurant) first, then every other chapter once the book's
  chapters are merged.

## Done: chapter A8 (Restaurant), rendered
- `out\a8\<slug>.mp4`: the 12 task videos (A8-01 … A8-12), 1920x1080, 30 fps,
  H.264 + AAC. `out\a8\A8-restaurant-full-chapter.mp4`: a chapter card, then
  all 12 (joined, not rendered again): 14:29, 116 MB.
- Lengths: A8-01 1:17 · A8-02 1:28 · A8-03 1:37 · A8-04 1:01 · A8-05 1:01 ·
  A8-06 0:56 · A8-07 1:27 · A8-08 0:44 · A8-09 1:37 · A8-10 1:28 ·
  A8-11 0:52 · A8-12 0:54. Chapter card 0:07 (silent: the data has no voice
  line for it).
- `out\a8\stills\<id>-1-title.png / -2-scene.png / -3-outro.png` (and
  `A8-00-chapter-card.png`): three frames of each, looked at: captions at most
  two lines, the zoom on the named arrow, no blank or stretched frames. Every
  task MP4 has an AAC track with the voice in it (`tools\audiocheck.mjs`).

### The pieces
- `script\a8.json`: the narration, scene by scene (picture, arrow, words);
  "record" names the shots shown live in "Watch it done".
- `tools\voice.mjs a8` → `public\a8\voice\…\NN.wav` + `src\data\a8.json`
  (each line's sound and length). Run again only if script\a8.json changes.
- `tools\marks.mjs a8` → `public\a8\shots\*.png` + `src\data\marks-a8.json`
  (where each numbered arrow is). 5 arrows not found (A8-02 #3, A8-05 #3,
  A8-17 #1, A8-21 #2, A8-22 #1): those scenes show the whole picture.
- `tools\record.mjs a8` → `public\a8\rec\<shot>\NNNN.jpg` + `src\data\rec-a8.json`
  (the screen recordings: the manual's own steps from
  `pms\docs\manual\shots\a8.mjs`, read-only, on the LOCAL demo, with a drawn
  cursor that glides and ripples, typing letter by letter). It runs A8-00,
  A8-00b, then A8-02 … A8-17 and records the 15 shots the "record" lists name.
  Needs the local web (5173), API (8787) and virtual printers (5199). Each run
  places one practice order on N4 of the demo hotel 5EL and pays it by UPI;
  the next run's A8-00b clears N4 first. If a run stops half way, N4 is left
  with an open order: pay it on the Till (or Clear it) before running again.
- `src\`: the Remotion compositions.
  - `timeline.ts`: every video's timeline from the data (title, Watch it done,
    scenes, checklist, outro), and the caption pages (max two lines).
  - `TaskVideo.tsx`: one composition per video (ids `A8-01` … `A8-12`).
    `Cards.tsx` (title, outro, chapter card), `WatchItDone.tsx` (the recording
    in a browser-like window, sped up only past 25 s), `Scenes.tsx` (the
    picture, the camera gliding ~0.6 s to 1.8x around arrow n, a pulsing
    orange ring, crossfade on a new picture), `Checklist.tsx` (A8-12),
    `Caption.tsx`. Each line's WAV plays in a Sequence at its time.
  - `ChapterVideo.tsx`: `A8-ChapterCard` and `A8-Chapter` (card + all 12).
  - Fonts: Segoe UI (system); no font package added.
- `tools\render.mjs a8`: renders every task video, the chapter card (with a
  silent audio track) and joins the full chapter with `npx remotion ffmpeg
  -f concat -c copy`.
- `tools\stills.mjs a8`: the three check frames of each video (its frame
  numbers mirror timeline.ts by hand: change both together).
- `tools\audiocheck.mjs out/a8/*.mp4`: is there voice in each MP4.

## How to re-render
- Where: this PC, Git Bash, in C:\videos.
- One video: `npx remotion render A8-07 out/a8/A8-07-the-till-the-cash-register.mp4 --codec=h264 --concurrency=4`
  then join the chapter again: `node tools/render.mjs a8 --join`.
- Or: `node tools/render.mjs a8 A8-07` (renders it, then joins).
- Everything: `node tools/render.mjs a8` (about 31 minutes on this PC at
  concurrency 4).
- Only the chapter card, then join: `node tools/render.mjs a8 --card`.
- New recordings: `node tools/record.mjs a8` (local web/API/printers running),
  then render.
- Look: `node tools/stills.mjs a8 [ids]`, or `npx remotion studio`.

## Notes
- 10 Oct: the installed node_modules were incomplete (files missing in
  `remotion` and `@remotion/renderer`); `npm ci` from the lockfile fixed it
  (same versions, nothing added). The first render fetched Remotion's own
  headless Chrome (~120 MB) into node_modules.
- The demo's N4 carried an older unpaid order on 10 Oct; the first recording
  run paid it by UPI along with the practice order (local test data only).

## Next
1. The owner watches A8 and says what to change.
2. The 5 arrows not found: fix `tools\marks.mjs` (allow a circle whose ring
   touches another orange line), then re-render the videos that use them
   (A8-02, A8-03, A8-10, A8-11).
3. The other chapters: a script per chapter (from
   `pms\docs\manual\chapters\<x>.html`), `voice.mjs`, `marks.mjs`,
   `record.mjs` (needs that chapter's shots file and set-up shots; the A8
   set-up ids A8-00/A8-00b are named in record.mjs), then compositions
   generalised from `a8` (timeline.ts imports the a8 data and Scenes.tsx reads
   `a8/shots`), render.
