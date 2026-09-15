import { Globe } from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";

/* The channel manager — parked by the owner. Assembled by `navigation.ts`. */
export const nav: ServiceNavEntry[] = [
  /* Excluded by the owner and not connected. Its screen says so to
     anybody who searches for it; the menu does not advertise it. */
  { section: "inventory", order: 30,
    label: "Channel manager", to: "/h/:code/channels", icon: Globe, resource: "rate",
    keywords: ["staah", "ota", "channels"], listed: false },
];
