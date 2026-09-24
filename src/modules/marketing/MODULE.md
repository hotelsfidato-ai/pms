# Marketing

**Guest lists that can be acted on** - D18-17, the owner, 18 September.

Stayed twice; not returned in a year; came from which booking site. With an
export, and a send when an offer goes out. **Nothing that duplicates the leads
app**, which keeps the conversations.

> This file said until 19 September that the service was *"which campaign
> brought which guest, what it cost and what it earned"*. That was the
> 16 September Coming soon page's subject, written before the owner answered.
> D18-17 is narrower and needs nothing from Meta Ads: attribution is not in
> the first version and is not being built. The old subject, and what it would
> have needed, is kept under "What was asked for in September" below.

```
src/modules/marketing/             the lists; the Coming soon page until a section exists
api/src/modules/marketing/         the front door, mounted and still empty
db/tests/modules/marketing.sql     not needed yet - this service writes no table
```

---

## Where it stands - 23 September

**Built:** `logic/lists.ts` - the three lists of D18-17 and the rows of their
export, with one gate every list goes through. That gate refuses any phone or
email on the "No offers" list (MKT-1, D21-22), and each list must be handed
that list. **Who sees the lists:** the `marketing` grant - owner, admin, GM
(D22-17). Birthdays is dropped (D22-17). 22 tests, `logic/lists.test.ts`.

**Not built, and each one waits on somebody else:** the screen, the server
route, and the send. See Requests below. **No migration was taken** - nothing
here writes a table, so this service needs no number unless the master's answer
to request 1 puts the consent column here rather than beside `guests`.

**The export writes no CSV of its own.** `src/lib/csv.ts` already holds the
quoting, the formula-injection guard a guest called `=cmd` needs, the CRLF and
the BOM Excel wants. This service supplies rows.

---

## Requests - to the master, 19 September

**Nothing below was decided here.** Each is a recommendation and a reason.

> **Done 23 September (MKT-1):** `mayBeWrittenTo` refuses a guest
> `refusesOffers` names, and every list takes the No offers list as an
> argument. The data call (`GET /api/hotels/:code/crm/no-offers`) comes with
> the screen: a data function with no caller fails `repositories.test.ts`.
>
> **Answered 22 September (D22-17):** request 3 - owner, admin and GM only,
> made as a `marketing` resource; request 4 - birthdays dropped.
>
> **Built 21 September by the CRM chat:** `refusesOffers(noOffers, phone,
> email)` is exported from `@/modules/guests`, and the list comes from
> `GET /api/hotels/:code/crm/no-offers`.
>
> **Answered 21 September (D21-22):** recorded against **the phone number or
> email itself, for the whole group** — as recommended. The CRM chat builds the
> table (`docs/briefs/crm.md`, step 5); `mayBeWrittenTo` then reads it, a line
> the master makes or grants. Until that lands, nothing here is put behind a
> send — unchanged.

### 1 - A guest who has asked not to be written to: nothing records it

The brief's one rule that is not about tidiness: *"a guest who has asked not to
be written to is never on a list that sends. If nothing in the schema records
that yet, ask the master - do not invent a column."*

**Nothing does.** Searched every migration on 19 September: no opt-out, no
consent, no do-not-contact, no unsubscribe. `guests.is_blacklisted` is a
different thing - a guest refused a room - and standing in for consent with it
would both write to people who asked not to be and stop writing to people who
never did.

⚠ **And the obvious place does not work.** `guests` carries **a row per
booking** - `004_guests.sql`, and the comment at the head of
`api/src/modules/guests/directory.ts`: *"a walk-in has no record to look up, so
two visits by one person are two rows until somebody merges them - and the
merge rules are not decided."* A flag on `guests.id` is a flag on one visit. The
same person's other rows stay writable, which is the failure that matters:
somebody asks not to be written to, and is written to anyway.

**Recommended:** record the refusal against **the address, not the person** -
one small table of a telephone number or an email address that has asked not to
be written to. It is the thing the guest actually gave, it survives the
duplicate rows, and it is what the message would have gone to. **This is the
owner's to decide, not the master's** - it settles what the hotel promises
somebody who asks - so please put it to them with this recommendation, along
with whether it holds for the group or for one property.

**Until it is answered nothing here is put behind a send**, and the gate is
`mayBeWrittenTo` in `logic/lists.ts`: one function, every list behind it, one
line to change.

### 2 - The guests door does not answer with a telephone number or an email

`api/src/modules/guests/directory.ts` already computes exactly the guest list
this service needs - stays, last stay, next stay, sources, grouped by name -
and `/api/hotels/:code/guests` serves it. **A list you cannot write to is not a
list that can be acted on**, and that answer carries no contact details.

**Recommended**, and it is the shape `postCharge` took for finance (D18-7) and
the reports door took for revenue management (R1): lift that query's body into
a function, export it from `api/src/modules/guests/index.ts`, and have the
route call it - so there is still one definition of who a guest is and how many
times they stayed. Add `phone` and `email` to what it answers.

