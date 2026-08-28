import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { Lock } from "lucide-react";
import { cn } from "@/lib/cn";
import { money, dateShort } from "@/lib/format";
import { useUi } from "@/lib/ui";
import { Page, PageHeader, Card, Skeleton, Tooltip, ErrorState } from "@/components/ui";
import { getRateGrid, BUSINESS_DATE } from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   RATES

   Rack against achieved, fourteen days out. Rack is flat because
   there is no published rate calendar in this system — every
   difference in the achieved line is something a person negotiated on
   the day, which is exactly what a revenue manager wants to see.

   The cells are not editable, and Rule 6 says a blocked action is
   shown disabled with its reason rather than hidden. Changing a rate
   here would change nothing downstream: no channel is connected, so
   the number would move on this screen and nowhere else.
   ══════════════════════════════════════════════════════════════════ */

const WEEKEND = new Set([0, 6]);

export default function RatesPage() {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  const hotelId = params.code ?? fallback;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["rate-grid", hotelId, BUSINESS_DATE],
    queryFn: () => getRateGrid(hotelId, BUSINESS_DATE, 14),
  });

  const dates = data?.[0]?.cells.map((c) => c.date) ?? [];

  return (
    <Page>
      <PageHeader
        title="Rates"
        description="Rack rate against what each room type actually achieved, fourteen days from the business date."
      />

      <div className="flex items-start gap-3 rounded-md border border-grey-200 bg-grey-50 p-3.5 mb-5">
        <Lock className="size-4 text-grey-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-base font-medium text-ink-900">Cells are read-only</p>
          <p className="text-sm text-grey-600 mt-0.5 leading-relaxed">
            No channel is connected yet, so a rate changed here would move on this
            screen and nowhere else — not on Agoda, not on Booking.com, not in the
            confirmation a guest receives. Editing arrives with the channel bridge at
            Stage 9.
          </p>
        </div>
      </div>

      {error ? (
        <Card>
          <ErrorState
            title="The rate grid did not load"
            description="Nothing here is editable, so nothing was lost. Try again."
            error={error}
            onRetry={() => refetch()}
          />
        </Card>
      ) : isLoading ? (
        <Skeleton className="h-56 w-full" />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-grey-200 bg-grey-50">
                  <th className="sticky left-0 z-10 bg-grey-50 px-4 py-2.5 text-left text-2xs font-semibold uppercase tracking-wide text-grey-500 whitespace-nowrap">
                    Room type
                  </th>
                  {dates.map((d) => {
                    const weekend = WEEKEND.has(new Date(`${d}T00:00:00Z`).getUTCDay());
                    return (
                      <th
                        key={d}
                        className={cn(
                          "px-3 py-2.5 text-right text-2xs font-semibold uppercase tracking-wide whitespace-nowrap",
                          weekend ? "text-ink-900" : "text-grey-500",
                        )}
                      >
                        {dateShort(d)}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {(data ?? []).map((row) => (
                  <tr key={row.roomType} className="border-b border-grey-100">
                    <th className="sticky left-0 z-10 bg-white px-4 py-3 text-left font-medium text-ink-900 whitespace-nowrap">
                      {row.roomType}
                      <span className="block text-2xs font-normal text-grey-500 tabular">
                        rack {money(row.rackRate)}
                      </span>
                    </th>
                    {row.cells.map((c) => {
                      const below = c.soldAdr !== null && c.soldAdr < c.rackRate;
                      return (
                        <td key={c.date} className="px-3 py-3 text-right align-middle whitespace-nowrap">
                          {c.soldAdr === null ? (
                            <Tooltip content={`Nothing sold — ${c.sellable} ${row.roomType} rooms open`}>
                              <span className="text-grey-300">—</span>
                            </Tooltip>
                          ) : (
                            <Tooltip
                              content={`${c.sold} of ${c.sellable} sold · rack ${money(c.rackRate)}`}
                            >
                              <span
                                className={cn(
                                  "tabular font-medium",
                                  below ? "text-brand-tangerine" : "text-ink-900",
                                )}
                              >
                                {money(c.soldAdr)}
                              </span>
                            </Tooltip>
                          )}
                          <span className="block text-2xs text-grey-400 tabular mt-0.5">
                            {c.sold}/{c.sellable}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <p className="text-xs text-grey-500 mt-4 leading-relaxed">
        A tangerine figure sold below rack. The line beneath each rate is rooms sold
        against rooms sellable — a rate held at rack against an empty house is worth
        as much attention as a discounted one.
      </p>
    </Page>
  );
}
