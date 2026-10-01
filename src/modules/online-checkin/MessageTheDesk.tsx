import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { dateShort } from "@/lib/format";
import { Button, Card, CardBody, Field, fieldProps, StatusPill, Textarea } from "@/components/ui";
import { cn } from "@/lib/cn";
import { getThread, makeRequest } from "@/modules/online-checkin/data/guestPage";
import { H2, SECTION, messageFrom, unlockGone, useUnlockGone } from "@/modules/online-checkin/guestKit";

/* ── Message the front desk (D23-14), and its replies (D27-224) ───────
   Anything, in the guest's own words. A request of kind 'desk' through the
   same door and the same limits as a spa or laundry request; it lands in
   the booking's Guest messages at the desk, unread until handled.

   Under it, the conversation, newest first: what they sent, each Sent or
   Handled (the owner, 24 September), and the desk's replies as "Front
   desk" - never a name (D27-224). The day only, no time. Read again every
   30 seconds while the page is open, and not while it is hidden: there is
   no WhatsApp "the desk replied" (the owner, D27-224). The words are text
   nodes, never HTML. */
export function MessageTheDesk({ token, onUnlockGone }: { token: string; onUnlockGone: () => void }) {
  const qc = useQueryClient();
  const [what, setWhat] = useState("");
  const thread = useQuery({
    queryKey: ["guest-behind", token, "messages"],
    queryFn: () => getThread(token),
    retry: false,
    /* React Query skips the timer while the page is hidden
       (`refetchIntervalInBackground` is off). */
    refetchInterval: 30_000,
  });
  const send = useMutation({
    mutationFn: () => makeRequest(token, { kind: "desk", what }),
    onSuccess: async () => {
      setWhat("");
      await qc.invalidateQueries({ queryKey: ["guest-behind", token, "messages"] });
    },
  });
  useUnlockGone(thread.error ?? send.error, onUnlockGone);
  const lines = thread.data?.thread ?? [];

  return (
    <section className={SECTION}>
      <h2 className={cn(H2, "mb-3")}>Message the front desk</h2>
      <Card><CardBody>
        <form onSubmit={(e) => { e.preventDefault(); send.mutate(); }} className="flex flex-col gap-3">
          <Field label="Your message">
            {(f) => (
              <Textarea {...fieldProps(f)} rows={3} maxLength={500}
                value={what} onChange={(e) => setWhat(e.target.value)} />
            )}
          </Field>
          <Button type="submit" variant="secondary" disabled={send.isPending || what.trim() === ""}>
            {send.isPending ? "Sending…" : "Send to the front desk"}
          </Button>
          {send.isSuccess && what === "" && (
            <p className="text-sm text-grey-600">Sent. The front desk will see it.</p>
          )}
          {send.error && !unlockGone(send.error) && (
            <p className="text-sm text-brand-red-700">{messageFrom(send.error)}</p>
          )}
        </form>

        {/* The conversation: list rows under a hairline, not boxes in the card. */}
        {lines.length > 0 && (
          <ul className="mt-3.5 border-t border-grey-100 divide-y divide-grey-100 -mb-3.5">
            {lines.map((t, i) => t.from === "desk" ? (
              <li key={`desk-${t.at}-${i}`} className="py-3 text-sm" data-from="desk">
                <p className="font-semibold text-ink-900">Front desk</p>
                <p className="mt-0.5 text-ink-900 whitespace-pre-line break-words">{t.what}</p>
                <p className="mt-1 text-grey-600">{dateShort(t.at)}</p>
              </li>
            ) : (
              <li key={`you-${t.at}-${i}`} className="py-3 text-sm">
                <p className="text-ink-900 whitespace-pre-line break-words">{t.what}</p>
                <p className="mt-1 flex items-center gap-2 text-grey-600">
                  {dateShort(t.at)}
                  <StatusPill tone={t.status === "open" ? "neutral" : "success"}>
                    {t.status === "open" ? "Sent" : "Handled"}
                  </StatusPill>
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardBody></Card>
    </section>
  );
}
