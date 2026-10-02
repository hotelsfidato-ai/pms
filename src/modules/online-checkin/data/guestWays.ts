import { api } from "@/lib/api";
import { at, withUnlock } from "@/modules/online-checkin/data/guestPage";

/* Two more ways into the guest's page (D27-235): the room and the phone
   (2.4), and DigiLocker (2.5, off until it is set up). Each ends where the
   others do - this phone's unlock kept for the link, then the page.

   ⚠ THE KEY IS THE GUEST PAGE'S OWN (`data/guestPage.ts`, not exported
   there): "guest-unlock:" and the token's first twelve characters.
   guestWays.test.tsx reads it back through that file's `withUnlock`, so the
   two cannot drift apart. */
const KEY = (token: string) => `guest-unlock:${token.slice(0, 12)}`;

export function keepUnlockFor(token: string, unlock: string): void {
  try { localStorage.setItem(KEY(token), unlock); } catch { /* a private tab: asked again */ }
}

/** The token waits in this tab only while the guest is at DigiLocker. */
export const DIGILOCKER_TOKEN = "guest-digilocker";

const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export const sendRoomCode = (hotel: string, room: string, phone: string) =>
  api<{ sent: boolean; message: string; ticket?: string; devCode?: string }>(
    "/api/guest/by-room/send", post({ hotel, room, phone }));

export const openByRoom = (ticket: string, code: string) =>
  api<{ verified: true; unlock: string }>("/api/guest/by-room/open", post({ ticket, code }));

export const digilockerOffered = (token: string) =>
  api<{ offered: boolean }>(`/api/guest/${encodeURIComponent(token)}/digilocker`);

export const startDigilocker = (token: string) =>
  api<{ url: string }>(`/api/guest/${encodeURIComponent(token)}/digilocker`, { method: "POST" });

export const finishDigilocker = (code: string, state: string) =>
  api<{ verified: true; unlock: string }>("/api/guest/digilocker/finish", post({ code, state }));

/* A wake-up call from the guest's page (D27-241), behind the code. */
export const getWakeUps = (token: string) =>
  api<{ calls: Array<{ callAt: string; status: string }> }>(at(token, "/wake-up"), withUnlock(token));
export const askWakeUp = (token: string, day: string, time: string) =>
  api<{ sent: true }>(at(token, "/wake-up"), withUnlock(token, { method: "POST", body: JSON.stringify({ day, time }) }));
