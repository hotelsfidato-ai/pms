import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";
import { ListChecks, Plus } from "lucide-react";
import { useUi } from "@/lib/ui";
import { dateTime } from "@/lib/format";
import {
  Page, PageHeader, Button, Card, CardHeader, CardBody, EmptyState, ErrorState, Skeleton, StatusPill,
  Switch, Dialog, DialogContent, Field, Input, NativeSelect, Textarea, toast,
} from "@/components/ui";
import {
  getChecklists, setChecklistsRequired, saveChecklist, removeChecklist, listChecklistRuns,
  JOB_LABELS, type Checklist, type ChecklistJob, type ChecklistSetup,
} from "@/modules/housekeeping/data/housekeeping";

/* ══════════════════════════════════════════════════════════════════
   HOUSEKEEPING CHECKLISTS (D27-383 item 10, D27-396) - /h/:code/checklists

   The switch (off by default: the board is unchanged until it is on), the
   lists per job and room type, and each room's history - who, when, and
   which items an inspection failed. The owner, an administrator or the GM
   change the lists and the switch; the ticking is on the board.
   ══════════════════════════════════════════════════════════════════ */

const JOBS: ChecklistJob[] = ["checkout", "stayover", "deep", "inspection"];

export default function ChecklistsPage() {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  const hotelId = params.code ?? fallback;
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["checklists", hotelId], queryFn: () => getChecklists(hotelId) });
  const [editing, setEditing] = useState<Checklist | "new" | null>(null);
  const data = q.data;

  const toggle = async (required: boolean) => {
    const res = await setChecklistsRequired(hotelId, required);
    if (!res.ok) return toast.error("Not changed", res.reason);
    toast.success(required ? "Rooms are now marked by their checklist." : "Rooms are marked with one tap again.");
    await qc.invalidateQueries({ queryKey: ["checklists"] });
  };

  return (
    <Page className="max-w-5xl">
      <PageHeader
        title="Housekeeping checklists"
        description="What is done in a room for each job, and each room's record of who ticked it."
        actions={data?.mayKeep ? (
          <Button variant="primary" onClick={() => setEditing("new")}>
            <Plus className="size-4" /> Add a checklist
          </Button>
        ) : undefined}
      />
      {q.isLoading ? (
        <div className="space-y-3" aria-busy="true"><Skeleton className="h-20" /><Skeleton className="h-48" /></div>
      ) : q.error && !data ? (
        <Card><ErrorState title="The checklists did not load" error={q.error} onRetry={() => void q.refetch()} /></Card>
      ) : data ? (
        <div className="space-y-6">
          <Card>
            <CardBody>
              <Switch
                checked={data.required}
                disabled={!data.mayKeep}
                onCheckedChange={(on) => void toggle(on)}
                label="A room is marked clean or inspected only by ticking its checklist"
                description={data.mayKeep
                  ? "Off: the board's Clean and Inspected mark a room with one tap, as before. A room type with no list for the job is always marked with one tap."
                  : "The owner, an administrator or the general manager switch this."}
              />
            </CardBody>
          </Card>
          <Lists data={data} onEdit={setEditing} />
          <History hotelId={hotelId} />
          {editing && (
            <ChecklistDialog hotelId={hotelId} data={data} list={editing === "new" ? null : editing}
              onClose={() => setEditing(null)} />
          )}
        </div>
      ) : null}
    </Page>
  );
}

