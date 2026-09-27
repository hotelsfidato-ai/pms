import { useState } from "react";
import { useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { dateShort, dateTime } from "@/lib/format";
import { useDocumentIdentity } from "@/lib/documentIdentity";
import {
  Button, Card, CardBody, Dialog, DialogContent, EmptyState, ErrorState, InfoButton, Page, PageHeader,
  Skeleton,
} from "@/components/ui";
import {
  confirmDetails, getDesk, handleRequest, printEveryCard, printRoomCard, setAsideDetails,
  type PrintedCard, type WaitingDetails,
} from "@/modules/online-checkin/data/desk";

/* ══════════════════════════════════════════════════════════════════
   ONLINE CHECK-IN — THE DESK'S SIDE (/h/:code/online-checkin)

   Three things a guest's own page leaves for a person:

   · DETAILS WAITING TO BE CHECKED (D21-8). What a guest typed reaches
     guest_documents - and so Form C - only when a clerk has compared it
     with the ID and pressed Confirm. That is the whole point of the
     button: the desk stops typing; nobody stops looking.
   · REQUESTS (D21-9). A spa treatment or a laundry bag the guest asked
     for. Booked through the spa's and laundry's own screens, then marked
     done here. This screen books nothing.
   · ROOM CARDS (D21-7, D21-16, D21-62). One fixed card per room. A card
     is shown once, when it is made, to be printed - only its hash is
     kept - so printing is always making, and a new card stops the old
     one at once.
   ══════════════════════════════════════════════════════════════════ */

const ID_LABEL: Record<string, string> = {
  aadhaar: "Aadhaar", passport: "Passport", driving_licence: "Driving licence",
  voter: "Voter ID", other: "Other ID",
};
const KIND_LABEL: Record<string, string> = { spa: "Spa", laundry: "Laundry" };

export default function DeskPage() {
  const code = useParams().code ?? "";
  const qc = useQueryClient();
  const desk = useQuery({ queryKey: ["online-checkin-desk", code], queryFn: () => getDesk(code) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["online-checkin-desk", code] });
  const [printed, setPrinted] = useState<PrintedCard[] | null>(null);

  if (printed) return <CardSheet cards={printed} onDone={() => { setPrinted(null); void refresh(); }} />;

  return (
    <Page className="max-w-4xl">
      <PageHeader
        title="Online check-in"
        description="What guests sent from their own page, waiting for the desk."
      />
      {desk.isLoading ? (
        <Skeleton className="h-64" />
      ) : desk.error ? (
        <Card><ErrorState error={desk.error} onRetry={() => void desk.refetch()} /></Card>
      ) : (
        /* Sections 20px apart (the Rhythm Rule). */
        <div className="flex flex-col gap-5">
          <Waiting code={code} rows={desk.data!.waiting} onChanged={refresh} />
          <Requests code={code} rows={desk.data!.requests} onChanged={refresh} />
          <RoomCards code={code} rooms={desk.data!.rooms} onPrinted={setPrinted} />
        </div>
      )}
    </Page>
  );
}

function Waiting(
  { code, rows, onChanged }: { code: string; rows: WaitingDetails[]; onChanged: () => void },
) {
  const confirm = useMutation({ mutationFn: (id: string) => confirmDetails(code, id), onSuccess: onChanged });
  const aside = useMutation({ mutationFn: (id: string) => setAsideDetails(code, id), onSuccess: onChanged });
  const busy = confirm.isPending || aside.isPending;

  return (
    <section>
      <h2 className="text-md font-semibold text-ink-900 mb-3">Details waiting to be checked</h2>
      {rows.length === 0 ? (
        <Card>
          <EmptyState compact title="Nothing waiting"
            description="When a guest sends their ID and address from their own page, it waits here until somebody checks it against the ID." />
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((d) => (
            <li key={d.id}>
              <Card><CardBody>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-base font-medium text-ink-900">{d.guest}</p>
                  <p className="text-sm text-grey-600 tabular">{d.reference} · sent {dateTime(d.submittedAt)}</p>
                </div>
                {/* What they typed, under a hairline: label, then value. */}
                <dl className="mt-3 border-t border-grey-100 pt-2.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
                  <dt className="text-grey-500">{ID_LABEL[d.idType] ?? d.idType}</dt>
                  <dd className="font-medium text-ink-900 tabular">{d.idNumber}</dd>
                  {d.passportExpiry && <><dt className="text-grey-500">Passport expires</dt>
                    <dd className="font-medium text-ink-900 tabular">{dateShort(d.passportExpiry)}</dd></>}
                  {d.visaNumber && <><dt className="text-grey-500">Visa</dt>
                    <dd className="font-medium text-ink-900 tabular">{d.visaNumber}{d.visaExpiry ? `, expires ${dateShort(d.visaExpiry)}` : ""}</dd></>}
                  {(d.addressLine || d.city || d.country) && <><dt className="text-grey-500">Address</dt>
                    <dd className="font-medium text-ink-900 break-words">{[d.addressLine, d.city, d.country].filter(Boolean).join(", ")}</dd></>}
                </dl>
                <div className="mt-3.5 flex flex-wrap gap-2">
                  <Button variant="secondary" disabled={busy} onClick={() => confirm.mutate(d.id)}>
                    Confirm against the ID
                  </Button>
                  <Button variant="ghost" disabled={busy} onClick={() => aside.mutate(d.id)}>
                    Not right - take them at the desk
                  </Button>
                </div>
              </CardBody></Card>
            </li>
          ))}
        </ul>
      )}
      {(confirm.error || aside.error) && (
        <p className="text-sm text-brand-red-700 mt-3">{((confirm.error ?? aside.error) as Error).message}</p>
      )}
    </section>
  );
}

