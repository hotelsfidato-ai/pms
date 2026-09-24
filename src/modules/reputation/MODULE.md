# Reviews

Ask a guest for a review after they have left, and see who has been asked.

**BUILT 19 September 2026** (the owner's **D18-14**), replacing the Coming soon
page. Its brief is `docs/briefs/reputation.md`; the plan is
`docs/BUILD-PLAN-2026-09-18.md` § 5.

```
src/modules/reputation/            the screen, its menu entry and its address
api/src/modules/reputation/        the three routes
db/tests/modules/reputation.sql    the database's own rules, 13 assertions
db/migrations/120_the_review_link  PROVISIONAL NUMBER - the master settles it at merge
```

---

## What it does

1. **A list of departures** at this property, the last 30 days, with whether
   each guest was asked for a review, when, and which way it went.
2. **Asking one of them** - WhatsApp or email, picked per guest, and only
   offered where the booking carries an address for it. **A group is asked
   once, at its lead guest's room** (D22-10): every room of it shows the
   group's ask, and only the lead's row offers the buttons.
3. **The property's review link**, typed in by the owner or an administrator.

## ⚠ The link the owner has not given

**There is no review link anywhere in this repository**, and that is the whole
point rather than an omission. The owner owes the group's Google review link
(`docs/PARALLEL-PLAN-2026-09-18.md` § 6); until it arrives:

- a property has **no row** in `review_links` - not `''`, not a placeholder
- the screen shows a **dash**, the same as any figure nobody has set
- **no row offers to send**, and the server refuses with a sentence that says
  there is no link and names who can add one
- **nothing is recorded**, because a message that could never have carried a
  link is not an attempt anybody made
- the input box has **no placeholder** - an example in a box is an example
  somebody copies out and sends to a guest

The day the link arrives, somebody pastes it in. No deploy, no migration.

## ⚠ Nothing sends yet either

`canSend()` is false until the owner finishes the n8n steps
(`docs/briefs/n8n-sending.md`). The screen says so at the top, in the sender's
own wording, and draws no button. Both refusals exist independently: a
connected sender is not a link, and a link is not a connected sender.

## Nothing is pulled in

No Google, no TripAdvisor, no booking sites (**D18-14**). The last card on the
screen says so where a person would go looking for the reviews themselves,
rather than leaving them to wonder why the page is empty.

---

## Screens

| Menu name | Address | Page file | Who sees it |
|---|---|---|---|
| Reviews | `/h/:code/reviews` | `pages/Reviews.tsx` | the Guests permission (`customer`) - owner, admin, GM, hotel manager, reception, accountant, viewer |

In the **Front desk** section, order 60, after Work orders. **Not** in
reception's working menu: the owner's shorter menu is the eight screens a clerk
uses in a shift. Find a screen reaches it under "reputation", "google reviews",
"tripadvisor", "feedback", "ratings", "review link".

### Three questions, three answers

| | Who | Where it is decided |
|---|---|---|
| **Look** | `customer: view` | the matrix, copied into `api/src/modules/reputation/reputation.ts` and held to it by a test |
| **Ask** | `customer: create` - so the accountant and a viewer read and send nothing | the same |
| **Set the link** | `hotel: edit` - the owner and an administrator | the same |

The owner answered all three on 19 September, asked with a recommendation.
**Reviews sits on the Guests permission and widens nobody**: everybody who can
open it can already open the Guests screen and read the same names, numbers and
stays. A resource of its own would have meant a new column in the master's
`src/lib/permissions.ts` to say what the matrix already says.

---

## The server

| | |
|---|---|
| `GET /api/hotels/:code/reviews` | the link, who may do what, whether anything can send, and the departures |
| `PUT /api/hotels/:code/reviews/link` | set it, or clear it back to nothing with `""` |
| `POST /api/hotels/:code/reviews/:id/ask` | ask one departed guest - for a group, only at its lead guest's room (D22-10; the lead is `app.group_lead`, D22-52) |

**Everything leaves through `api/src/sending.ts`** and nothing else. This
service never calls n8n, never holds the secret, and **never writes
`messages_sent`** - the sender records the attempt itself. "Who was asked" is
read back out of that table rather than kept a second time here, so the screen
and the record of what was sent cannot disagree.

The wording the guest reads lives in n8n. This sends `data.link` and
`data.reference` and no sentence at all.

---

## What it leans on

- **`api/src/sending.ts`** - the one door out. The master's.
- **`reservations`** - read for departures. Read only, and never written.
- **`app.hotel_day` / `app.hotel_clock`** (migration 113) - the 30 days and
  every moment shown are the property's own, not the server's.

## Rules that bind it

- **No default anything.** A link nobody has set is a dash, never a guess.
- **After check-out, never before.** The server refuses any other status.
- **Never invent a figure or an address.**
- **Nothing is recorded when nothing was attempted.**

---

## Requests

### For the root `MEMORY.md` - the master's file, not this chat's

**A test's `alter table` is an ACCESS EXCLUSIVE lock that every other test file
queues behind, and vitest runs the files in parallel.** Found here as REV-4:
this service's teardown removed its own property, which needs
`alter table hotels disable trigger hotels_no_delete`, and under the full API
suite that window turned two OTHER people's files red on two runs - a POS
promotion timing out at twenty seconds, and a tax-invoice refusal answering
200 instead of 409. Each was green alone; the suite was green with this
service's file taken out.

**It is not one file's problem. Seventeen API test files do the same thing**
(`grep -rl "disable trigger" api/test`), including both of the two that went
red. It has been survivable until now and this service was the one that tipped
it; the next lane to add a file will tip it again.

**A recommendation, since the master owns the fix:** a test in this harness
does not need to remove anything - `api/scripts/with-test-db.sh` builds a
scratch database per run and drops it, pass or fail. Dropping the property
teardowns removes seventeen exclusive locks and makes the suite both faster
and honest. This service has already stopped doing it.

### The one shared file this chat touched

Named here so the master sees it at merge:

- `src/components/app/navigation.test.ts` - "Reviews" removed from the `SOON`
  list, because a service that is built cannot also be coming soon. Exactly
  what the purchasing chat did on 18 September, and the comment beside it says
  so. **Nothing else in the master's files was changed** - no new resource, no
  new section, no edit to `permissions.ts`, `navigation.ts`, `server.ts` or
  `sending.ts`.

## Not in this version

Pulling reviews in from anywhere, replying to them, scoring or sentiment, and
chasing somebody who did not answer (`docs/briefs/reputation.md`).

## Gates

```
npx tsc -b --force
npx vitest run src/modules/reputation src/test
cd api; npm test -- modules/reputation
bash db/tests/run.sh
```
