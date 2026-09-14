import type { HomeScreen } from "./api";

/* ══════════════════════════════════════════════════════════════════
   WHERE A PERSON STARTS

   The owner's decision of 14 September: the GM sets each person's first
   screen after sign-in — Dashboard, Rooms or Calendar — and the person
   can change their own. Stored on the server (087).

   Rooms and Calendar are two screens now, each with its own address. They
   were one "Stay View" with a toggle, and the menu's "Calendar" link went
   to that one address — which opened on Rooms. Clicking "Calendar" did
   not show the calendar.

   One function turns the choice into an address, used by the landing
   after sign-in and by every menu that offers the choice, so the words
   and the destinations cannot drift apart.
   ══════════════════════════════════════════════════════════════════ */

export const HOME_SCREENS: ReadonlyArray<{ value: HomeScreen; label: string }> = [
  { value: "dashboard", label: "Dashboard" },
  { value: "rooms", label: "Rooms" },
  { value: "calendar", label: "Calendar" },
];

export const homeScreenLabel = (screen: HomeScreen | undefined): string =>
  HOME_SCREENS.find((s) => s.value === screen)?.label ?? "Dashboard";

/** The address of a person's first screen. The Dashboard needs no
    property; Rooms and Calendar do, so without one it is the Dashboard. */
export function homePath(screen: HomeScreen | undefined, code: string | null): string {
  if (!code || !screen || screen === "dashboard") return "/";
  return screen === "rooms" ? `/h/${code}/stay` : `/h/${code}/calendar`;
}
