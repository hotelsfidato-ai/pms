import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, Page, PageHeader, ReadFailed, Switch, toast } from "@/components/ui";
import { dateShort } from "@/lib/format";
import { useUi } from "@/lib/ui";
import { getRivalsSwitch, setRivalsSwitch } from "../data";

/* ══════════════════════════════════════════════════════════════════
   SETTINGS → MODULES AND CONNECTIONS → RIVALS' PRICES (D27-270)

   One switch for this hotel: whether nearby hotels' lowest public prices
   are checked (Google Hotels, through SerpApi), the next 30 nights, on
   Mondays and Thursdays from 06:00. Off until switched on. It searches
   nothing while the server has no SERPAPI_KEY, and says so. Revenue
   outlook shows what was found; nothing here changes a price.
   ══════════════════════════════════════════════════════════════════ */

export default function RivalsPrices() {
  const hotel = useUi((s) => s.hotelId);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["rivals-switch", hotel], queryFn: () => getRivalsSwitch(hotel), enabled: !!hotel });
  const save = useMutation({
    mutationFn: (isOn: boolean) => setRivalsSwitch(hotel, isOn),
    onSuccess: () => { toast.success("Saved"); void qc.invalidateQueries({ queryKey: ["rivals-switch", hotel] }); },
    onError: (e) => toast.error("Not saved", e instanceof Error ? e.message : undefined),
  });

  return (
    <Page>
      <PageHeader title="Rivals' prices"
        description="Nearby hotels' lowest public prices, shown beside each suggestion on Revenue outlook. Nothing here changes a price." />
      {q.isError && <ReadFailed error={q.error} what="the rivals' prices switch" onRetry={() => void q.refetch()} />}
      {q.data && (
        <Card>
          <div className="px-4 py-3.5 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-base font-medium text-ink-900">Check nearby hotels' prices</p>
              <p className="text-sm text-grey-600 mt-0.5">
                The next 30 nights, on Mondays and Thursdays from 06:00, the hotel's time:
                each nearby hotel's lowest price on Google Hotels. About 260 searches a month.
              </p>
              {q.data.lastRunOn && (
                <p className="text-sm text-grey-600 mt-0.5">Last checked {dateShort(q.data.lastRunOn)}.</p>
              )}
              {q.data.changedBy && <p className="text-xs text-grey-500 mt-0.5">Last changed by {q.data.changedBy}</p>}
            </div>
            <Switch checked={q.data.isOn} disabled={save.isPending}
              label={<span className="sr-only">Check nearby hotels' prices</span>}
              onCheckedChange={(isOn) => save.mutate(isOn)} />
          </div>
          {!q.data.keySet && (
            <p className="px-4 py-3 text-sm text-grey-600 border-t border-grey-100">
              The server has no search key yet (SERPAPI_KEY), so nothing is checked for any hotel.
            </p>
          )}
        </Card>
      )}
    </Page>
  );
}
