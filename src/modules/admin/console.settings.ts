import {
  Building2, Image, ScrollText, ShieldAlert, Network, LayoutDashboard, IndianRupee, Percent, Landmark,
  Plug, ConciergeBell, MessageSquare, Star, Smartphone, UserCog, ShieldCheck, Activity, LogIn, KeyRound,
  ToggleRight, Globe,
} from "lucide-react";
import type { SettingsPage } from "@/components/app/settingsConsole";
import { switchesModules } from "./moduleSwitchRoles";

/* ══════════════════════════════════════════════════════════════════
   PHASE 1'S STAND-INS (D27-249, D27-256): what the console holds today

   Settings' five tabs, re-homed unchanged: each card on a page of its group,
   and each screen a tab linked to as a link (↗) that opens it in the Front
   office, under the menu's own name. A phase that builds a page registers
   the SAME group and slug in its own *.settings.ts and the stand-in goes by
   itself - nobody edits this list to take one over.
   ══════════════════════════════════════════════════════════════════ */

const page = (name: keyof typeof import("./pages/ConsolePages")) =>
  () => import("./pages/ConsolePages").then((m) => ({ default: m[name] }));

export const settingsPages: SettingsPage[] = [
  { group: "property", slug: "profile", label: "Profile", icon: Building2, order: 10, standIn: true,
    keywords: ["property profile", "address", "GSTIN", "PAN", "FSSAI", "office details", "Instagram",
               "reservations contact", "map point", "property type", "stars"],
    load: page("ProfileSettings") },
  { group: "property", slug: "photos", label: "Logo and photos", icon: Image, order: 20, standIn: true,
    keywords: ["logo", "gallery", "pictures"], load: page("PhotosSettings") },
  { group: "property", slug: "policies", label: "Policies", icon: ScrollText, order: 30, standIn: true,
    keywords: ["house policies", "rules for guests"], load: page("PoliciesSettings") },
  { group: "property", slug: "cancellation-terms", label: "Cancellation terms", icon: ShieldAlert, order: 40,
    standIn: true, to: "/h/:code/cancellation-terms" },
  { group: "property", slug: "group", label: "Group", icon: Network, order: 50, standIn: true,
    keywords: ["group name", "group logo"], load: page("GroupSettings") },

  { group: "rooms", slug: "room-types", label: "Room types", icon: LayoutDashboard, order: 10, standIn: true,
    to: "/h/:code/room-types" },

  { group: "rates", slug: "rates", label: "Rates", icon: IndianRupee, order: 10, standIn: true, to: "/h/:code/rates" },
  { group: "rates", slug: "taxes", label: "Taxes", icon: Percent, order: 20, standIn: true,
    keywords: ["GST", "VAT", "tax", "tax rules", "rates and taxes"], load: page("TaxesSettings") },

  { group: "money", slug: "bank", label: "Bank details", icon: Landmark, order: 10, standIn: true,
    keywords: ["bank", "IFSC", "UPI", "account number"], load: page("BankSettings") },

  { group: "lists", slug: "booking-sources", label: "Booking sources", icon: Plug, order: 10, standIn: true,
    to: "/h/:code/booking-sources" },

  { group: "front-desk", slug: "times-and-rules", label: "Times and rules", icon: ConciergeBell, order: 10,
    standIn: true,
    keywords: ["check-in time", "check-out time", "front desk hours", "front desk rules", "overbooking",
               "advance", "way of paying", "weekend"],
    load: page("FrontDeskSettings") },

  { group: "messages", slug: "guest-messages", label: "Guest messages", icon: MessageSquare, order: 10,
    standIn: true, to: "/h/:code/guest-messages" },
  { group: "messages", slug: "reviews", label: "Reviews", icon: Star, order: 20, standIn: true,
    to: "/h/:code/reviews" },
  { group: "messages", slug: "online-checkin", label: "Online check-in", icon: Smartphone, order: 30,
    standIn: true, to: "/h/:code/online-checkin" },

  { group: "people", slug: "people", label: "People", icon: UserCog, order: 10, standIn: true, to: "/people" },
  { group: "people", slug: "roles", label: "Roles and permissions", icon: ShieldCheck, order: 20, standIn: true,
    to: "/admin/roles" },
  { group: "people", slug: "audit-log", label: "Audit log", icon: ScrollText, order: 30, standIn: true,
    to: "/admin/audit-log" },
  { group: "people", slug: "activity", label: "Activity", icon: ScrollText, order: 40, standIn: true,
    to: "/admin/activity" },
  { group: "people", slug: "sign-ins", label: "Sign-ins", icon: LogIn, order: 50, standIn: true,
    to: "/admin/sign-ins" },
  { group: "people", slug: "signing-in", label: "Signing in", icon: KeyRound, order: 60, standIn: true,
    keywords: ["password", "sign in", "minimum password"], load: page("SigningInSettings") },

  /* D17-36: the switches are the owner's and an Admin's. */
  { group: "connections", slug: "modules", label: "Modules", icon: ToggleRight, order: 10, standIn: true,
    canSee: switchesModules,
    keywords: ["modules", "switch on", "point of sale", "banquet", "reception can use the POS",
               "new booking sections"],
    load: page("ModulesSettings") },
  { group: "connections", slug: "channels", label: "Channel manager", icon: Globe, order: 20, standIn: true,
    to: "/h/:code/channels" },
  { group: "connections", slug: "crs", label: "CRS bookings", icon: Network, order: 30, standIn: true,
    to: "/h/:code/crs-bookings" },
  { group: "connections", slug: "integrations", label: "Integrations", icon: Plug, order: 40, standIn: true,
    to: "/admin/integrations" },
  { group: "connections", slug: "system-health", label: "System health", icon: Activity, order: 50,
    standIn: true, to: "/admin/system-health" },
];
