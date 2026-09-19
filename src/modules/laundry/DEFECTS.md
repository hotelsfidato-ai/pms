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

## LAU-2 · Not a laundry defect — `db/tests/suite.sql` has been red on `cp6` since 115

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

---

## LAU-3 · The Settings switch for laundry draws, and refuses

**19 September, found while opening the screens. NOT fixed here —
`api/src/modules/admin/moduleSwitches.ts` is the master's file.**

Settings shows a Laundry switch. Turning it on answers:

```
POST /api/hotels/5EL/modules/laundry → 409
{"reason":"There is no \"laundry\" module."}
```

The two halves of that file disagree. `GET /:code/modules` asks
`app.module_enabled` for six modules by name — `pos`, `banquet`,
`reception_pos`, `channel_manager`, `laundry`, `spa` — so all six draw a switch.
`POST /:code/modules/:module` guards with a list of three that was never
widened:

```ts
if (!["pos", "banquet", "reception_pos"].includes(module)) {
```

`channel_manager` has the same fault and has had it longer; **the spa's switch
is unaffected only because that property already had its row.** Nothing in the
database refuses it — `hotel_modules_known` has named `laundry` since migration
115, and the row went in by hand without complaint.

**The fix is the list.** Better, the list is the same six the GET already
names, in one constant, so the next module cannot draw a switch that refuses.
That is a judgement about the master's file and is theirs to make.

**Worked around for this session only**, to see the screens at all: the row was
written straight into `hotel_modules` on the development database
(`5EL`, `laundry`, enabled). Nothing in this lane depends on it.

---

## Open, and why

- **The charge does not reach the bill, and now it could.** `postCharge` is on
  finance's door since 18 September; `api/src/modules/laundry/laundry.ts` has
  not been changed to call it, so `POST …/dockets/:id/charge` still makes every
  refusal that is its own and then says the connection is not there. The screen
  shows that sentence, which is honest and is not the finished thing.
  `MODULE.md` → Requests 1 has what the route needs.
- **LAU-3 above** — the switch a property is turned on with does not work.
- **LAU-2 above** — `db/tests/suite.sql` red on `cp6`, and not this lane's.
