import { Flower2, Sparkles } from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";
import { SETS_THE_LIST } from "@/modules/spa/data/spa";

/* Spa — BUILT. Its entries left the Coming soon section for the `spa`
   section the master wrote on 18 September, which carries `module: "spa"`:
   the whole service is ABSENT at a property that has not switched it on
   (D17-54), not greyed out with a reason nobody can act on.

   ⚠ AND THAT IS THE TIDY HALF ONLY. Every route asks
   `app.module_enabled(hotel, 'spa')` on its own, because a hidden entry
   is still a URL anybody can type (041, MEMORY 250).

   WHO SEES WHAT is the owner's D18-21, 18 September: housekeeping sees
   the diary and does not touch it, reception books and closes, and the
   owner, an administrator or the GM set the price list. The diary asks
   the matrix (`resource: "spa"`), which since SPA-2 grants exactly the
   server's six; the price list reads the copy in `data/spa.ts` of the
   server's own list.

   No `workingMenus`: every role's shortened menu is the owner's own list
   (15 September), and widening one is their call, not a side effect of a
   service being built. The diary is found in the section and by "Find a
   screen". */
/* ⚠ TWO LABELS MOVED BY THE MASTER AT MERGE, 19 September, because
   `navigation.test.ts` refused them and it was right both times.

   "Diary" — the banquet has had a screen by that name since before this
   service existed, and "Find a screen" flattens every section into one
   list: a clerk searching "diary" would have been offered two identical
   words and no way to tell which was which. The banquet's is live and
   the owner named it, so this one moved. "Spa diary" inside a section
   already called Spa reads as mild repetition on the sidebar and as the
   only sensible answer in search, and search is where the confusion was.

   "Treatments and therapists" was 25 characters. The sidebar is 248px
   and cuts at 21 — "Contracts and allotm…" is how that was found in
   September, by opening the screen rather than by a test. The therapists
   are names attached to treatments, not a thing of their own, so the
   shorter word loses nothing a person needs. */
export const nav: ServiceNavEntry[] = [
  /* The diary first: the question is almost always "who is free at four"
     and only then "what does a facial cost". */
  { section: "spa", order: 10,
    label: "Spa diary", to: "/h/:code/spa", icon: Flower2, resource: "spa",
    keywords: ["spa", "massage", "treatment", "therapist", "wellness", "appointment"] },
  { section: "spa", order: 20,
    label: "Treatments", to: "/h/:code/spa/setup", icon: Sparkles,
    resource: "spa", canSee: (role) => SETS_THE_LIST.includes(role),
    keywords: ["spa price list", "treatment price", "therapist", "spa setup"] },
];
