# Lanes for the 15 October launch (13 Oct 2026, the owner's API-key sessions)

The owner's Max plan ends on 15 October. To finish before it, the owner opens extra
Claude Code sessions on this PC, signed in with their own Anthropic API key (typed by
the owner in their own terminal or Claude Code's login, never in a chat), and gives
each session ONE line:

    read docs/briefs/lanes/<lane>.md and do it

The main chat (the master) stays the coordinator: it merges every lane's branch into
cp6, runs the full gates, prepares the releases and keeps the tracker. A lane never
merges into cp6, never pushes, never deploys.

| Lane | File | Model | Starts |
|---|---|---|---|
| A | early-checkout-a.md | Opus | when the master says D27-314 is merged |
| B | money-roundoff-refunds.md | Opus | now |
| D | watch-it-done.md | Sonnet | now |
| E | film-1.md | Sonnet | now |

Every lane: read CLAUDE.md (it loads by itself), AGENTS.md, docs/briefs/README.md and the
decision rows it names in docs/briefs/decisions-2026-09-27.md before the first write.
Work in your OWN copy (the lane file says where), commit there in small steps (a usage
or cost stop then loses nothing), and finish with a short plain-words report written to
`.local/lanes/<lane>-report.md` (the master reads it), then tell the owner "done".