`logic/lists.ts` declares the exact shape asked for (`Addressable`). **I have
written no query of my own**: "what counts as a stay" already has five copies'
worth of scar tissue in this repository, and this service is not adding a
sixth.

⚠ Worth the owner's eye and not only the master's: widening that door means a
guest's telephone number and email reach a new screen. That is the same data
request 1 guards.

### 3 - A menu section and a permission resource

`SectionKey` in `src/components/app/navigation.ts` has no `"marketing"`, and
`RESOURCES` in `src/lib/permissions.ts` has none either. **So this service's
screens have nowhere to live** - `SectionKey` is a typed union, and an entry
naming a section that does not exist does not compile.

This is exactly where laundry and spa stopped on 18 September, and the master
made both. **Recommended:** a `marketing` section and a `marketing` resource,
granted to whoever the owner says - the obvious reading is owner, admin and
general manager, the three who already see the Coming soon section, because a
list of guests to write to is not a clerk's screen. **Who may see a screen is
the owner's** (the run sheet, § 3), so please ask rather than assume.

Until then the Coming soon entry stays where it is and no screen is built.

### 4 - Birthdays this month cannot be built

The brief lists it as the fourth list. **There is no date of birth anywhere in
this system** - not on `guests`, not on `reservations`, not in any of the 119
migrations. It is also **not in D18-17**, which names three lists and not this
one, so nothing the owner actually asked for is missing.

**Recommended:** leave it out, and say so rather than letting it sit on a list
of things half-built. Adding it means a column, a place on a screen to enter
it, and a reason to hold a guest's date of birth at all - three decisions, for
one list, none of them this service's. Logged as MKT-2.

### 5 - The Coming soon page says this service needs things it no longer needs

`pages/Marketing.tsx` still carries the 16 September subject and tells whoever
opens it that marketing needs **Meta Ads and Google Ads access**, the leads app
connected, and booking figures confirmed by this system. D18-17 needs none of
the three.

**Recommended:** replace the page outright when request 3 is answered, rather
than re-wording copy that is then deleted. If request 3 is going to wait, say
so and the three lines under "What it needs" are corrected on their own -
**what a person reads is the owner's**, so that correction is theirs to approve
and is not made here unasked. Logged as MKT-5.

---

## Screens

| Menu name | Address (`routes.tsx`) | Page file | Who sees it (`nav.ts`) |
|---|---|---|---|
| Marketing | `/coming-soon/marketing` | `pages/Marketing.tsx` | owner, admin, GM - the `marketing` grant (D22-17), in the Coming soon section |

**Unchanged on 19 September**, and deliberately: request 3 above. When the
section exists the entry moves out of Coming soon and the real screens take
their addresses - `navigation.test.ts` pins every role's list and the Coming
soon list, so that move is one the master makes together with this service.

---

## The one door out

`api/src/sending.ts`, `send()` and `canSend()`. **Every message this hotel sends
leaves through it and through nothing else.** This service does not call n8n,
does not write `messages_sent`, and does not write the sentence the guest reads
- the wording lives in n8n, where the owner changes it without a deploy.

`canSend()` is **false** until the owner finishes their n8n steps
(`docs/briefs/n8n-sending.md`). Ask it before offering to send, show
`NOT_CONNECTED` where it is false, and record nothing when nothing was
attempted.

---

## What was asked for in September, and is not being built

Campaigns, what they cost, and what their guests paid - "revenue to market".
Asked for by the owner on 15 September; the Coming soon page of 16 September
describes it. **D18-17 replaced it for the first version.** It needed access to
Meta Ads and Google Ads for what a campaign cost, the leads app connected
first, and booking figures confirmed by this system rather than typed by staff.
None of those has arrived, and none is needed for the lists.

**Not in the first version either** (the brief): campaigns with stages,
anything scheduled to repeat, tracking who opened what, discount codes, and
anything the leads app already does.

---

## Rules that bind it

- **Ask the owner before deciding anything they have not answered**
  (`HANDOVER.md` §§ 3 and 5); ask the master when it is technical and shared.
- **A guest who has asked not to be written to is never on a list that sends.**
  One gate, `mayBeWrittenTo`. Request 1 above.
- **Never invent a figure; a missing one is a dash, never a zero.**
- **No long dash in anything a person reads** (D17-48, D17-59, D17-60).
- Reach other services through their `index.ts` only
  (`src/test/boundaries.test.ts`); never touch `api/src/server.ts`,
  `api/src/mount.ts`, `api/src/sending.ts`, `src/lib/permissions.ts`,
  `src/components/app/navigation.ts` or `src/components/ui/`.
- **A migration number is the next free one you can see, flagged in the commit**
  (root MEMORY 301); it cannot be reserved ahead (302). This service took none.

---

## Gates

```powershell
npx tsc -b --force
npx vitest run src/modules/marketing src/test
```

There is no API suite for this service yet and no `db/tests/modules/marketing.sql`:
it has no server route and writes no table.

---

## Requests from other services

None. To ask for something here, add a line below - date, your service, what
you need and why - and raise it with the owner.
