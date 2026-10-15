import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";
import { PackageSearch, Plus } from "lucide-react";
import { useUi } from "@/lib/ui";
import { dateShort } from "@/lib/format";
import {
  Page, PageHeader, Card, CardBody, Button, Skeleton, EmptyState, ErrorState, toast,
  Dialog, DialogContent, DialogClose, Field, fieldProps, Input, StatusPill, Segmented, IconChip,
} from "@/components/ui";
import { clearLost, listLost, logLost, type LostItem } from "@/modules/guest-services/data/wakeAndLost";

/* ══════════════════════════════════════════════════════════════════
   LOST PROPERTY (D27-239; the owner's answers D27-241)

   The desk and housekeeping log what was found; only the desk marks it
   returned (to whom) or disposed (why) - the server says which (`mayClear`)
   and refuses the rest. How long each has been kept is shown; nothing is
   disposed of by itself; no photo.
   ══════════════════════════════════════════════════════════════════ */

type View = "kept" | "cleared";

export default function LostPropertyPage() {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  const code = params["code"] ?? fallback;
  const qc = useQueryClient();
  const [view, setView] = useState<View>("kept");
  const [logging, setLogging] = useState(false);
  const [clearing, setClearing] = useState<{ item: LostItem; action: "returned" | "disposed" } | null>(null);

  const list = useQuery({ queryKey: ["lost-property", code, view], queryFn: () => listLost(code, view) });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["lost-property", code] });
  const items = list.data?.items ?? [];

  return (
    <Page>
      <PageHeader
        title="Lost property"
        description="What was found, kept until it goes back to its owner or is disposed of."
        actions={<Button variant="primary" className="h-11" onClick={() => setLogging(true)}>
          <Plus className="size-4" /> Log an item</Button>}
      />
      <Segmented<View> className="mb-5" value={view} onChange={setView}
        options={[{ value: "kept", label: "Kept" }, { value: "cleared", label: "Returned or disposed" }]} />

      {list.isLoading ? <Skeleton className="h-48" />
        : list.error ? <Card><ErrorState title="Lost property did not load" error={list.error}
                                         onRetry={() => void list.refetch()} /></Card>
        : items.length === 0 ? (
          <EmptyState title={view === "kept" ? "Nothing kept" : "Nothing returned or disposed of yet"}
            description={view === "kept"
              ? "An item shows here once the desk or housekeeping logs it."
              : "An item shows here once the desk returns it or disposes of it."} />
        ) : (
          <div className="space-y-3">
            {items.map((i) => (
              <Card key={i.id} data-lost-item={i.id}>
                <CardBody className="flex flex-wrap items-start gap-x-3.5 gap-y-3">
                  <IconChip className="mt-px"><PackageSearch /></IconChip>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-medium break-words">{i.what}</span>
                      {i.status === "returned" && <StatusPill tone="success">Returned</StatusPill>}
                      {i.status === "disposed" && <StatusPill tone="neutral">Disposed of</StatusPill>}
                    </p>
                    <p className="mt-1 text-sm text-grey-500">
                      Found {i.room ? `in room ${i.room}, ` : ""}{i.foundWhere} · {dateShort(i.foundOn)}
                      {i.foundBy ? ` by ${i.foundBy}` : ""}
                      {i.status === "kept" ? ` · ${i.daysKept} ${i.daysKept === 1 ? "day" : "days"} kept` : ""}
                    </p>
                    {i.keptWhere && <p className="mt-0.5 text-sm text-grey-600">Kept: {i.keptWhere}</p>}
                    {i.status === "returned" && (
                      <p className="mt-0.5 text-sm text-grey-600">
                        To {i.returnedTo}{i.handledBy ? `, by ${i.handledBy}` : ""}{i.handledOn ? `, ${dateShort(i.handledOn)}` : ""}</p>
                    )}
                    {i.status === "disposed" && (
                      <p className="mt-0.5 text-sm text-grey-600">
                        {i.disposeReason}{i.handledBy ? ` - ${i.handledBy}` : ""}{i.handledOn ? `, ${dateShort(i.handledOn)}` : ""}</p>
                    )}
                  </div>
                  {i.status === "kept" && list.data?.mayClear && (
                    <div className="flex flex-wrap gap-2 w-full pl-[42px] sm:w-auto sm:pl-0 sm:shrink-0">
                      <Button variant="secondary" className="h-11"
                              onClick={() => setClearing({ item: i, action: "returned" })}>Returned</Button>
                      <Button variant="ghost" className="h-11"
                              onClick={() => setClearing({ item: i, action: "disposed" })}>Disposed</Button>
                    </div>
                  )}
                </CardBody>
              </Card>
            ))}
          </div>
        )}

      {logging && <LogDialog code={code} onClose={() => setLogging(false)} onDone={refresh} />}
      {clearing && <ClearDialog code={code} {...clearing} onClose={() => setClearing(null)} onDone={refresh} />}
    </Page>
  );
}

