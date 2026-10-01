import { Receipt, FileText, Wallet, Building2, PiggyBank } from "lucide-react";
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
    /* Only for whoever may run a drawer: the server's rule (roleGate.ts
       DRAWER, `payment` create). The Viewer reads payments but was offered
       the drawer (QA RO-4). */
    canSee: (role) => can(role, "create", "payment"),
    keywords: ["cash drawer", "drawer", "shift", "hand over"] },
  /* Each morning the GM banks the days before (D27-190). Who sees it is the
     server's list (D27-191, finance/deposits.ts): the owner, an
     administrator, the GM, the accountant and the Viewer - not reception. */
  { section: "finance", order: 45,
    label: "Cash deposits", to: "/h/:code/cash-deposits", icon: PiggyBank, resource: "payment",
    canSee: (role) => ["owner", "admin", "gm", "finance", "read_only"].includes(role),
    keywords: ["bank deposit", "deposit slip", "cash to bank"] },
  { section: "finance", order: 50,
    label: "Company accounts", to: "/h/:code/city-ledger", icon: Building2, resource: "invoice",
    /* Money owed (D27-145): the server asks `invoice` view of it, so the
       revenue manager, who holds `commission` for Booking sources, does not
       see it. Round A reads the City ledger report here; the same rule. */
    canSee: (role) => can(role, "view", "invoice"),
    keywords: ["city ledger", "receivables"] },
];
