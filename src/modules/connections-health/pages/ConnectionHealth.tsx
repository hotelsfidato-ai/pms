import { useQuery } from "@tanstack/react-query";
import { Card, Page, PageHeader, ReadFailed, SkeletonCards, StatusPill, type Tone } from "@/components/ui";
import { dateTime } from "@/lib/format";
import { useUi } from "@/lib/ui";
import { getConnectionsHealth, type Connection, type ConnectionStatus } from "../data";

/* ══════════════════════════════════════════════════════════════════
   SETTINGS → MODULES AND CONNECTIONS → CONNECTION HEALTH (D27-276)

   Every outside connection - emails and WhatsApp through n8n, the CRS,
   Firebase sign-in, the backups, the server's disk (resilience A2),
   rivals' prices - green, amber, red or grey, with its last success and
   its last error. Judged on the server
   (api/src/modules/connections-health/health.ts), for the hotel in the
   top bar; the backups, the disk and Firebase are the server's own. Read only.
   ══════════════════════════════════════════════════════════════════ */

const PILL: Record<ConnectionStatus, { tone: Tone; words: string }> = {
  green: { tone: "success", words: "Working" },
  amber: { tone: "warning", words: "Needs a look" },
  red: { tone: "danger", words: "Not working" },
  grey: { tone: "neutral", words: "Not set up" },
};

function Item({ c }: { c: Connection }) {
  const pill = PILL[c.status];
  return (
    <li aria-label={c.label} className="px-4 py-3.5 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-base font-medium text-ink-900">{c.label}</p>
        <p className="text-sm text-grey-600 mt-0.5">{c.summary}</p>
        <p className="text-xs text-grey-500 mt-1">
          Last success: {dateTime(c.lastSuccess)}
          {c.lastError && <> · Last error: {dateTime(c.lastError.at)}{c.lastError.detail ? ` - ${c.lastError.detail}` : ""}</>}
        </p>
      </div>
      <StatusPill tone={pill.tone}>{pill.words}</StatusPill>
    </li>
  );
}

export default function ConnectionHealth() {
  const hotel = useUi((s) => s.hotelId);
  const q = useQuery({
    queryKey: ["connections-health", hotel], queryFn: () => getConnectionsHealth(hotel), enabled: !!hotel,
  });

  return (
    <Page>
      <PageHeader title="Connection health"
        description="Every outside connection this system uses, for the property in the top bar. Backups, the disk and Firebase are the server's own." />
      {q.isError && <ReadFailed error={q.error} what="the connections' health" onRetry={() => void q.refetch()} />}
      {q.isPending && !q.isError && <SkeletonCards count={3} />}
      {q.data && (
        <>
          <Card>
            <ul className="divide-y divide-grey-100">
              {q.data.connections.map((c) => <Item key={c.key} c={c} />)}
            </ul>
          </Card>
          <p className="text-sm text-grey-600 mt-3">
            {q.data.alertsTo
              ? "When a connection turns red, the owner is emailed once: at most once an hour for each connection, and never while emails are not working, because that email could not go."
              : "Alert emails are off: the server's settings have no address for them yet (HEALTH_ALERT_EMAIL). They would never go while emails are not working, because that email could not go."}
          </p>
        </>
      )}
    </Page>
  );
}
