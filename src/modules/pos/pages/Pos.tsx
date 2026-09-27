import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "react-router";
import { UtensilsCrossed, KeyRound, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/cn";
import { money, dateLong } from "@/lib/format";
import { useUi } from "@/lib/ui";
import {
  Page, PageHeader, Card, CardBody, DataTable, StatusPill, Tooltip, IconChip,
  type Column,
} from "@/components/ui";
import { listPosOutlets, listPosTickets, type PosOutlet, type PosTicket } from "@/modules/pos/data/posBridge";
import { BUSINESS_DATE } from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   POINT OF SALE

   This route was a placeholder reading "unspecified — Sattva is live
   in eZee today, so this is a migration". That is still true of the
   TILL. What changed is that the bridge it posts across exists, was
   tested, and had no interface — so settling a restaurant-charge
   dispute meant running SQL.

   WHAT THIS SCREEN IS FOR

   The refusals. A bill that landed is already visible on the guest's
   folio; a bill that was REFUSED is visible nowhere else, and "the
   restaurant says they charged it, the folio says otherwise" is the
   argument this page exists to end.

   WHAT IT IS NOT

   Not the till. No menu, no orders, no tables — this screen watches
   the BOUNDARY. Stage 8 built the PMS's own till on /till, and it
   posts across this same boundary rather than around it, so what
   arrives here now includes the hotel's own restaurant as well as
   Sattva's.
   ══════════════════════════════════════════════════════════════════ */

function useHotel(): string {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  return params.code ?? fallback;
}

const OUTLET_COLUMNS: Column<PosOutlet>[] = [
  {
    key: "name", header: "Outlet",
    cell: (o) => (
      <div className="min-w-0">
        <p className="truncate">{o.name}</p>
        <p className="text-2xs text-grey-500 tabular">{o.code}</p>
      </div>
    ),
  },
  {
    key: "category", header: "Posts to", hideBelow: "sm",
    cell: (o) => <span className="text-grey-600">{o.category}</span>,
  },
  {
    key: "bills", header: "Bills", numeric: true,
    cell: (o) => <span className="tabular">{o.bills}</span>,
  },
  {
    key: "state", header: "",
    cell: (o) =>
      !o.isActive ? (
        <StatusPill tone="neutral">inactive</StatusPill>
      ) : o.hasKey ? (
        <StatusPill tone="success">connected</StatusPill>
      ) : (
        /* An outlet with no key cannot post. A restaurant that believes
           it is connected and is not finds out at the end of a shift,
           with a till full of charges nobody can place. */
        <Tooltip content="No API key has been issued. This outlet cannot post a charge.">
          <span><StatusPill tone="danger">no key</StatusPill></span>
        </Tooltip>
      ),
  },
];

const TICKET_COLUMNS: Column<PosTicket>[] = [
  {
    key: "ref", header: "Bill",
    cell: (t) => (
      <div className="min-w-0">
        <p className="tabular truncate">{t.ticketRef}</p>
        <p className="text-2xs text-grey-500">{t.outlet}</p>
      </div>
    ),
  },
  {
    key: "guest", header: "Charged to",
    cell: (t) =>
      t.guest ? (
        <div className="min-w-0">
          <p className="truncate">{t.guest}</p>
          <p className="text-2xs text-grey-500 tabular">room {t.room}</p>
        </div>
      ) : (
        /* Nothing, because a refused bill never reached a folio. Not a
           dash pretending to be a value. */
        <span className="text-grey-500 text-2xs">nobody - refused</span>
      ),
  },
  {
    key: "received", header: "Received", hideBelow: "md",
    cell: (t) => (
      <div>
        <span className="tabular text-grey-600">{t.receivedAt}</span>
        <p className="text-2xs text-grey-500 tabular">
          {dateLong(t.businessDate)}
        </p>
      </div>
    ),
  },
  {
    key: "amount", header: "Amount", numeric: true,
    cell: (t) => (
      <span className={cn("tabular", t.status === "rejected" && "text-grey-500")}>
        {money(t.amount + t.tax)}
      </span>
    ),
  },
  {
    key: "state", header: "",
    cell: (t) =>
      t.status === "posted" ? (
        <StatusPill tone="success">on the bill</StatusPill>
      ) : t.status === "voided" ? (
        <Tooltip content="A reversing entry cancels it. Both rows stay on the bill.">
          <span><StatusPill tone="warning">voided</StatusPill></span>
        </Tooltip>
      ) : (
        <Tooltip content={t.reason ?? "Refused."}>
          <span><StatusPill tone="danger">refused</StatusPill></span>
        </Tooltip>
      ),
  },
];

export default function PosPage() {
  const hotelId = useHotel();

  const outlets = useQuery({
    queryKey: ["pos-outlets", hotelId],
    queryFn: () => listPosOutlets(hotelId),
  });
  const tickets = useQuery({
    queryKey: ["pos-tickets", hotelId, BUSINESS_DATE],
    queryFn: () => listPosTickets(hotelId),
  });

  const rows = tickets.data?.rows ?? [];
  const refused = rows.filter((t) => t.status === "rejected");
  const onFolio = rows.filter((t) => t.status === "posted");
  const takings = onFolio.reduce((n, t) => n + t.amount + t.tax, 0);

  return (
    <Page>
      <PageHeader
        title="Charges to rooms"
        description="What each restaurant sent to a room, what reached the guest's bill, and what was refused."
        badge={
          tickets.data ? (
            <StatusPill tone={refused.length ? "danger" : "success"}>
              {refused.length
                ? `${refused.length} refused`
                : `${onFolio.length} on guest bills`}
            </StatusPill>
          ) : undefined
        }
      />

      <div className="flex items-start gap-3 rounded-lg border border-grey-200 bg-grey-50 px-4 py-3.5 mb-5">
        <UtensilsCrossed className="size-4 text-grey-400 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-base font-medium text-ink-900">
            This is the outside door
          </p>
          <p className="text-sm text-grey-600 mt-0.5 leading-relaxed">
            An outside point of sale presents a key and posts a finished bill
            here - a retry after a timeout returns the original posting rather
            than charging twice, and a void reverses rather than deleting. The
            PMS has its own till on the{" "}
            <Link to="../till" relative="path" className="font-medium text-brand-orange-700 hover:underline underline-offset-4">
              Till
            </Link>{" "}
            screen, and it comes through this same door.
          </p>
        </div>
      </div>

      {/* Refusals first, because they are the only thing on this page
          that somebody has to act on. A charge that landed is already
          on the guest's folio. */}
      {refused.length > 0 && (
        <Card className="mb-5 border-brand-red-100 bg-brand-red-50">
          <CardBody>
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="size-4 text-brand-red-700 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink-900">
                  {refused.length} bill{refused.length === 1 ? "" : "s"} did not
                  reach a folio
                </p>
                <ul className="mt-1.5 space-y-1">
                  {refused.slice(0, 5).map((t) => (
                    <li key={t.id} className="text-sm text-grey-700">
                      <span className="tabular">{t.ticketRef}</span>
                      <span className="text-grey-500"> · {t.outlet} · </span>
                      <span className="tabular">{money(t.amount + t.tax)}</span>
                      <span className="block text-2xs text-grey-600">
                        {t.reason}
                      </span>
                    </li>
                  ))}
                </ul>
                {refused.length > 5 && (
                  <p className="text-2xs text-grey-500 mt-1.5">
                    …and {refused.length - 5} more in the table below.
                  </p>
                )}
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      <Card className="mb-5">
        <div className="px-4 py-3.5 flex items-center gap-2.5 border-b border-grey-200">
          <IconChip size={24}><KeyRound /></IconChip>
          <h2 className="text-md font-semibold text-ink-900">
            Outlets
          </h2>
        </div>
        <DataTable<PosOutlet>
          rows={outlets.data ?? []}
          columns={OUTLET_COLUMNS}
          rowKey={(o) => o.code}
          loading={outlets.isLoading}
          error={outlets.error}
          onRetry={() => outlets.refetch()}
          empty={
            <div className="text-center py-9">
              <UtensilsCrossed className="size-6 text-grey-300 mx-auto mb-3" />
              <p className="text-md font-semibold text-ink-900">
                No outlet is configured
              </p>
              <p className="text-base text-grey-500 mt-1.5 max-w-md mx-auto">
                An outlet is created from the command line, which prints its API
                key once. Until one exists, nothing can charge a room.
              </p>
            </div>
          }
        />
      </Card>

      <PageHeader
        title="Bills"
        description={
          tickets.data
            ? `${dateLong(tickets.data.from)} to ${dateLong(tickets.data.to)}. Refused bills are kept - they are how a dispute is settled.`
            : "Every bill sent, whatever became of it."
        }
        badge={
          onFolio.length ? (
            <StatusPill tone="neutral">{money(takings)} on folios</StatusPill>
          ) : undefined
        }
      />

      <Card>
        <DataTable<PosTicket>
          rows={rows}
          columns={TICKET_COLUMNS}
          rowKey={(t) => t.id}
          loading={tickets.isLoading}
          error={tickets.error}
          onRetry={() => tickets.refetch()}
          empty={
            <div className="text-center py-10">
              <UtensilsCrossed className="size-6 text-grey-300 mx-auto mb-3" />
              <p className="text-md font-semibold text-ink-900">
                No bill has been sent
              </p>
              <p className="text-base text-grey-500 mt-1.5">
                Sattva still posts inside eZee. This fills when it posts here.
              </p>
            </div>
          }
        />
      </Card>
    </Page>
  );
}
