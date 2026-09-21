/* Central CRM — the front door, the only file another service may import
   (src/test/boundaries.test.ts). Built 21 September (docs/briefs/crm.md):
   Guest 360 and the "possible same person" list, in the "Guests & CRM"
   section. The stay panel links a guest's name to Guest 360 for the three
   who may open it. */
export { seesGuest360 } from "./access";

/** Where one guest's Guest 360 is. */
export const guest360Path = (guestId: string): string => `/crm/guests/${guestId}`;
