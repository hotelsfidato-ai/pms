import { api } from "@/lib/api";

/* ══════════════════════════════════════════════════════════════════
   LEADS AND WHATSAPP — the seam (D27-100, D27-170)

   Read LIVE from the leads app every time a screen asks: the PMS keeps
   no copy, so a guest erased there is gone here the next time anybody
   looks. `ref` is a short-lived token the server hands out with the list
   (2 hours, this hotel only). The app's own id holds the guest's number,
   so it never reaches the website.
   ══════════════════════════════════════════════════════════════════ */

export interface Lead {
  ref: string;
  name: string | null;
  phone: string | null;
  /** The app's own status: NEW, ASSIGNED, CLAIMED, CONTACTED, FOLLOW_UP,
      QUOTED, BOOKED, LOST, LONG_TERM, DEAD, OVERDUE, CLOSED. */
  status: string;
  category: string | null;
  /** The app's channel: meta_ads, google_ads, website, direct_whatsapp,
      referral, walk_in_phone, manual, other. */
  channel: string;
  bookingRef: string | null;
  /** As staff typed it in the app when they marked it booked. */
  bookingValue: number | null;
  doNotContact: boolean;
  receivedAt: string | null;
  lastMessageAt: string | null;
  lastMessage: string | null;
}

export interface LeadsPage {
  /** False until the owner's settings are on the server (OWNER-STEPS.md). */
  connected: boolean;
  /** False when this property is not one of the leads app's hotels. */
  inApp: boolean;
  leads: Lead[];
  /** Where the next, older page starts; null when there is none. */
  more: string | null;
}

export interface Message {
  direction: "in" | "out";
  kind: string;
  body: string;
  at: string | null;
}

export interface Conversation {
  messages: Message[];
  /** The lead's page in the leads app, where staff reply. */
  replyUrl: string | null;
}

/** What New booking pre-fills from a lead (the one-page lane reads it). */
export interface LeadForBooking {
  name: string | null;
  phone: string | null;
  channel: string;
  /** Meta Ads, Google Ads, WhatsApp or Website by channel (D27-170);
      null for any other channel: the desk picks. */
  bookingSourceId: string | null;
  /** The leads app's campaign key, kept on the booking; null when none. */
  campaign: string | null;
}

export function getLeads(code: string, before?: string | null): Promise<LeadsPage> {
  return api<LeadsPage>(`/api/hotels/${code}/leads${before ? `?before=${encodeURIComponent(before)}` : ""}`);
}

export function getConversation(code: string, ref: string): Promise<Conversation> {
  return api<Conversation>(`/api/hotels/${code}/leads/${encodeURIComponent(ref)}`);
}

/** For New booking: /h/:code/book?lead=<token>. Read live, so an erased
    guest never pre-fills; an expired token answers 404 with a sentence. */
export function fetchLeadForBooking(code: string, token: string): Promise<LeadForBooking> {
  return api<LeadForBooking>(`/api/hotels/${code}/leads/${encodeURIComponent(token)}/booking`);
}

/** The address "Book this lead" opens. */
export const bookingPathFor = (code: string, ref: string) => `/h/${code}/book?lead=${encodeURIComponent(ref)}`;

/* The app's own words for its statuses and channels (its leads/model.js
   STATUS_LABELS and leads/marketing.js CHANNEL_LABELS): staff read the
   same word in both places. */
export const STATUS_LABELS: Readonly<Record<string, string>> = {
  NEW: "New", ASSIGNED: "Assigned", CLAIMED: "Claimed", CONTACTED: "Contacted",
  FOLLOW_UP: "Follow-up", QUOTED: "Quoted", BOOKED: "Booked", LOST: "Lost",
  LONG_TERM: "Long term", DEAD: "Dead", OVERDUE: "Overdue", CLOSED: "Closed",
};

export const CHANNEL_LABELS: Readonly<Record<string, string>> = {
  meta_ads: "Meta Ads", google_ads: "Google Ads", website: "Website organic",
  direct_whatsapp: "Direct WhatsApp", referral: "Referral", walk_in_phone: "Walk-in or phone",
  manual: "Manual entry", other: "Other",
};
