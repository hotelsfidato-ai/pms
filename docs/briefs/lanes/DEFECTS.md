# Lanes - defects (the API-key lanes and their runner)

Every fault in how the lanes run: what happened, what was done, and the rule it leaves.
Newest first. The runner is `.local/lanes-runner/runner.mjs` (git-ignored, with its
packages); this file is its record. MEMORY.md holds the master's own mistakes (407-409).

---

### LANE-7 · The spending cap started again at every restart - FIXED 14 Oct
Each start of a lane counted its spend from $0, so a lane restarted three times could spend
three caps. **Fixed:** the runner keeps the lane's total in `.local/lanes/flags/<lane>.spent`
and reads it at every start; seeded on 14 Oct 15:40 from the lanes' own logs (A $6.14,
B $9.08, D $0.44, E $6.58, F $0.00). The logs undercount runs cut off by the 04:05 restart:
the Anthropic Console is the true figure. **Rule:** a limit that must hold across restarts
is written to a file, never kept in memory.

### LANE-6 · Two lanes edited the same recording tool at once - OPEN (watch)
14 Oct ~14:40: lanes D and E both "fixed the template-string escapes" in
`C:\videos\tools\record.mjs` within minutes of each other. Neither checked the other's edit
first; a later save can silently undo an earlier one. **Rule:** before editing a shared tool,
`git -C C:\videos diff tools/<file>` - if another lane has changed it, build on that, and say
so in the progress log.

### LANE-5 · Progress lines carried made-up times - FIXED 14 Oct
Lines dated 15:05, 15:20, 15:30 were written at about 14:50 (lane E), and the master wrote
"15:20" and "15:35" at 14:58. The log could not be read as a timeline. **Fixed:** every
runner prompt says to take the time from the clock (`date` / `Get-Date`); the master does the
same. **Rule:** never type a time; read it.

### LANE-4 · Film 1 recorded on the wrong hotel and saved practice values into 5EL - FIXED 14 Oct
After a full page load the app went back to 5 Elements Akkalkot, and the recorder carried on:
5EL's address, phone and email became the practice hotel's, and two bar GST rows were added.
Local demo only. **Fixed:** the master put 5EL back exactly from the 10 and 13 Oct backups
(the two bar rows removed: 5EL had none); lane E adds a guard that stops a group when the page
does not show the practice hotel. **Rule:** a recording that writes checks WHICH hotel the
page shows before every write.

### LANE-3 · A lane stopped the master's web server - FIXED 14 Oct
14 Oct 13:16 lane E killed the master's Vite on 5173 (to restart it) while lane D was
recording on it. **Fixed:** the rule is in every runner prompt and in README.md; the master
also serves a built copy on 5180 that barely touches the disk. **Rule:** never stop a process
you did not start; wait, poll, or ask.

### LANE-2 · A BLOCKED line ended the lane's whole process - FIXED 14 Oct
The runner read the lane's last progress line; "BLOCKED" made it EXIT. A lane waiting for an
answer, or for a web server that came back two minutes later, was gone, and only the owner
could start it again (typing the key). Lanes D and E ended this way three times on 14 Oct.
**Fixed:** FLAGS. `.local/lanes/flags/<lane>.blocked` makes the runner WAIT (polling each
minute) and resume the same session when the master deletes the file; `<lane>.done` ends it;
nothing in the log controls the runner any more. Lanes are told not to raise a flag for a wait
that clears by itself. **Rule:** a process that needs an answer waits for it; it does not end.

### LANE-1 · "UNBLOCKED" stopped a lane as if it were "BLOCKED" - FIXED 14 Oct
14 Oct 14:59 the master wrote "UNBLOCKED by the master" as lane E's line so its runner would
carry on; the runner's test `/BLOCKED/` matched inside "UNBLOCKED" and ended lane E at 15:02.
**Fixed:** first with word boundaries, then replaced by flags (LANE-2). **Rule:** never steer
a program with free text it pattern-matches; use a file or a value with one meaning.

---

## How the flags work (for the master)

| File in `.local/lanes/flags/` | Written by | Means |
|---|---|---|
| `<lane>.done` | the lane | brief finished, report written - the runner ends; a start refuses to run again until it is deleted |
| `<lane>.blocked` | the lane | needs the owner or the master (the reason is in the file) - the runner waits |
| `<lane>.spent` | the runner | dollars spent by this lane, all starts together |

To unblock a lane: answer in the lane's brief (last paragraph) and a `master` line in
progress.log, THEN delete `<lane>.blocked`. The runner resumes the same session within a minute.
Lanes still running the old runner (started before 14 Oct 15:45) end on a BLOCKED line as
before; they get the flags at their next start.
