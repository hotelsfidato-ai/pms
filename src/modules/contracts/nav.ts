import { FilePen } from "lucide-react";
import type { ServiceNavEntry } from "@/components/app/navigation";

/* Contracts, under Distribution (D27-87), built 30 September (D27-184). For
   whoever reads companies (C-6): the owner, administrators, GMs, hotel
   managers, reception, the accountant and the viewer. Assembled by
   `navigation.ts`. */
export const nav: ServiceNavEntry[] = [
  { section: "distribution", order: 40,
    label: "Contracts", to: "/contracts", icon: FilePen, resource: "company", matchPrefix: true,
    keywords: ["corporate rate", "negotiated rate", "agent contract", "company", "add company", "credit"] },
];
