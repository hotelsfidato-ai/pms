import { Building2, Images, ScrollText, Sparkles, Wifi } from "lucide-react";
import type { SettingsPage } from "@/components/app/settingsConsole";

/* The property's pages in the Settings console (phase 2; D27-249, D27-257).
   Profile takes over phase 1's stand-in: the checklist, its profile card,
   then the registration numbers and the map link. */
export const settingsPages: SettingsPage[] = [
  { group: "property", slug: "profile", label: "Profile", icon: Building2, order: 10,
    keywords: ["property profile", "address", "GSTIN", "PAN", "FSSAI", "registration numbers", "map point",
               "reservations contact", "property type", "stars"],
    load: () => import("./pages/property/Profile") },
  { group: "property", slug: "photos", label: "Photos", icon: Images, order: 20,
    keywords: ["gallery", "pictures"], load: () => import("./pages/property/Photos") },
  { group: "property", slug: "highlights", label: "Highlights", icon: Sparkles, order: 30,
    keywords: ["about", "attractions", "directions", "landmarks", "activities"],
    load: () => import("./pages/property/Highlights") },
  { group: "property", slug: "amenities", label: "Amenities", icon: Wifi, order: 40,
    keywords: ["facilities", "wifi", "parking"], load: () => import("./pages/property/Amenities") },
  { group: "property", slug: "policies", label: "Policies", icon: ScrollText, order: 50,
    keywords: ["house policies", "parking", "children", "child age", "terms"],
    load: () => import("./pages/property/Policies") },
];
