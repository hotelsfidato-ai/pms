# A service that is still Coming soon — your brief

**Read `docs/briefs/README.md` first.** It holds the five rules, how to make
your own working copy, the list of files nobody but the master may change, and
the gates. This file is for the eighteen services that have a folder, a page
and a menu entry — and nothing else yet.

---

## What you are actually looking at

Since 16 September every service this system does not have has:

```
src/modules/<service>/MODULE.md      a full brief: what it would be, what it
                                     would lean on, the rules that will bind
                                     it, and "When it is built"
src/modules/<service>/pages/…        ONE page, which says the service is
                                     coming and what it needs first
src/modules/<service>/nav.ts         a menu entry in the "Coming soon"
                                     section, shown to the owner, admins and
                                     GMs only (`seesComingSoon`)
src/modules/<service>/index.ts       an empty front door
src/modules/<service>/DEFECTS.md     empty, waiting
api/src/modules/<service>/           DOES NOT EXIST
db/tests/modules/<service>.sql       DOES NOT EXIST
```

**The `MODULE.md` is not a placeholder.** It was written from the code and from
the owner's own decisions, it names what blocks the service, and it has a "When
it is built" list. **Read all of it before you form an opinion.**

---

## The rule that governs this whole folder

**Nothing here is built until the owner says which one, in words.** Not the
schema, not a route, not a screen. `AGENTS.md`: *"Building a service that is
still Coming soon? Only after the owner has said which."*

That is not bureaucracy. Most of these are blocked on a fact only the owner
holds — what a partner's API returns, what a contract says, how many kitchens a
property has, whether a figure is real. A service built on a guess about any of
those is worse than no service, because it looks finished.

### What you may do today, without asking

- Read everything: the `MODULE.md`, `docs/HMS-INTEGRATION-PLAN.md`,
  `docs/APPS-PLAN.md`, `PENDING.md`, and the service's own `DEFECTS.md`.
- **Sharpen the brief.** If the `MODULE.md` is vague about what the service
  needs, make it precise — and say what you changed.
- **Write the questions.** The most useful thing an agent on a blocked service
  can produce is a short list of decisions the owner must make, each with a
  recommendation and the consequence of each answer. Put them in the
  `MODULE.md` and bring them to the owner.
- **Check the ground it will stand on.** Does the data it needs exist? Is the
  route it will call already there? Write the answer down.

### What you may NOT do until the owner has said so

- Create `api/src/modules/<service>/`, any route, any migration, any table.
- Turn the Coming soon page into a working screen.
- Move the menu entry out of the Coming soon section.
- Promise a date, or write copy that implies the service exists.

---

## When the owner does say "build it"

Then, and only then, in this order:

1. **Claim it** — `.claims/<service>.md` — and take your own copy and database.
2. Its **real screens** replace `pages/<Name>.tsx`, at their real addresses in
   your own `routes.tsx`.
3. Its **menu entry moves** out of `"coming-soon"` in your `nav.ts` into its
   working section — and **`src/components/app/navigation.test.ts` pins the
   Coming soon list, so it will fail until the master updates the pin.** Tell
   them; do not edit that file.
4. A **module switch** if not every hotel has the service (see how `pos` and
   `banquet` do it — migration 041).
5. `api/src/modules/<service>/index.ts` with its mounts, added to
   `api/src/server.ts` — **`server.ts` is the master's file**, so that one line
   is a request, not your edit.
6. `db/tests/modules/<service>.sql`, and **a migration number from the master**.
7. Your `MODULE.md` stops saying "not built".

---

## The eighteen, what blocks each, and the first useful thing

| Service | What blocks it | The first useful thing an agent can do |
|---|---|---|
| **channel-manager** | The owner said 15 Sep it is being defined and finalised. Excluded 8 Sep. No contract, no vendor, no credentials | `docs/briefs/channel-manager.md` |
| **crs** | The Fidato CRS's API documents have never been supplied. D5, D8, D14 in the integration plan | `docs/briefs/crs.md` |
| **leads** | The WhatsApp/Meta app exists separately (`D:\fidato tools`). D2 (where n8n lives), D13 (the em-dash rule) | `docs/briefs/leads.md` |
| **crm** | Needs the CRS and the leads app to exist as sources first. D1 says the PMS is the record | `docs/briefs/crm.md` |
| **payments** | Payment gateway **excluded by the owner, 8 September**, with the channel manager | Write what a gateway would have to satisfy here — statutory invoice numbers, the folio, refunds — so the choice is informed when it is made |
| **booking-engine** | Nothing decided. `docs/APPS-PLAN.md` A10 says the guest app cannot precede it | List what the PMS would have to expose publicly, and what it must never expose |
| **online-checkin** | Same as the booking engine; identity capture (migration 026) already exists and is the half that is built | Say exactly which parts of check-in could be done by a guest before arrival, and which cannot in law |
| **revenue-management** | Needs the pricing work to settle first (`docs/PRICING-PLAN.md`) | Read the pricing plan. Anything that moves a price automatically fights the owner's rule that a price is a number a person typed |
| **accounting** | Tally is what the group uses. No export format agreed | Find out what Tally needs and write it down |
| **contracts** | Corporate rates and allotments; needs `bookingSources` and commission (migration 082) | Map what exists against what a contract needs |
| **guest-messaging** | Overlaps the leads app's WhatsApp workflows — D2 | Say plainly which messages belong here and which belong in the leads app |
| **guest-services** · **laundry** · **spa** · **equipment** | Each posts a charge to a folio. None is defined | One question: does the hotel actually sell it, and who takes the order? |
| **loyalty** · **marketing** · **reputation** | Nothing decided, no data source | Leave them. Ask the owner whether they are wanted at all before spending anything |

---

## The code to start one of these

For the four with their own brief, use that brief's name. For the rest:

```
You are the <service> agent for Fidato PMS. Read docs/briefs/coming-soon.md and
src/modules/<service>/MODULE.md, and follow them exactly. This service is not
built: do not build it. Produce the decisions the owner must make, each with a
recommendation, and stop there.
```
