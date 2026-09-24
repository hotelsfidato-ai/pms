# Laundry — defects

Numbered `LAU-n`. A lesson for the whole project goes to the master for the
root `MEMORY.md`; what stays here is what somebody working on this service
needs so they do not work it out twice.

---

## LAU-1 · A property could never be removed — found by a teardown, not by a test

**18 September, fixed the same hour.** `laundry_docket_lines` carries a
composite foreign key to `laundry_price_items (hotel_id, id)` with no
`on delete` action. Removing a property cascades into `laundry_price_items`,
and any docket line still pointing at one of them refused the delete:

```
update or delete on table "laundry_price_items" violates foreign key constraint
"laundry_docket_lines_hotel_id_price_item_id_fkey"
```

**The application could never have hit it** — `pms_app` holds no DELETE on
either table — so no screen and no route would ever have shown it. What found
it was the API test's own teardown removing the property it had provisioned.

**Fixed** with `on delete set null (price_item_id)`, which is what the design
already implied: the line copies the description, the service and the price at
collection, so the price-list entry is provenance and nothing more. A line that
loses it still says exactly what was collected and what was charged.

**The lesson, and it is not about laundry:** a fixture that removes what it
made is a check on the schema, not housekeeping. This fault was invisible to
every assertion in the file and visible to the last line of it.

---

## LAU-2 · Not a laundry defect — `db/tests/suite.sql` has been red on `cp6` since 115 — FIXED 18 September

**18 September. Reported to the master; NOT fixed here — `db/tests/suite.sql`
is the master's file and this lane may not touch it.**

`db/tests/suite.sql:2095` proves that an unknown module is refused, and the
module it uses as its example of an unknown one is `'spa'`:

```sql
perform test.raises('modules','an unknown module is refused',
  format($q$insert into hotel_modules (hotel_id, module)
           values (%L,'spa')$q$, v_hotel), '23514');
```

Migration 115 — "laundry and spa are modules a property is switched on for",
the master's, 18 September — made `spa` a **known** module. The insert now
succeeds, so the assertion that expected a failure fails.

**It is not caused by anything in this lane.** Proved by running
`db/tests/run.sh` on `a633d8c` with this service's migration absent and its
`db/tests/modules/laundry.sql` moved out of the folder: 84 suites, the same one
failure. With this lane's work in place: 85 suites, 865 assertions, the same
one failure.

**The fix is one word** — the example needs to be a module that is genuinely
unknown (`'valet'`, say, or `'gym'`) rather than one that has since been built.
The master's, because every lane's Action is red until it is made.

**Fixed** — 18 September, by the master (commit `6fe654d`): the example is now
`'not_a_module_and_never_will_be'`, with a comment saying why a plausible
future feature makes a bad "impossible" case (MEMORY 300). **Proved** by that
assertion, "an unknown module is refused" in `db/tests/suite.sql`: it expects
the insert refused (`23514`) whatever modules are built next. Marked here 25
September.

---

## LAU-3 · The Settings switch for laundry draws, and refuses — FIXED 19 September

**The entry is admin's now** - `src/modules/admin/DEFECTS.md`, under Fixed,
"LAU-3 / SPA-1": the fault was in `api/src/modules/admin/moduleSwitches.ts`,
admin's file, and the spa chat had found the same one a day earlier (SPA-1).
What was seen here (`POST /api/hotels/5EL/modules/laundry → 409`, "There is no
\"laundry\" module."), the two lists, the hand-written `hotel_modules` row on
the development database, and the rule are all there. Fixed by the master on 19
September (`41c0990`): one `SWITCHABLE` list, read by both ends; proved by
`api/test/modules/admin/moduleSwitches.test.ts`. Moved 25 September.

---

## Open, and why

Nothing, 25 September. The three that were listed here are fixed:

- **The charge does not reach the bill, and now it could — FIXED 21
  September.** It said: `postCharge` is on finance's door since 18 September;
  `api/src/modules/laundry/laundry.ts` has not been changed to call it, so
  `POST …/dockets/:id/charge` still makes every refusal that is its own and
  then says the connection is not there. The screen shows that sentence, which
  is honest and is not the finished thing. **Fixed** in commit `9af60ec` (21
  September): the route calls `postCharge` after its own refusals, on the
  stay's bill, and the docket carries the posting. **Proved** —
  `api/test/modules/laundry/laundry.test.ts`, "a guest's bag, charged to the
  room": a priced bag lands on THAT stay's bill as a `laundry` line for the
  docket's total, the docket reads charged, and a second charge is refused
  ("already on the bill").
- **LAU-3** — FIXED 19 September; the entry is admin's (above).
- **LAU-2** — FIXED 18 September (above).
