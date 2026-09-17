import { Globe, ArrowRightLeft, CalendarClock, IndianRupee, Info } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import {
  Page, PageHeader, Card, CardBody, StatusPill,
} from "@/components/ui";
import { listCompanies } from "@/modules/guests";
import { can } from "@/lib/permissions";
import { useRole } from "@/lib/session";
import { SuSetup } from "../components/SuSetup";

/* ══════════════════════════════════════════════════════════════════
   THE CHANNEL MANAGER — named, not hidden

   This is the largest real gap in the product, and until now the
   navigation said nothing about it at all. Somebody looking for their
   OTA connection found no entry and had to conclude either that it was
   somewhere they had not looked, or that the system could not do it.
   Both are worse than a screen that says "not yet, and here is what it
   will do".

   Rule 6 applies to features as well as buttons: a thing that cannot
   be done is SHOWN with its reason. The reason here is that it is not
   built, and the honest form of that is a page that describes the work
   rather than a disabled menu item with no explanation.

   NOTHING HERE IS INVENTED. The OTAs listed are the booking sources
   the property has actually recorded. If none have been recorded, it
   says so rather than showing a plausible-looking list of logos.
   ══════════════════════════════════════════════════════════════════ */

const WHAT_IT_WILL_DO = [
  {
    icon: CalendarClock,
    title: "Availability, pushed out",
    body: "Sell a room here and the OTAs stop offering it. "
        + "Today that is somebody remembering to log in and close it, and "
        + "the day they forget is the day a room is sold twice.",
  },
  {
    icon: IndianRupee,
    title: "Rates, pushed out",
    body: "The rate calendar already exists and already knows what a room "
        + "costs on a given night. This is the wire that carries it to "
        + "Booking.com and go-MMT instead of a person retyping it.",
  },
  {
    icon: ArrowRightLeft,
    title: "Bookings, pulled in",
    body: "An OTA reservation arrives as a booking with its guest, its "
        + "nights and its rate, not as an email somebody copies out by "
        + "hand at the desk.",
  },
];

export default function ChannelManagerPage() {
  const { code } = useParams<{ code: string }>();
  /* The SU setup is the `integration` grant's, which only the owner holds;
     the server refuses everybody else the same way. An administrator or a
     GM still sees what the connection is and what it needs. */
  const setsUpSu = can(useRole(), "edit", "integration");

  /* The booking sources the property has actually recorded. Real rows
     or none — a mocked list of OTA logos would make this page look
     like a working integration, which is the one thing it must not
     look like. */
  const sources = useQuery({
    queryKey: ["booking-sources", code],
    queryFn: () => listCompanies(code ?? ""),
    enabled: !!code,
  });

  /* Only the OTAs. A corporate account and a direct booking are also
     "companies" here, and neither is something a channel manager
     connects to — listing them would overstate what this will reach. */
  const otas = (sources.data ?? []).filter((c) => c.kind === "OTA");

  return (
    <Page>
      <PageHeader
        title="Channel manager"
        badge={<StatusPill tone="neutral">Coming soon</StatusPill>}
        description={
          "The connection between this system and the OTAs, through SU. It "
          + "is being built, and nothing is sent to any booking site yet."
        }
      />

      {setsUpSu && code && <SuSetup code={code} />}

      <Card>
        <CardBody className="space-y-4">
          <div className="flex items-start gap-2.5">
            <Globe className="size-5 text-grey-400 shrink-0 mt-0.5" />
            <p className="text-base text-ink-900 leading-relaxed max-w-prose">
              Until this exists, every OTA booking is typed in by hand and
              every OTA closure is remembered by a person. That is the
              largest single gap between this system and a finished one,
              and it is named here rather than left out so nobody has to
              wonder whether they simply have not found the screen.
            </p>
          </div>

          <ul className="grid gap-2.5 @2xl:grid-cols-3">
            {WHAT_IT_WILL_DO.map((x) => (
              <li key={x.title}
                  className="rounded-md border border-grey-200 bg-white p-3">
                <x.icon className="size-4 text-brand-orange mb-1.5" />
                <p className="text-base font-medium text-ink-900">{x.title}</p>
                <p className="text-sm text-grey-600 mt-1 leading-relaxed">
                  {x.body}
                </p>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-2.5">
          <h2 className="text-md font-semibold text-ink-900">
            What it still needs before it goes live
          </h2>
          <ul className="space-y-1.5 text-base text-ink-900">
            <li className="flex gap-2">
              <span className="text-grey-500 tabular">1</span>
              <span>
                SU's test account.
                <span className="text-grey-500">
                  {" "}Its keys belong in the server's settings, never in a
                  screen or a chat.
                </span>
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-grey-500 tabular">2</span>
              <span>
                SU's certification: SU's test cases, then a live session with
                SU, before the live account is opened.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-grey-500 tabular">3</span>
              <span>
                A mapping of room types and meal plans. What an OTA calls your
                Superior is rarely what you call it, and a wrong mapping
                oversells the wrong room type.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-grey-500 tabular">4</span>
              <span>
                Each hotel switched on by itself. None is connected until
                somebody switches it on.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-grey-500 tabular">5</span>
              <span>
                One rate everywhere, or a rate per channel. Still to be
                decided, and it shapes the rate calendar.
              </span>
            </li>
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <h2 className="text-md font-semibold text-ink-900 mb-1">
            What is already recorded
          </h2>
          {otas.length === 0 ? (
            /* A plain sentence, not an invented list. */
            <p className="text-base text-grey-500">
              No booking sources have been recorded at {code ?? "this property"} yet.
            </p>
          ) : (
            <>
              <p className="text-sm text-grey-500 mb-2">
                Bookings can already be attributed to these by hand, and the
                Companies and agents screen reports on them. The channel manager
                is what stops the typing, not what makes the reporting
                possible.
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {otas.map((c) => (
                  <li key={c.id}
                      className="rounded-md border border-grey-200 bg-grey-50
                                 px-2.5 py-1 text-sm text-ink-900">
                    {c.name}
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardBody>
      </Card>

      <p className="flex items-start gap-2 text-sm text-grey-500 leading-relaxed">
        <Info className="size-3.5 shrink-0 mt-0.5" />
        <span>
          The rate calendar, availability and booking sources this would
          connect to are all built and working. What is missing is the wire
          between them and the OTAs.
        </span>
      </p>
    </Page>
  );
}
