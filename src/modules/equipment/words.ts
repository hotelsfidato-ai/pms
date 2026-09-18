import type { Tone } from "@/components/ui";
import { money, dateShort } from "@/lib/format";
import { ASSIGNABLE_ROLES, ROLE_LABELS, can, type Action } from "@/lib/permissions";
import type { EquipmentItem, EquipmentStatus } from "./data/equipment";

/* ══════════════════════════════════════════════════════════════════
   HOW THE REGISTER SAYS THINGS — one place, for the list and the item

   A dash for a figure nobody typed. A warranty nobody entered is a
   dash, never "expired". "Room 104" and a place's name come from the
   server already worded, so the list, the item and the export agree.
   ══════════════════════════════════════════════════════════════════ */

export const DASH = "-";

export const STATUS_LABEL: Record<EquipmentStatus, string> = {
  in_use: "In use",
  under_repair: "Under repair",
  retired: "Retired",
};

export const STATUS_TONE: Record<EquipmentStatus, Tone> = {
  in_use: "success",
  under_repair: "warning",
  retired: "neutral",
};

/** "EQ-0007" for a tagged item; "12 pieces" for a counted line. */
export const heldText = (i: Pick<EquipmentItem, "heldAs" | "tag" | "quantity">): string =>
  i.heldAs === "tagged" ? (i.tag ?? DASH) : `${i.quantity} ${i.quantity === 1 ? "piece" : "pieces"}`;

/** What it cost. A dash when nobody typed a cost — never ₹0. */
export const costText = (i: Pick<EquipmentItem, "heldAs" | "unitCost" | "totalCost" | "quantity">): string => {
  if (i.unitCost === null) return DASH;
  if (i.heldAs === "tagged" || i.quantity === 1) return money(i.unitCost);
  return `${money(i.totalCost ?? 0)} · ${money(i.unitCost)} each`;
};

/** A date, or a dash when there is none. A past date is a fact, said
    as one: "ended 31 Mar 2026". */
export const endsText = (date: string | null, today: string | null | undefined): string => {
  if (!date) return DASH;
  return today && date < today ? `ended ${dateShort(date)}` : dateShort(date);
};

/**
 * Who may, in the words people know their jobs by — built from the
 * permissions table, so the sentence cannot disagree with the rule.
 * The server's refusal names the same people from its copy of it.
 */
export function whoMay(action: Action): string {
  const labels = ASSIGNABLE_ROLES
    .filter((r) => can(r, action, "equipment"))
    .map((r) => ROLE_LABELS[r]);
  return labels.length <= 1
    ? labels.join("")
    : `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}`;
}
