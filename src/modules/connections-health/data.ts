import { api } from "@/lib/api";

/* Connection health (D27-276) - the seam. The server judges each connection
   and decides who may see it (the owner, an administrator, the GM). */

export type ConnectionStatus = "green" | "amber" | "red" | "grey";

export interface Connection {
  key: string;
  label: string;
  status: ConnectionStatus;
  /** One sentence: what the colour means here. */
  summary: string;
  lastSuccess: string | null;
  lastError: { at: string | null; detail: string | null } | null;
}

export interface ConnectionsHealth {
  /** Whether the server has the owner's address for the alert email. Never the address. */
  alertsTo: boolean;
  connections: Connection[];
}

export const getConnectionsHealth = (hotel: string) =>
  api<ConnectionsHealth>(`/api/hotels/${encodeURIComponent(hotel)}/connections-health`);
