import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { Check, AlertCircle, Circle, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { Card, CardBody, StatusPill } from "@/components/ui";
import { getCommissioning, type CommissioningCheck } from "@/modules/admin/data/commissioning";

/* ══════════════════════════════════════════════════════════════════
   WHAT THIS PROPERTY STILL NEEDS

   Adding a hotel gives you a row and nothing else — no room types, no
   rooms, no tariffs, no GST rule — and that is correct, because every
   property's are different and inventing them would put wrong numbers
   in front of people.

   What was missing is the THREAD. After creating a property nothing
   said what to do next, and the answer was spread across six screens
   and a document the owner had to keep beside them. This is that
   document, inside the software, deriving itself.

   NOTHING HERE IS TICKED BY HAND. There is no "setup complete" flag,
   because a flag goes stale the moment somebody deletes the last room
   type. Every line asks the database the same question the feature it
   guards asks.

   AND IT IS NOT A PERCENTAGE. "80% ready" invites somebody to open for
   business on the strength of a number that says nothing about which
   fifth is missing — and the missing fifth is usually the tax number
   that prints on every bill. It is a yes or a no, with the reasons.
   ══════════════════════════════════════════════════════════════════ */

export function CommissioningCard({ hotelId }: { hotelId: string }) {
  const q = useQuery({
    queryKey: ["commissioning", hotelId],
    queryFn: () => getCommissioning(hotelId),
    enabled: !!hotelId,
  });

  const data = q.data;
  if (!data) return null;

  /* Once everything is settled this is noise on a screen somebody uses
     every day. It comes back on its own the moment a check stops being
     true, which is the point of deriving it. */
  if (data.canTakeABooking && data.done === data.total) return null;

  const outstanding = data.checks.filter((c) => !c.done);
  const blocking = outstanding.filter((c) => c.blocking);

  return (
    /* The warning wash on the brand's yellow steps (it was stock amber). */
    <Card className={cn(
      blocking.length > 0 ? "border-brand-yellow-100 bg-brand-yellow-50" : "",
    )}>
      <CardBody className="space-y-3">
        <div className="flex items-baseline gap-2 flex-wrap">
          <h2 className="text-md font-semibold text-ink-900">
            Before {data.property} can take a guest
          </h2>
          <StatusPill tone={data.canTakeABooking ? "success" : "warning"}>
            {data.done} of {data.total} settled
          </StatusPill>
        </div>

        <p className="text-sm text-grey-600 leading-relaxed max-w-prose">
          {blocking.length === 0
            ? "Everything that stops a booking is settled. The rest is worth "
              + "doing and does not block anything."
            : `${blocking.length === 1 ? "One thing" : `${blocking.length} things`} `
              + "must be settled first - until then a booking, a bill or the "
              + "night audit will refuse and say so."}
        </p>

        {/* List rows under a hairline, not boxes inside the card. */}
        <ul className={cn("-mx-4 border-y divide-y",
          blocking.length > 0 ? "border-brand-yellow-100 divide-brand-yellow-100" : "border-grey-100 divide-grey-100")}>
          {outstanding.map((c) => (
            <Row key={c.id} check={c} hotelId={hotelId} />
          ))}
        </ul>
        {/* Only what is missing (the owner's D27-220): what is done is not listed. */}
      </CardBody>
    </Card>
  );
}

function Row({ check, hotelId }: {
  check: CommissioningCheck; hotelId: string;
}) {
  const Icon = check.blocking ? AlertCircle : Circle;

  const body = (
    <>
      <Icon className={cn("size-4 shrink-0 mt-0.5",
        check.blocking ? "text-brand-yellow-800" : "text-grey-500")} />
      <div className="min-w-0 flex-1">
        <p className="text-base text-ink-900">
          {check.label}
          {!check.blocking && (
            <span className="text-grey-500 text-sm"> · not blocking</span>
          )}
        </p>
        {/* The reason, always. A checklist that says "GSTIN" and nothing
            else does not tell somebody why it matters, and this one is
            the difference between a valid invoice and a fake tax number
            on a guest's bill. */}
        {check.detail && (
          <p className="text-sm text-grey-600 mt-0.5 leading-relaxed">
            {check.detail}
          </p>
        )}
      </div>
      {/* It opens the screen that settles it: an arrow says so. */}
      {check.to && (
        <ChevronRight className="size-4 text-grey-400 shrink-0 mt-0.5" aria-hidden />
      )}
    </>
  );

  const shell = "flex items-start gap-2.5 px-4 py-3";

  return (
    <li>
      {check.to ? (
        <Link to={check.to.startsWith("/settings") ? check.to : `/h/${hotelId}${check.to}`}
              className={cn(shell, "hover:bg-white/60 transition-colors duration-150 cursor-pointer",
                "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-orange")}>
          {body}
        </Link>
      ) : (
        <div className={shell}>{body}</div>
      )}
    </li>
  );
}

/** The green half, for a property that is finished. Shown on the
    properties list rather than here — a hotel that is ready should say
    so once, somewhere it is being compared with the others, not on the
    screen its own manager opens daily. */
export function ReadyPill({ hotelId }: { hotelId: string }) {
  const q = useQuery({
    queryKey: ["commissioning", hotelId],
    queryFn: () => getCommissioning(hotelId),
    enabled: !!hotelId,
  });

  if (!q.data) return null;
  return q.data.canTakeABooking ? (
    <StatusPill tone="success"><Check className="size-3" /> Ready</StatusPill>
  ) : (
    <StatusPill tone="warning">
      {q.data.blockedBy.length} to settle
    </StatusPill>
  );
}
