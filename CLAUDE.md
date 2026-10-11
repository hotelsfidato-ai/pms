# Fidato PMS — read before anything else

This is a live hotel system (pms.fidatohotels.com). The owner does not want to
re-explain it, and they should not have to.

**12 OCTOBER: DEVELOPMENT IS BACK ON THE ORIGINAL DESKTOP (`D:\fidato pms`).
Read `LAPTOP-HANDOVER.md` first.** It covers:
- bringing this machine's own checkout up to date (do not clone; look for
  unpushed work first);
- the videos in `C:\videos`, from the GitHub branch `videos`;
- what is done and what is next;
- the questions waiting for the owner (D27-302, D27-303).

1. **Read the top section of `HANDOVER.md` to the end before your first
   write.** It is the current brief: where things stand, what to do next and
   in what order, every decision the owner has made, and their standing rules.
2. Then `MEMORY.md` from defect 240 onwards, and the top three entries of
   `CHANGELOG.md`.
3. `AGENTS.md` is the working agreement. `START-HERE.md` is how to run it.
4. **Working on one service?** **Read `docs/briefs/<service>.md` first** — it
   says what that service owns, what the critique found in it, what to start
   with, and the files that will break other people's chats if you touch them.
   `docs/briefs/README.md` has the rules every lane shares. Then
   `src/modules/<service>/MODULE.md`, its `CHANGELOG.md` and its `DEFECTS.md`.
   **Claim the service with `npm run claim -- <service> "what"`** — not in a file — and
   run `npm run lane -- <service>` before you commit.

**⚠ 19 SEPTEMBER, THE OWNER, AND IT OVERRIDES EVERYTHING BELOW:
NOTHING LEAVES THIS MACHINE.**

- **Do not `git push`.** Not to `cp6`, not to any branch, not with
  `--no-verify`, not "just to run the Action".
- **Nothing runs in GitHub Actions**, because nothing reaches GitHub.
- **Do not deploy.** Not the API, not the website, not the deploy button.
- **Commit locally, always.** Work is finished when it is committed on this
  machine with its gates run HERE. `bash scripts/gates.sh <label>` is the
  proof now — the Action cannot be.
- A service chat's own push is refused the same way. They commit; the master
  merges locally.

This lifts only when the owner says so in their own words. Until then, a green
local gate run is the whole of the bar, and the standing rule that a push is
not finished until its Action is green (MEMORY 300) is suspended because there
are no pushes.

**22 SEPTEMBER, THE OWNER (D22-1): NOTHING ABOUT THIS PROJECT LIVES OUTSIDE
`D:\fidato pms`.** The owner talks to ONE main chat. The main chat sends helper
agents; each works in its own copy inside the project, `.claude\worktrees\`,
and reports back; the main chat merges. Local things that are not code (the
Postgres, screenshots, gate logs) are in `.local\`. A copy goes to the Recycle
Bin as soon as its branch is merged — junctions out first (AGENTS.md).

The rules that are never negotiable, in short — the full list is
`HANDOVER.md` § 5:

- **No decision without the owner's approval** (16 September). Ask, with a
  recommendation, and wait. Silence is not approval.
- **Ask the owner before any doubt**, with a recommendation.
- Never commit, print or echo `api/.env`.
- No default prices; a missing figure is a dash, never a zero.
- Open the screen before claiming it works; run the gates you quote.
- The manual moves with the screen (D27-293): a screen changed updates its
  chapter in `docs/manual/chapters/`, its pictures and the build, in the same
  commit (AGENTS.md, "Definition of done").
- Every mistake goes into `MEMORY.md`, numbered.
- Production deploys and writes on the server need the owner's explicit yes.
- Every command given to the owner is labelled with where it runs.

When you stop: a `CHANGELOG.md` entry, and `HANDOVER.md` §§ 2–3 brought up
to date.
