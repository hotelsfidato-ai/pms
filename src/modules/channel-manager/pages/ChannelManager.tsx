import { ArrowRightLeft, CalendarClock, IndianRupee } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { Page, PageHeader, Card, CardBody, IconChip } from "@/components/ui";
import { listBookingSources } from "@/modules/guests";
import { useRole } from "@/lib/session";
import { setsUpSu } from "../data/suRoles";
import { suChannelName } from "../data/suChannels";
import { SuSetup, ChannelBookings } from "../components/SuSetup";

/* ══════════════════════════════════════════════════════════════════
   THE CHANNEL MANAGER — the wire to the booking sites, through SU

   Built (D17-66, D27-178); it sends and takes nothing until the owner has
   put SU's keys in the server's settings and the hotel is switched on.

   The owner and an administrator see the SU setup (D17-85). Everybody who
   reaches the page - the GM too (D27-183, Q6) - sees the bookings the sites
   sent and what became of each, because the GM settles a refused one with
   the site and the guest (D17-80).

   NOTHING HERE IS INVENTED. The booking sites listed are the booking
   sources the group has recorded, each with the SU code a person picked
   for it on Booking sources, or a dash.
   ══════════════════════════════════════════════════════════════════ */

const WHAT_IT_DOES = [
  {
    icon: CalendarClock,
    title: "Rooms left, sent out",
    body: "Sell a room here and SU tells the booking sites, so the same "
        + "room is not sold twice.",
  },
  {
    icon: IndianRupee,
    title: "Prices and closures, sent out",
    body: "The prices and closures on Rates go to SU as they change. "
        + "A date with no price goes to SU closed.",
  },
  {
    icon: ArrowRightLeft,
    title: "Bookings, taken in",
    body: "A booking site's booking arrives as a booking, and its "
        + "cancellation cancels it. Anything it cannot read waits for a "
        + "person, with the reason.",
  },
];

const NEEDS = [
  "SU's test account, its keys in the server's settings (never in a screen "
    + "or a chat), and this server's booking address registered with SU.",
  "SU's certification: SU's test cases, then a live session with SU, before "
    + "the live account is opened.",
  "Room types and meal plans matched to SU's ids. A wrong match oversells "
    + "the wrong room type.",
  "Each booking site's SU code, picked on Booking sources. A booking from a "
    + "site with no code waits for a person.",
  "This hotel switched on in Settings, with the account the connection works as.",
  "One rate everywhere, or a rate per channel. Still to be decided, and it "
    + "shapes Rates.",
];

export default function ChannelManagerPage() {
  const { code } = useParams<{ code: string }>();
  const maySetUp = setsUpSu(useRole());

  const sources = useQuery({
    queryKey: ["booking-sources", code],
    queryFn: () => listBookingSources(code ?? ""),
    enabled: !!code,
  });
  const sites = (sources.data ?? []).filter((s) => s.kind === "ota" && s.isActive);

  return (
    <Page>
      <PageHeader
        title="Channel manager"
        description={
          "The connection between this system and the booking sites, through SU. "
          + "Nothing is sent or taken until SU is set up and this hotel is switched on."
        }
      />

      <div className="flex flex-col gap-5">
        {maySetUp && code && <SuSetup code={code} />}
        {code && <ChannelBookings code={code} />}

        <Card>
          <CardBody>
            <ul className="grid gap-x-6 gap-y-3 md:grid-cols-3">
              {WHAT_IT_DOES.map((x) => (
                <li key={x.title}>
                  <p className="flex items-center gap-2.5 text-sm font-medium text-ink-900">
                    <IconChip size={24}><x.icon /></IconChip>
                    {x.title}
                  </p>
                  <p className="text-sm text-grey-600 mt-2 leading-relaxed">{x.body}</p>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="space-y-3">
            <h2 className="text-md font-semibold text-ink-900">
              What it still needs before it goes live
            </h2>
            <ol className="space-y-2 text-base text-ink-900">
              {NEEDS.map((n, i) => (
                <li key={n} className="flex gap-2">
                  <span className="w-3 shrink-0 text-grey-500 tabular">{i + 1}</span>
                  <span>{n}</span>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>

        {sources.data && (
          <Card>
            <CardBody className="space-y-3">
              <h2 className="text-md font-semibold text-ink-900">Booking sites and their SU codes</h2>
              {sites.length === 0 ? (
                <p className="text-base text-grey-500">No booking site is recorded yet.</p>
              ) : (
                <ul className="divide-y divide-grey-100">
                  {sites.map((s) => (
                    <li key={s.id} className="py-2 flex flex-wrap gap-x-3 text-sm">
                      <span className="font-medium text-ink-900">{s.name}</span>
                      <span className="text-grey-600">
                        {!s.channelCode
                          ? "No SU code: its bookings wait for a person"
                          : suChannelName(s.channelCode)
                            ? `SU code ${s.channelCode} (${suChannelName(s.channelCode)})`
                            : `${s.channelCode}, not one of SU's codes: its bookings wait for a person`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-sm text-grey-500">
                Codes are picked on <Link to={`/h/${code}/booking-sources`} className="underline">Booking sources</Link>.
              </p>
            </CardBody>
          </Card>
        )}
      </div>
    </Page>
  );
}
