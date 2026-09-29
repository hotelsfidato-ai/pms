import { Network } from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";

/* CRS bookings - BUILT (D27-168, D27-171). Its entry left Distribution's
   "Not built yet" list and took its place under "Bookings", as Guest
   messages did: a booking the CRS sold is a booking, and the desk acts on
   what changed in the CRS from here.

   NO NEW SECTION AND NO NEW RESOURCE: `reservation` is who sees bookings
   today, and the server asks the same question (roleGate.ts). */
export const nav: ServiceNavEntry[] = [
  { section: "bookings", order: 40,
    label: "CRS bookings", to: "/h/:code/crs-bookings", icon: Network, resource: "reservation",
    keywords: ["crs", "central reservations", "partner hotels", "sales team", "fidato crs"] },
];
