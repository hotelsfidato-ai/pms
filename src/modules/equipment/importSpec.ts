import type { ImportSpec } from "@/lib/importSpec";
import { EQUIPMENT_COLUMNS, EQUIPMENT_EXAMPLES } from "@/modules/equipment/importColumns";

/* ══════════════════════════════════════════════════════════════════
   THE OPENING REGISTER, AS A FILE

   One spec, two uses — the template and the reader that takes it back
   (src/lib/importSpec.ts says why). Kept in this service rather than beside
   the Store's and the menu's, because that file is the shared core's; the
   shape is the same. The columns themselves are in `importColumns.ts`, a
   file with no imports, so the API's test can send every one of them.
   ══════════════════════════════════════════════════════════════════ */

export const EQUIPMENT_SPEC: ImportSpec = {
  what: "equipment",
  filename: "equipment-template",
  columns: EQUIPMENT_COLUMNS,
  examples: EQUIPMENT_EXAMPLES,
};
