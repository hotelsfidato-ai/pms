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

## Open, and why

- **The screens are not built** (see `MODULE.md` → Requests). The service's
  database and server are built and proved; nothing a person can open exists,
  because a menu section and a permission resource are the master's to add.
- **The charge does not reach the bill.** `POST …/dockets/:id/charge` makes
  every refusal that is this service's own and then says plainly that the
  connection is not there, because finance's front door exports no way to post
  a charge. It does not write `folio_postings` itself, and it must not.
