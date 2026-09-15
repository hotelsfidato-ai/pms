# Fidato PMS — read before anything else

This is a live hotel system (pms.fidatohotels.com). The owner does not want to
re-explain it, and they should not have to.

1. **Read the top section of `HANDOVER.md` to the end before your first
   write.** It is the current brief: where things stand, what to do next and
   in what order, every decision the owner has made, and their standing rules.
2. Then `MEMORY.md` from defect 240 onwards, and the top three entries of
   `CHANGELOG.md`.
3. `AGENTS.md` is the working agreement. `START-HERE.md` is how to run it.
4. **Working on one service?** Since 15 September the code is one folder per
   service. Read `src/modules/<service>/MODULE.md` — its brief — and its own
   `CHANGELOG.md` and `MEMORY.md`, and claim it in `HANDOVER.md` first.

The rules that are never negotiable, in short — the full list is
`HANDOVER.md` § 5:

- **Ask the owner before any doubt**, with a recommendation.
- Never commit, print or echo `api/.env`.
- No default prices; a missing figure is a dash, never a zero.
- Open the screen before claiming it works; run the gates you quote.
- Every mistake goes into `MEMORY.md`, numbered.
- Production deploys and writes on the server need the owner's explicit yes.
- Every command given to the owner is labelled with where it runs.

When you stop: a `CHANGELOG.md` entry, and `HANDOVER.md` §§ 2–3 brought up
to date.
