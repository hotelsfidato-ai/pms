import { BadgeCheck, CalendarHeart, ClipboardList, ConciergeBell, IdCard, ListChecks, Palette } from "lucide-react";
import type { SettingsPage } from "@/components/app/settingsConsole";

/* The front desk's pages in the Settings console (phase 5 of the settings
   plan, the owner's D27-260; the contract is settingsConsole.ts). The Front
   desk page takes over P1's stand-in at front-desk/front-desk. */
const lists = () => import("./settings/ListPages");

export const settingsPages: SettingsPage[] = [
  { group: "front-desk", slug: "front-desk", label: "Front desk rules", icon: ConciergeBell, order: 10,
    keywords: ["guarantee", "bill to", "required fields", "housekeeping", "round off", "occupancy", "ADR", "RevPAR"],
    load: () => import("./settings/FrontDeskPage") },
  { group: "lists", slug: "market-segments", label: "Market segments", icon: ListChecks, order: 20,
    keywords: ["segment", "corporate", "leisure"],
    load: () => lists().then((m) => ({ default: m.MarketSegmentsPage })) },
  { group: "lists", slug: "reservation-types", label: "Reservation types", icon: Palette, order: 30,
    keywords: ["colour", "color", "booking states"],
    load: () => lists().then((m) => ({ default: m.ReservationTypesPage })) },
  { group: "lists", slug: "reasons", label: "Ready reasons", icon: ClipboardList, order: 40,
    keywords: ["remarks", "cancel reason", "void reason", "block reason", "bill correction"],
    load: () => lists().then((m) => ({ default: m.ReasonsPage })) },
  { group: "lists", slug: "holidays", label: "Holidays", icon: CalendarHeart, order: 50,
    keywords: ["festival", "public holiday"],
    load: () => lists().then((m) => ({ default: m.HolidaysPage })) },
  { group: "lists", slug: "id-types", label: "ID types", icon: IdCard, order: 60,
    keywords: ["identity", "aadhaar", "passport"],
    load: () => lists().then((m) => ({ default: m.IdTypesPage })) },
  { group: "lists", slug: "vip", label: "VIP levels", icon: BadgeCheck, order: 70,
    keywords: ["vip", "guest level"],
    load: () => lists().then((m) => ({ default: m.VipLevelsPage })) },
];
