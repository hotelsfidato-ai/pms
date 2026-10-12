#!/usr/bin/env bash
# Every gate, judged by exit code, one line each. Runs on the copy it sits in:
# the main project, or a helper agent's copy under .claude/worktrees/.
#
#   bash scripts/gates.sh <label>          every gate (before a merge)
#   bash scripts/gates.sh <label> quick    types, stripping and the website tests only
#                                  (about 4 minutes, for iterating)
#
# It writes a LINE PER STEP as each one finishes, into .local/gates/progress.txt,
# so a run in flight can be watched instead of waited on in silence. The owner
# stopped a run on 18 September because twenty minutes passed with no sign of
# life; that was the script's fault, not the machine's.
#
# ⚠ ONE RUN AT A TIME. Several of these at once exhausted this machine's
# process slots on 18 September ("fork: Resource temporarily unavailable") and
# a whole round produced nothing at all.
# Logs live in .local/ (ignored by git), inside the project like everything
# else about it (D22-1). This script lived in a chat's temp folder until then.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
S="$ROOT/.local/gates"
mkdir -p "$S"
cd "$ROOT" || exit 9
# THE MAIN CHECKOUT, found through git rather than written down. A helper's
# copy under .claude/worktrees shares the main checkout's Postgres, its
# PostgreSQL 16 and its database queue, so those are found from git's common
# directory, not from this copy. They were "/d/fidato pms/..." until the
# project moved to another machine on 9 October, where every database step
# failed on a folder that was not there. `pwd -W` is the Windows spelling
# (C:/...) a node test is handed; elsewhere plain pwd.
MAIN="$(cd "$(git rev-parse --git-common-dir)/.." && { pwd -W 2>/dev/null || pwd; })"
# The local Postgres every database script defaults to, unless told otherwise.
[ -n "${PGBIN:-}" ] || export PGBIN="$MAIN/.local/pg/pgsql/bin"
# The database queue: `.local/dbq.sh`, the machine's own and not in git. With
# none - one chat on the machine - a step simply runs.
q() { if [ -f "$MAIN/.local/dbq.sh" ]; then bash "$MAIN/.local/dbq.sh" "$@"; else "$@"; fi; }
label="${1:-gates}"
mode="${2:-full}"
P="$S/progress.txt"
# The first line names the commit this run judged and the mode, plus "dirty"
# when the copy had changes git had not committed: scripts/release.mjs refuses
# a release whose exact commit has no full, clean, green run here (D27-276).
dirty=$(git status --porcelain | head -1)
echo "commit $(git rev-parse HEAD) $mode${dirty:+ dirty}" > "$P"

strip() { sed -e 's/\x1b\[[0-9;]*m//g' "$1"; }

step() {                       # step <name> <logfile> [<last line>] -- <command...>
  local name="$1" log="$2" last=""; shift 2
  [ "$1" = "--" ] || { last="$1"; shift; }; shift
  local began=$SECONDS
  "$@" > "$log" 2>&1
  local code=$?
  # A script killed from Windows (Stop-Process, taskkill, WMI Terminate: how a
  # stray run gets cleaned up) hands Git Bash exit 0 with its log cut short.
  # A database step "passed" in 22 s that way on 27 September (MEMORY 333).
  # Where a step names its passing last line, exit 0 without it is a failure
  # (for vitest, "Test Files  1 failed | 99 passed" is not the passing line).
  if [ $code -eq 0 ] && [ -n "$last" ] && ! strip "$log" | grep -qE "$last"; then
    echo "  x CUT SHORT: exit 0 without its passing last line - killed from outside?" >> "$log"
    code=1
  fi
  printf '  %-10s exit %s  %3ds\n' "$name" "$code" "$((SECONDS - began))" >> "$P"
  return $code
}

began_all=$SECONDS
step "web types" "$S/g-webtypes.log" -- npx tsc -p tsconfig.app.json --noEmit; wt=$?
step "api types" "$S/g-apitypes.log" -- bash -c 'cd api && npx tsc --noEmit -p tsconfig.json'; at=$?
step "strip"     "$S/g-strip.log"    -- bash -c 'cd api && npm run strip-check'; sc=$?
step "web tests" "$S/g-web.log"      "Test Files +[0-9]+ passed" -- npx vitest run; w=$?

if [ "$mode" = "quick" ]; then
  a=0; d=0; r=0; p=0
  echo "  (quick: the API suite, the database, the replay and PostgreSQL 16 were not run)" >> "$P"
else
  # Every step that builds a database waits its turn in the queue: roles are
  # shared by the whole cluster, and a replay beside a helper's migrate failed
  # with "tuple concurrently updated" on one (4 Oct).
  step "api tests" "$S/g-api.log"   "Test Files +[0-9]+ passed" -- q bash -c 'cd api && npm test'; a=$?
  step "database"  "$S/g-db.log"    "all [0-9]+ assertions passed" -- q bash db/tests/run.sh; d=$?
  step "replay"    "$S/g-rerun.log" "all [0-9]+ migrations are re-runnable" -- q bash db/tests/rerun.sh; r=$?
  # The live server's PostgreSQL 16 (the owner, 4 Oct). Its own cluster, shared
  # by every copy, so it waits its turn in the database queue.
  step "pg16"      "$S/g-pg16.log"  "all [0-9]+ migrations are re-runnable" -- q bash db/tests/pg16.sh; p=$?
fi

vline() {                      # vitest's own counts, the failed ones included
  strip "$1" | grep -E "^\s+(Test Files|Tests) |CUT SHORT" | tail -3 | tr '\n' ' ' | xargs
}
webline=$(vline "$S/g-web.log")
apiline=$(vline "$S/g-api.log")
dbline=$(strip "$S/g-db.log" | grep -E "assertions passed|FAILED|migrations applied|x the|CUT SHORT" | tr '\n' ' ' | xargs)

echo "── $label ($mode, $((SECONDS - began_all))s) ──"
echo "  web types  exit $wt"
echo "  api types  exit $at"
echo "  strip      exit $sc  $(strip "$S/g-strip.log" | grep -E "load under|cannot run|✗" | tail -1 | xargs)"
echo "  web tests  exit $w   $webline"
if [ "$mode" != "quick" ]; then
  echo "  api tests  exit $a   $apiline"
  echo "  database   exit $d   $dbline"
  echo "  replay     exit $r   $(strip "$S/g-rerun.log" | grep -E "re-runnable|abort|CUT SHORT" | xargs)"
  echo "  pg16       exit $p   $(strip "$S/g-pg16.log" | grep -E "PostgreSQL\) 16|assertions passed|re-runnable|FAILED|abort|x |CUT SHORT" | tr '\n' ' ' | xargs)"
else
  echo "  QUICK RUN - the API suite, the database, the replay and PostgreSQL 16 were NOT run."
fi
if [ $w -ne 0 ]; then strip "$S/g-web.log" | grep -E "× |→ " | head -6 | sed 's/^/    /'; fi
if [ $a -ne 0 ]; then strip "$S/g-api.log" | grep -E "× |→ " | head -6 | sed 's/^/    /'; fi
if [ $wt -ne 0 ]; then head -8 "$S/g-webtypes.log" | sed 's/^/    /'; fi
if [ $at -ne 0 ]; then head -8 "$S/g-apitypes.log" | sed 's/^/    /'; fi
[ $wt -eq 0 ] && [ $at -eq 0 ] && [ $sc -eq 0 ] && [ $w -eq 0 ] && [ $a -eq 0 ] && [ $d -eq 0 ] && [ $r -eq 0 ] && [ $p -eq 0 ]
