import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Mail } from "lucide-react";
import {
  Button, Card, CardBody, Dialog, DialogContent, Field, ReadFailed, Segmented, Textarea, fieldProps, toast,
} from "@/components/ui";
import { emailReport, getEmailInfo, type FileType } from "@/modules/reports/data/emails";

/* ══════════════════════════════════════════════════════════════════
   EMAIL THIS REPORT (the owner's D27-383 item 5)

   On every report the server makes a PDF and an Excel of: the report as
   it is on screen - the same question its files are asked - to the
   addresses typed or picked from the hotel's report addresses, with a
   short note. The server asks who may (whoever may open the report),
   checks every address and writes each send down; its sentence is shown
   when it refuses.
   ══════════════════════════════════════════════════════════════════ */

/** Typed one a line, or with commas: the server checks each. */
const addressesIn = (text: string) => text.split(/[\s,;]+/).filter(Boolean);

export function EmailReport({ hotel, report, title, query, ready }: {
  hotel: string;
  report: string;
  title: string;
  /** The report's question, as its file route takes it. */
  query: Record<string, string>;
  /** False until the report has loaded: an email of a report nobody has seen is an email of nothing. */
  ready: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [fileType, setFileType] = useState<FileType>("pdf");
  const info = useQuery({
    queryKey: ["report-email", report, hotel], queryFn: () => getEmailInfo(hotel, report), enabled: open && !!hotel,
  });
  const typed = addressesIn(to);
  const send = useMutation({
    mutationFn: () => emailReport(hotel, report, { query, fileType, to: typed, note }),
    onSuccess: (r) => {
      toast.success("Emailed", `Sent to ${r.sent.join(", ")}.`);
      if (r.failed.length) {
        toast.error("Not sent to everybody", r.failed.map((f) => `${f.address}: ${f.reason}`).join(" "));
      }
      setOpen(false);
      setTo("");
      setNote("");
    },
    onError: (e) => toast.error("Not sent", e instanceof Error ? e.message : undefined),
  });
  const pick = (address: string) =>
    setTo((text) => (addressesIn(text).includes(address) ? text : [...addressesIn(text), address].join("\n")));
  const notConnected = info.data?.notConnected ?? null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="secondary" size="sm" disabled={!ready} onClick={() => setOpen(true)}>
        <Mail className="size-4" />
        Email
      </Button>
      <DialogContent
        title={`Email the ${title}`}
        description="As it is on screen: the same days and the same choices, attached as a file."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={send.isPending}
              disabled={!info.data || notConnected !== null || typed.length === 0}
              onClick={() => send.mutate()}>
              Send
            </Button>
          </>
        }
      >
        {info.isError ? (
          <ReadFailed error={info.error} what="who may get this report" onRetry={() => void info.refetch()} compact />
        ) : (
          <div className="space-y-4">
            {notConnected && (
              <Card className="border-brand-yellow-100 bg-brand-yellow-50">
                <CardBody>
                  <p className="text-sm text-ink-900 leading-relaxed">
                    <span className="font-medium">Nothing can be sent yet</span>{" - "}{notConnected}
                  </p>
                </CardBody>
              </Card>
            )}
            <Field label="Send to"
              hint={typed.length ? "One email address a line."
                : info.data?.recipients.length ? "Type at least one address, or pick one below." : "Type at least one address."}>
              {(f) => (
                <Textarea {...fieldProps(f)} rows={3} placeholder="name@example.com" value={to}
                  onChange={(e) => setTo(e.target.value)} />
              )}
            </Field>
            {info.data && info.data.recipients.length > 0 && (
              <div>
                <p className="text-sm text-grey-600 mb-1.5">The hotel's report addresses</p>
                <div className="flex flex-wrap gap-1.5">
                  {info.data.recipients.map((a) => (
                    <Button key={a} variant="secondary" size="sm" disabled={typed.includes(a)} onClick={() => pick(a)}>
                      {a}
                    </Button>
                  ))}
                </div>
              </div>
            )}
            <Field label="File" hint={info.data ? `At most ${info.data.mostMegabytes} MB; a larger one is not sent.` : undefined}>
              {() => (
                <Segmented className="self-start" value={fileType} onChange={setFileType}
                  options={[{ value: "pdf", label: "PDF" }, { value: "xlsx", label: "Excel" }]} />
              )}
            </Field>
            <Field label="Note" hint="Optional. It goes at the top of the email.">
              {(f) => (
                <Textarea {...fieldProps(f)} rows={2} maxLength={500} value={note}
                  onChange={(e) => setNote(e.target.value)} />
              )}
            </Field>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
