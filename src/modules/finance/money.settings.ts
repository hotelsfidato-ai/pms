import { BadgePercent, Car, CreditCard, HandCoins, ReceiptText } from "lucide-react";
import type { SettingsPage } from "@/components/app/settingsConsole";

/* Money in the settings console (the owner's D27-259, migration 191). */
export const settingsPages: SettingsPage[] = [
  { group: "money", slug: "payment-methods", label: "Payment methods", icon: CreditCard, order: 10,
    keywords: ["ways of paying", "default", "UPI", "card", "Agoda"],
    load: () => import("./pages/money/PaymentMethods") },
  { group: "money", slug: "extra-charges", label: "Extra charges", icon: ReceiptText, order: 20,
    keywords: ["early check-in fee", "late check-out fee", "inclusions"],
    load: () => import("./pages/money/ExtraCharges") },
  { group: "money", slug: "discounts", label: "Discounts", icon: BadgePercent, order: 30,
    keywords: ["promotions", "rupees off"],
    load: () => import("./pages/money/Discounts") },
  { group: "money", slug: "commission", label: "Commission", icon: HandCoins, order: 40,
    keywords: ["agent", "booking source", "OTA"],
    load: () => import("./pages/money/Commission") },
  { group: "money", slug: "pickup", label: "Pickup and drop", icon: Car, order: 50,
    keywords: ["airport", "transport"],
    load: () => import("./pages/money/Pickup") },
];