function Lists({ data, onEdit }: { data: ChecklistSetup; onEdit: (c: Checklist) => void }) {
  if (data.checklists.length === 0) {
    return (
      <Card>
        <EmptyState compact icon={<ListChecks />} title="No checklists yet"
          description={data.mayKeep ? "Add one for a job - checkout clean, stay-over, deep clean or inspection."
            : "The owner, an administrator or the general manager adds them."} />
      </Card>
    );
  }
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {data.checklists.map((c) => (
        <Card key={c.id} data-checklist={`${c.job}:${c.roomType ?? "every"}`}>
          <CardHeader
            title={JOB_LABELS[c.job]}
            description={c.roomType ?? "Every room type"}
            actions={data.mayKeep ? <Button variant="ghost" size="sm" onClick={() => onEdit(c)}>Change</Button> : undefined}
          />
          <CardBody>
            <ol className="list-decimal pl-5 space-y-1 text-base text-ink-900">
              {c.items.map((i) => <li key={i}>{i}</li>)}
            </ol>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

function History({ hotelId }: { hotelId: string }) {
  const [room, setRoom] = useState("");
  const asked = room.trim();
  const runs = useQuery({
    queryKey: ["checklist-runs", hotelId, asked],
    queryFn: () => listChecklistRuns(hotelId, asked || undefined),
  });
  return (
    <section>
      <Card>
        <CardHeader title="Each room's record" description="Who ticked which list, when, and what an inspection failed." />
        <CardBody className="border-b border-grey-100">
          <Field label="Room" hint="Empty: every room">
            {({ id }) => <Input id={id} className="max-w-40" value={room} onChange={(e) => setRoom(e.target.value)} placeholder="204" />}
          </Field>
        </CardBody>
        {runs.isLoading ? (
          <CardBody><Skeleton className="h-16" /></CardBody>
        ) : runs.error ? (
          <ErrorState title="The record did not load" error={runs.error} onRetry={() => void runs.refetch()} />
        ) : (runs.data?.runs.length ?? 0) === 0 ? (
          <EmptyState compact title={asked ? `Nothing ticked in room ${asked.toUpperCase()} yet` : "Nothing ticked yet"}
            description="A list ticked on the board shows here." />
        ) : (
          <ul className="divide-y divide-grey-100">
            {runs.data!.runs.map((r) => (
              <li key={r.id} className="px-4 py-3" data-checklist-run={r.room}>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-md font-semibold text-ink-900 tabular w-12">{r.room}</span>
                  <span className="text-base text-ink-900">{JOB_LABELS[r.job]}</span>
                  {r.passed ? <StatusPill tone="success">{r.job === "inspection" ? "Passed" : "Done"}</StatusPill>
                    : <StatusPill tone="danger">Failed</StatusPill>}
                  <span className="text-sm text-grey-500">{r.doneBy ?? "-"}, {dateTime(r.doneAt)}</span>
                </div>
                {r.failed.length > 0 && (
                  <ul className="mt-1 pl-[3.75rem] text-sm text-brand-red-700 space-y-0.5">
                    {r.failed.map((f) => <li key={f.item}>{f.item}{f.note ? ` - ${f.note}` : ""}</li>)}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

function ChecklistDialog({ hotelId, data, list, onClose }: {
  hotelId: string; data: ChecklistSetup; list: Checklist | null; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [job, setJob] = useState<ChecklistJob>(list?.job ?? "checkout");
  const [roomTypeId, setRoomTypeId] = useState(list?.roomTypeId ?? "");
  const [text, setText] = useState(list?.items.join("\n") ?? "");
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const items = text.split("\n").map((l) => l.trim()).filter(Boolean);

  const save = async () => {
    setBusy(true);
    const res = await saveChecklist(hotelId, { ...(list ? { id: list.id } : {}), job, roomTypeId: roomTypeId || null, items });
    setBusy(false);
    if (!res.ok) return setSaid(res.reason);
    toast.success("The checklist is saved.");
    await qc.invalidateQueries({ queryKey: ["checklists"] });
    onClose();
  };
  const remove = async () => {
    if (!list) return;
    setBusy(true);
    const res = await removeChecklist(hotelId, list.id);
    setBusy(false);
    if (!res.ok) return setSaid(res.reason);
    toast.success("The checklist is removed. What was ticked with it stays on each room's record.");
    await qc.invalidateQueries({ queryKey: ["checklists"] });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={list ? `${JOB_LABELS[list.job]} · ${list.roomType ?? "Every room type"}` : "Add a checklist"}
        description="One item per line, in the order it is done."
        footer={<>
          {list && <Button variant="ghost" className="mr-auto text-brand-red-700" disabled={busy} onClick={() => void remove()}>Remove</Button>}
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || items.length === 0} onClick={() => void save()}>Save</Button>
        </>}
      >
        <div className="space-y-4">
          {!list && (
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Job" required>
                {({ id }) => (
                  <NativeSelect id={id} value={job} onChange={(e) => setJob(e.target.value as ChecklistJob)}>
                    {JOBS.map((j) => <option key={j} value={j}>{JOB_LABELS[j]}</option>)}
                  </NativeSelect>
                )}
              </Field>
              <Field label="Room type">
                {({ id }) => (
                  <NativeSelect id={id} value={roomTypeId} onChange={(e) => setRoomTypeId(e.target.value)}>
                    <option value="">Every room type</option>
                    {data.roomTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </NativeSelect>
                )}
              </Field>
            </div>
          )}
          <Field label="Items" required hint={`${items.length} item${items.length === 1 ? "" : "s"}`}>
            {({ id }) => (
              <Textarea id={id} rows={8} value={text} onChange={(e) => setText(e.target.value)}
                placeholder={"Bed made with fresh linen\nBathroom cleaned and dry\nTowels replaced"} />
            )}
          </Field>
          <p role="status" className={said ? "text-sm text-brand-red-700" : "sr-only"}>{said ?? ""}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
