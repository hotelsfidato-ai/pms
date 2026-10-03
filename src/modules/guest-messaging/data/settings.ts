import { api } from "@/lib/api";

/* Settings → Messages (Settings phase 6; D27-252, D27-261) - the seam.
   The server decides who may (the owner, an administrator, the GM) and
   what "no saved switch" means (today's behaviour; the invoice off). */

export interface MessageSwitch {
  kind: string;
  label: string;
  when: string;
  isOn: boolean;
  /** The invoice only: invoices issued before it never go by themselves. */
  switchedOnAt?: string | null;
  changedBy: string | null;
  changedAt: string | null;
}

export interface MessageSwitches {
  messages: MessageSwitch[];
  catchUp: { from: string; until: string };
}

export const getMessageSwitches = (hotel: string) =>
  api<MessageSwitches>(`/api/hotels/${hotel}/guest-message-settings`);

export const setMessageSwitch = (
  hotel: string, kind: string, body: { isOn: boolean },
) => api<{ ok: true }>(`/api/hotels/${hotel}/guest-message-settings/${kind}`, {
  method: "PUT", body: JSON.stringify(body),
});

export interface ReportEmails {
  reports: { key: string; title: string }[];
  people: { id: string; name: string; email: string }[];
  chosen: { report: string; staffId: string }[];
}

export const getReportEmails = (hotel: string) => api<ReportEmails>(`/api/hotels/${hotel}/report-emails`);

export const setReportEmails = (hotel: string, chosen: ReportEmails["chosen"]) =>
  api<{ ok: true }>(`/api/hotels/${hotel}/report-emails`, { method: "PUT", body: JSON.stringify({ chosen }) });

export const sendInvoice = (hotel: string, number: string) =>
  api<{ ok: true }>(`/api/hotels/${hotel}/invoices/${number}/send`, { method: "POST", body: "{}" });
