import { Receipt, FileText, Wallet, Building2 } from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";
import { can } from "@/lib/permissions";

/* Finance's menu entries — the Finance section. "Folio" is finance's word;
   the desk says "bill" (owner, 15 September). Assembled by `navigation.ts`. */
export const nav: ServiceNavEntry[] = [
  { section: "finance", order: 10,
    label: "Folios", to: "/h/:code/folios", icon: Receipt, resource: "invoice",
    keywords: ["bill", "bills", "folio"], matchPrefix: true },
  { section: "finance", order: 20,
    label: "Invoices", to: "/h/:code/invoices", icon: FileText, resource: "invoice",
    keywords: ["tax invoice", "gst invoice"], matchPrefix: true },
  { section: "finance", order: 30,
    label: "Payments", to: "/h/:code/payments", icon: Wallet, resource: "payment",
    keywords: ["receipts", "money in"] },
  /* The drawer somebody is holding right now. Beside the folios and
     payments it reconciles against, not under reports — a report is
     read afterwards, this is used during the shift. */
  { section: "finance", order: 40, workingMenus: ["front_desk"],
    label: "Cashiering", to: "/h/:code/cashiering", icon: Wallet, resource: "payment",
    keywords: ["cash drawer", "drawer", "shift", "hand over"] },
  { section: "finance", order: 50,
    label: "Company accounts", to: "/h/:code/city-ledger", icon: Building2, resource: "commission",
    /* Money owed (D27-145): the server asks `invoice` view of it, so the
       revenue manager, who holds `commission` for Booking sources, does not
       see it. Round A reads the City ledger report here; the same rule. */
    canSee: (role) => can(role, "view", "invoice"),
    keywords: ["city ledger", "receivables"] },
];
