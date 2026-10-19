import type { ReactNode } from "react";
import { useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { Button, DocLabel, DocMasthead, DocPage, DocFooter } from "@/components/ui";
import { TestDocumentMark } from "@/components/app/TestHotel";
import { useGroupSettings } from "@/modules/admin";
import { placeLine } from "@/modules/finance";
import { useDocumentTitle } from "@/lib/documentTitle";
import { useIsTestHotel } from "@/lib/testHotel";
import { dateTime, moneyPrecise } from "@/lib/format";
import { getRegistrationCard, type RegistrationCard } from "../data/stays";
import { ID_WORDS } from "../flows/CheckInFlow";

/* ══════════════════════════════════════════════════════════════════
   THE GUEST REGISTRATION CARD (the owner's D27-344, D27-345, 19 October)

   The old system's card, box for box, in Fidato's document style: the
   hotel, the guest, the stay, who bills and who booked, the ID, where the
   guest came from and goes next, a remark to write in, the hotel's house
   policies over the guest's signature, and the box to initial for no offers.
   Printed from "Print registration card" on the stay, never by itself.
   Its number (G.R. card no) is given at check-in; a stay checked in before
   the cards were numbered prints a dash. Aadhaar is its last four only.
   ══════════════════════════════════════════════════════════════════ */

const region = (code: string | null) => {
  if (!code) return null;
  try { return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code; } catch { return code; }
};

/** One labelled box, as the old card: a label over its value. */
function Box({ label, children, className = "" }: { label: string; children?: ReactNode; className?: string }) {
  return (
    <div className={`px-3 py-2 min-w-0 ${className}`}>
      <DocLabel>{label}</DocLabel>
      <div className="mt-0.5 text-sm font-semibold break-words">{children ?? "-"}</div>
    </div>
  );
}

/** A row of boxes on hairlines, the card's grid. */
const Row = ({ children }: { children: ReactNode }) => (
  <div className="grid grid-cols-2 divide-x divide-grey-200 border-b border-grey-200">{children}</div>
);

export function RegistrationCardSheet({ card, test, hotelCode, label }: {
  card: RegistrationCard; test: boolean; hotelCode: string;
  /** Settings › Documents' sample: SAMPLE · NOT VALID (D27-348). */
  label?: string;
}) {
  const { hotel, stay, guest } = card;
  const group = useGroupSettings(hotelCode);
  /* The town once (FI-16), as the invoice prints it. */
  const place = placeLine(hotel.address, hotel.city, hotel.state);
  const office = group.office;
  const a = guest.address;
  const home = [a.line, a.city, [a.state, a.pincode].filter(Boolean).join(" "), region(a.country)].filter(Boolean).join(", ");
  return (
    <div className="text-ink-700" data-registration-card>
      {test && <TestDocumentMark {...(label ? { label } : {})} />}
      <DocMasthead logos={[group.hotelLogo, group.groupLogo]} name={hotel.name} group={group.name}
        title="Registration Card" number={`G.R. card no ${card.grCardNo ?? "-"}`}>
        <p>Booking {stay.reference}</p>
      </DocMasthead>

      <div className="text-xs leading-[1.5] text-grey-500 -mt-1 mb-3">
        {place && <p>{place}</p>}
        {(hotel.phone || hotel.email || hotel.website) && (
          <p>{[hotel.phone && `Phone ${hotel.phone}`, hotel.email && `E-mail ${hotel.email}`, hotel.website].filter(Boolean).join(" · ")}</p>
        )}
        {!test && <p className="text-ink-700">GSTIN <span className="font-semibold tabular">{hotel.gstin ?? "-"}</span></p>}
      </div>

      <div className="border-t-2 border-ink-700">
        <Row>
          <Box label="Name">{[guest.title, guest.name].filter(Boolean).join(" ")}</Box>
          <div className="grid grid-cols-2 divide-x divide-grey-200">
            <Box label="G.R. card no">{card.grCardNo ?? "-"}</Box>
            <Box label="Booking no">{stay.reference}</Box>
          </div>
        </Row>
        <Row>
          <div>
            <Box label="Address">{home || null}</Box>
            <Box label="E-mail">{guest.email}</Box>
            <Box label="Phone">{guest.phone}</Box>
          </div>
          <div>
            <div className="grid grid-cols-2 divide-x divide-grey-200">
              <Box label="Arrival">{stay.arrival}</Box>
              <Box label="Room">{stay.roomType} / {stay.room ?? "-"}</Box>
            </div>
            <div className="grid grid-cols-2 divide-x divide-grey-200">
              <Box label="Departure">{stay.departure}</Box>
              <Box label="Persons">
                {stay.adults} adult{stay.adults === 1 ? "" : "s"} · {stay.children} {stay.children === 1 ? "child" : "children"}
              </Box>
            </div>
            <Box label="Tariff">
              {card.rate === null ? "-" : `${moneyPrecise(Number(card.rate))} a night, before GST`}
              {stay.plan && ` (${stay.plan})`}
            </Box>
          </div>
        </Row>
        <Row>
          <div>
            <Box label="Billing company">{card.company?.name}</Box>
            <Box label="E-mail">{card.company?.email}</Box>
            <Box label="Phone">{card.company?.phone}</Box>
          </div>
          <div>
            <div className="grid grid-cols-2 divide-x divide-grey-200">
              <Box label="Travel agent">{card.agent?.name}</Box>
              <Box label="Voucher no">{card.agent?.voucher}</Box>
            </div>
            <Box label="E-mail">{card.agent?.email}</Box>
            <Box label="Phone">{card.agent?.phone}</Box>
          </div>
        </Row>
        <Row>
          <Box label="Identity">
            {guest.idType ? `${ID_WORDS[guest.idType] ?? guest.idType}${guest.idNumber ? ` · ${guest.idNumber}` : ""}` : "-"}
          </Box>
          <Box label="Nationality">{region(guest.nationality)}</Box>
        </Row>
        <Row>
          <Box label="Arriving from">{card.arrivedFrom}</Box>
          <Box label="Next destination">{card.nextDestination}</Box>
        </Row>
        {/* Blank, to write in (D27-345): a booking's notes can be internal. */}
        <div className="border-b border-grey-200 px-3 py-2 h-20" data-registration-remark>
          <DocLabel>Remark</DocLabel>
        </div>
      </div>

      {card.housePolicies.length > 0 && (
        <section className="mt-4 break-inside-avoid" data-registration-policies>
          <DocLabel>House policies</DocLabel>
          <ul className="mt-1 list-disc pl-5 text-xs leading-[1.5] text-ink-700">
            {card.housePolicies.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </section>
      )}

      <div className="break-inside-avoid">
        <div className="mt-6 flex items-end gap-4">
          <p className="text-sm font-semibold">Guest signature</p>
          <div className="h-12 w-64 border border-ink-700" />
        </div>
        <div className="mt-4 flex items-center justify-between gap-6 border border-grey-200 rounded-md px-3 py-2.5">
          <p className="text-xs">
            {hotel.name} regularly has special offers and promotions. If you would prefer not to receive
            this information, please initial in this box.
          </p>
          <div className="size-9 shrink-0 border border-ink-700" />
        </div>

        <DocFooter
          name={group.name ?? hotel.name}
          left={office?.address ?? place}
          right={<>Printed on {dateTime(new Date())}</>}
        />
      </div>
    </div>
  );
}

export default function RegistrationCardPage() {
  const { code = "", id = "" } = useParams();
  const card = useQuery({ queryKey: ["registration-card", code, id], queryFn: () => getRegistrationCard(code, id) });
  const test = useIsTestHotel();
  useDocumentTitle("Registration card");

  return (
    <DocPage
      toolbar={
        <Button variant="primary" onClick={() => window.print()} disabled={!card.data} data-registration-print>
          <Printer className="size-4" />
          Print
        </Button>
      }
    >
      {card.data ? (
        <RegistrationCardSheet card={card.data} test={test} hotelCode={code} />
      ) : card.isError ? (
        <p className="text-sm text-brand-red-700">The registration card could not be read. Try again.</p>
      ) : (
        <p className="text-sm text-grey-600">One moment…</p>
      )}
    </DocPage>
  );
}