function Requests(
  { code, rows, onChanged }: {
    code: string; rows: { id: string; kind: string; what: string; wanted: string | null;
      guest: string; reference: string; createdAt: string }[];
    onChanged: () => void;
  },
) {
  const handle = useMutation({
    mutationFn: (v: { id: string; status: "done" | "declined" }) => handleRequest(code, v.id, v.status),
    onSuccess: onChanged,
  });

  return (
    <section>
      {/* The section's note behind an (i), the same words (the owner, D27-82). */}
      <div className="flex items-center gap-1 mb-3">
        <h2 className="text-md font-semibold text-ink-900">Requests</h2>
        <InfoButton>{"Book them on the spa's or the laundry's own screen, then mark them done here."}</InfoButton>
      </div>
      {rows.length === 0 ? (
        <Card>
          <EmptyState compact title="No requests"
            description="A guest can ask for the spa or laundry from their own page, where this property has them switched on." />
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((q) => (
            <li key={q.id}>
              <Card><CardBody>
                <p className="text-base text-ink-900">
                  <span className="font-medium">{KIND_LABEL[q.kind] ?? q.kind}:</span> {q.what}
                </p>
                <p className="text-sm text-grey-600 mt-0.5">
                  {q.guest} · {q.reference}{q.wanted ? ` · wanted ${q.wanted}` : ""} · asked {dateTime(q.createdAt)}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="secondary" disabled={handle.isPending}
                    onClick={() => handle.mutate({ id: q.id, status: "done" })}>
                    Done
                  </Button>
                  <Button variant="ghost" disabled={handle.isPending}
                    onClick={() => handle.mutate({ id: q.id, status: "declined" })}>
                    Declined
                  </Button>
                </div>
              </CardBody></Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RoomCards(
  { code, rooms, onPrinted }: {
    code: string; rooms: { id: string; number: string; cardSince: string | null }[];
    onPrinted: (cards: PrintedCard[]) => void;
  },
) {
  const [askEvery, setAskEvery] = useState(false);
  const one = useMutation({ mutationFn: (roomId: string) => printRoomCard(code, roomId), onSuccess: (r) => onPrinted(r.cards) });
  const every = useMutation({ mutationFn: () => printEveryCard(code), onSuccess: (r) => onPrinted(r.cards) });

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 mb-3">
        {/* The section's note behind an (i), the same words (the owner, D27-82). */}
        <div className="flex items-center gap-1 min-w-0">
          <h2 className="text-md font-semibold text-ink-900">Room cards</h2>
          <InfoButton>{"One card per room. A guest scans it and a code goes to the phone on their booking. Printing a new card stops the old one at once."}</InfoButton>
        </div>
        <Button variant="secondary" onClick={() => setAskEvery(true)}>Print cards for every room</Button>
      </div>
      <Card>
        {/* List rows: 12px, a hairline between, at least 56px. */}
        <ul className="divide-y divide-grey-100">
          {rooms.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3 min-h-14">
              <div className="min-w-0">
                <p className="text-base font-medium text-ink-900 tabular">Room {r.number}</p>
                <p className="text-sm text-grey-600">
                  {r.cardSince ? `Card printed ${dateShort(r.cardSince)}` : "No card yet"}
                </p>
              </div>
              <Button variant="ghost" disabled={one.isPending} onClick={() => one.mutate(r.id)}>
                {r.cardSince ? "Print a new card" : "Print a card"}
              </Button>
            </li>
          ))}
        </ul>
      </Card>

      <Dialog open={askEvery} onOpenChange={setAskEvery}>
        <DialogContent
          title="Print cards for every room?"
          footer={
            <>
              <Button variant="secondary" onClick={() => setAskEvery(false)}>Cancel</Button>
              <Button variant="danger" disabled={every.isPending}
                onClick={() => { setAskEvery(false); every.mutate(); }}>
                Print new cards
              </Button>
            </>
          }
        >
          <p className="text-base text-grey-600">
            Every card already in a room stops working the moment this is pressed.
            Put the new ones out straight away.
          </p>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/* ── The printable sheet (D21-62) ───────────────────────────────────
   The hotel's cards, one per room, to print however the owner chooses.
   The owner, 25 September: four to an A4 page (about 9 x 13 cm each),
   the hotel, the room and the QR - no link as text.

   ⚠ `qrcode` IS IMPORTED HERE AND NOWHERE ELSE, AND ONLY DYNAMICALLY
   (D21-95: desk screen only). The whole app is one bundle, and the
   guest's page is in it; a static import would ship the library to
   every guest's phone. The build puts it in its own chunk, fetched when
   a sheet is drawn.

   Print waits for the codes: the old cards are already dead, so a sheet
   printed before its QR codes were drawn would be a room with no card. */
function CardSheet({ cards, onDone }: { cards: PrintedCard[]; onDone: () => void }) {
  const { property } = useDocumentIdentity();
  const qr = useQuery({
    /* The links are the cards' only copy. The query cache is memory; it
       is persisted only for the keys App.tsx lists, and this is not one. */
    queryKey: ["room-card-qr", cards.map((c) => c.link)],
    queryFn: async () => {
      const { toString } = await import("qrcode");
      return Promise.all(cards.map((c) => toString(c.link, { type: "svg", margin: 0 })));
    },
    staleTime: Infinity,
    gcTime: 0,
  });

  return (
    /* On paper: no screen padding, or the first page loses a row. */
    <Page className="max-w-4xl print:p-0 print:bg-white">
      <div className="print:hidden">
        <PageHeader
          title="Online check-in"
          description="These cards are shown once. Print them now - they cannot be shown again, only replaced."
        />
        <div className="flex gap-2 mb-5">
          <Button variant="primary" disabled={!qr.data} onClick={() => window.print()}>Print</Button>
          <Button variant="secondary" onClick={onDone}>Done</Button>
        </div>
        {qr.error && (
          <p className="text-sm text-brand-red-700 mb-5">
            The QR codes could not be drawn. {(qr.error as Error).message}{" "}
            <Button variant="ghost" onClick={() => void qr.refetch()}>Try again</Button>
          </p>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 print:grid-cols-2 print:gap-0">
        {cards.map((c, i) => (
          <div key={c.room} data-room-card
            className="flex flex-col items-center justify-center gap-3 rounded-lg border border-grey-200 bg-white p-5 text-center break-inside-avoid print:h-[130mm] print:rounded-none print:border-grey-300">
            <p className="text-sm text-grey-600">{property ?? "-"}</p>
            <p className="text-2xl font-semibold text-ink-900">Room {c.room}</p>
            {qr.data ? (
              <img alt={`QR code for room ${c.room}`} className="w-[60mm] h-[60mm]"
                src={`data:image/svg+xml;utf8,${encodeURIComponent(qr.data[i]!)}`} />
            ) : (
              <Skeleton className="w-[60mm] h-[60mm]" />
            )}
            {/* Nothing more promised: requests appear only where the hotel
                has the spa or laundry switched on (D21-63). */}
            <p className="text-sm text-grey-600">Scan to check in.</p>
          </div>
        ))}
      </div>
    </Page>
  );
}
