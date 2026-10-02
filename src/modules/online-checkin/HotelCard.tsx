import { useQuery } from "@tanstack/react-query";
import { Button, Card, CardBody, Skeleton } from "@/components/ui";

/* ══════════════════════════════════════════════════════════════════
   THE HOTEL'S CARD (D27-235 2.4; the owner's answer to Q1.1, 2 October)

   One card per hotel, beside the room cards on the Online check-in desk
   screen (the master adds the one line in pages/Desk.tsx at merge:
   <HotelCard code={code} hotel={property} />). Its QR opens /g/h/<code>,
   where a guest staying now types their room and phone. Unlike a room card
   it is no secret: it names the hotel and nothing else, so it can be shown
   again and printed as often as wanted.

   `qrcode` only by import(), on this desk screen, as the room cards do
   (D21-95): never in the guest's bundle.
   ══════════════════════════════════════════════════════════════════ */
export function HotelCard({ code, hotel }: { code: string; hotel: string | null }) {
  const link = `${window.location.origin}/g/h/${code.toLowerCase()}`;
  const qr = useQuery({
    queryKey: ["hotel-card-qr", link],
    queryFn: async () => (await import("qrcode")).toString(link, { type: "svg", margin: 0 }),
    staleTime: Infinity,
  });

  return (
    <Card data-hotel-card>
      <CardBody className="flex flex-col items-center gap-3 text-center">
        <p className="text-sm text-grey-600">{hotel ?? "-"}</p>
        <p className="text-base font-semibold text-ink-900">Your stay, by room and phone</p>
        {qr.data ? (
          <img alt="QR code for the hotel's stay page" className="w-[60mm] h-[60mm]"
               src={`data:image/svg+xml;utf8,${encodeURIComponent(qr.data)}`} />
        ) : qr.error ? (
          <p className="text-sm text-brand-red-700">The QR code could not be drawn. {(qr.error as Error).message}</p>
        ) : (
          <Skeleton className="w-[60mm] h-[60mm]" />
        )}
        <p className="text-sm text-grey-600">Scan, then type your room number and phone number.</p>
        <Button variant="secondary" className="print:hidden" disabled={!qr.data} onClick={() => window.print()}>
          Print the hotel's card
        </Button>
      </CardBody>
    </Card>
  );
}
