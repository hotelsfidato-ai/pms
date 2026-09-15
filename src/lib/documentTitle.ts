import { useEffect } from "react";
import { useDocumentIdentity } from "@/lib/documentIdentity";

/* ══════════════════════════════════════════════════════════════════
   THE BROWSER TAB SAYS WHERE YOU ARE

   Nothing in the app ever set `document.title`, so every tab read
   "Fidato PMS". A front desk runs four tabs at once — Rooms, a bill, a
   report, the till — and they were indistinguishable in the tab strip,
   in the taskbar, and to a screen reader announcing the page.

   The tab now carries the page and the property: "Rooms · 5 Elements
   Akkalkot". The title is the page's own heading, so the menu entry, the
   heading and the tab say the same words (the clarity plan's rule 5).
   ══════════════════════════════════════════════════════════════════ */

export function useDocumentTitle(title: string | null | undefined) {
  const { property } = useDocumentIdentity();

  useEffect(() => {
    if (!title) return;
    document.title = `${title} · ${property ?? "Fidato"}`;
  }, [title, property]);
}