function LogDialog({ code, onClose, onDone }: { code: string; onClose: () => void; onDone: () => void }) {
  const [what, setWhat] = useState("");
  const [foundWhere, setFoundWhere] = useState("");
  const [roomNumber, setRoomNumber] = useState("");
  const [keptWhere, setKeptWhere] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const res = await logLost(code, { what, foundWhere, roomNumber, keptWhere });
    setBusy(false);
    if (!res.ok) return toast.error("Not logged", res.reason);
    onClose(); onDone();
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title="Log an item" description="What was found, and where.">
        <div className="space-y-4">
          <Field label="What it is" required>
            {(f) => <Input {...fieldProps(f)} maxLength={200} value={what} autoFocus onChange={(e) => setWhat(e.target.value)} />}
          </Field>
          <Field label="Where it was found" required>
            {(f) => <Input {...fieldProps(f)} maxLength={200} value={foundWhere} onChange={(e) => setFoundWhere(e.target.value)} />}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Room" hint="If it was in one.">
              {(f) => <Input {...fieldProps(f)} autoCapitalize="characters" maxLength={10} value={roomNumber}
                             onChange={(e) => setRoomNumber(e.target.value)} />}
            </Field>
            <Field label="Where it is kept">
              {(f) => <Input {...fieldProps(f)} maxLength={200} value={keptWhere} onChange={(e) => setKeptWhere(e.target.value)} />}
            </Field>
          </div>
          <div className="flex gap-2">
            <DialogClose asChild><Button variant="secondary" className="h-12 flex-1">Cancel</Button></DialogClose>
            <Button variant="primary" className="h-12 flex-1" disabled={busy || !what.trim() || !foundWhere.trim()}
                    onClick={() => void save()}>Log it</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ClearDialog({ code, item, action, onClose, onDone }: {
  code: string; item: LostItem; action: "returned" | "disposed"; onClose: () => void; onDone: () => void;
}) {
  const [words, setWords] = useState("");
  const [busy, setBusy] = useState(false);
  const finish = async () => {
    setBusy(true);
    const res = await clearLost(code, item.id, action, words.trim());
    setBusy(false);
    if (!res.ok) return toast.error("Not changed", res.reason);
    onClose(); onDone();
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title={item.what} description={item.keptWhere ? `Kept: ${item.keptWhere}` : undefined}>
        <div className="space-y-4">
          <Field label={action === "returned" ? "Who it went to" : "Why it was disposed of"} required>
            {(f) => <Input {...fieldProps(f)} maxLength={200} value={words} autoFocus onChange={(e) => setWords(e.target.value)} />}
          </Field>
          <div className="flex gap-2">
            <DialogClose asChild><Button variant="secondary" className="h-12 flex-1">Back</Button></DialogClose>
            <Button variant={action === "returned" ? "primary" : "danger"} className="h-12 flex-1"
                    disabled={busy || !words.trim()} onClick={() => void finish()}>
              {action === "returned" ? "Mark returned" : "Mark disposed"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
