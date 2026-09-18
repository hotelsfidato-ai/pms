/* ══════════════════════════════════════════════════════════════════
   THE OPENING REGISTER, AS A FILE — the columns

   The template somebody downloads and the reader that takes it back are
   both made from this list (`importSpec.ts` beside it; src/lib/importSpec.ts
   says why one list). The server reads the same field names:
   api/src/modules/equipment/equipment.ts, POST /:code/equipment/import.

   ⚠ NO IMPORTS IN THIS FILE, on purpose. The API's own test sends every
   column here to the server and checks each one landed; the API's type
   checker cannot follow the website's `@/` paths, so the list lives where
   both can read it (EQ-4).

   NO COST IS EVER FILLED IN. A blank Cost lands as "not known" — a dash on
   screen — and is never zero. A blank Tag on a tagged row is given the
   next free EQ-number, shown in the preview before anything is written.
   ══════════════════════════════════════════════════════════════════ */

export const EQUIPMENT_COLUMNS = [
  { header: "Item", field: "name", required: true,
    note: "Split AC 1.5 ton, LED TV 43 inch, Electric kettle." },
  { header: "Category", field: "category", required: false,
    note: "Appliance, Furniture, Kitchen equipment. Made if the property "
        + "does not have it yet; capitals do not matter." },
  { header: "Held as", field: "heldAs", required: true,
    note: "tag - one thing with its own tag. count - a number of the "
        + "same thing in one place." },
  { header: "Tag", field: "tag", required: false,
    note: "For a tag row. Blank gives it the next free number (EQ-0001…). "
        + "Must be blank on a count row." },
  { header: "How many", field: "quantity", required: false,
    note: "For a count row: how many are there. Blank or 1 on a tag row." },
  { header: "Room", field: "room", required: false,
    note: "The room number it is in. Give a Room or a Place, not both." },
  { header: "Place", field: "place", required: false,
    note: "Where it is if not in a room - a place already set up at the "
        + "property, spelled the same. Putting it in a place by import is "
        + "adding it, so nothing waits for approval." },
  { header: "Supplier", field: "supplier", required: false,
    note: "A supplier already set up at the property. Blank if not known." },
  { header: "Bought on", field: "purchaseDate", required: false,
    note: "Day first: 14/03/2025. Blank if not known." },
  { header: "Cost", field: "unitCost", required: false,
    note: "Rupees, PER PIECE on a count row. Blank is NOT KNOWN - it is "
        + "never read as zero." },
  { header: "Warranty ends", field: "warrantyEnds", required: false,
    note: "Day first. Blank means nobody entered one - never 'expired'." },
  { header: "Service contract ends", field: "amcEnds", required: false,
    note: "The AMC. Day first. Blank if there is none." },
  { header: "Status", field: "status", required: false,
    note: "Blank means in use. Or: under repair." },
];

/* Plainly examples. The rooms and the place are named so that a row left
   in by mistake is refused in the preview rather than landing in a real
   room; every cost and date is blank, because the one thing this template
   must not teach is a figure nobody measured. */
export const EQUIPMENT_EXAMPLES: string[][] = [
  ["Split AC 1.5 ton", "Appliance", "tag", "", "", "Example room", "", "", "", "", "", "", ""],
  ["Electric kettle", "Appliance", "count", "", "12", "Example room", "", "", "", "", "", "", ""],
  ["Sofa, three seater", "Furniture", "tag", "", "", "", "Example lobby", "", "", "", "", "", "under repair"],
];
