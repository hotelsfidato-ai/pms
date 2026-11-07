import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";
import { FileDown, FileUp } from "lucide-react";
import { dateShort } from "@/lib/format";
import { useUi } from "@/lib/ui";
import { useRole } from "@/lib/session";
import { can } from "@/lib/permissions";
import { useDocumentTitle } from "@/lib/documentTitle";
import {
  Page, PageHeader, Card, CardBody, CardHeader, Button, Input, Skeleton, EmptyState, ErrorState,
  Menu, MenuItem, StatusPill, toast,
} from "@/components/ui";
import {
  getRoomingList, readRoomingFile, saveRoomingList, downloadRoomingList,
  type FileRead, type RoomingRoom,
} from "@/modules/reservations/data/roomingList";

/* ══════════════════════════════════════════════════════════════════
   THE ROOMING LIST (D27-383 item 8, built under D27-396)

   A booking of several rooms is made in one guest's name; the group sends
   the names later. Here they are typed, or read from the Excel or CSV file
   the group sent - its columns matched and every problem listed before
   anything is saved - and on Save each name becomes the guest of its
   booking, every row or none. Printed and downloaded for the front desk and
   the group leader. The room type, dates, plan and who pays are the
   booking's: shown and checked against the file, changed on the booking.
   ══════════════════════════════════════════════════════════════════ */

const STATUS_WORD: Record<string, string> = {
  confirmed: "Due in", tentative: "Waiting for the hotel", checked_in: "In house", checked_out: "Checked out",
};

type Typed = Record<string, { guestName: string; phone: string }>;
const typedFrom = (rows: RoomingRoom[]): Typed =>
  Object.fromEntries(rows.map((r) => [r.reservationId, { guestName: r.guest, phone: r.phone ?? "" }]));

export default function RoomingListPage() {
  const params = useParams();
  const hotelId = params["code"] ?? useUi.getState().hotelId;
  const groupId = params["id"] ?? "";
  const qc = useQueryClient();
  const mayEdit = can(useRole(), "edit", "reservation");
  const fileInput = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState<Typed>({});
  const [read, setRead] = useState<FileRead | null>(null);
  const [busy, setBusy] = useState<"read" | "save" | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  const list = useQuery({
    queryKey: ["rooming-list", hotelId, groupId],
    queryFn: () => getRoomingList(hotelId, groupId),
    enabled: !!groupId,
  });
  useDocumentTitle(list.data ? `Rooming list · ${list.data.group.name}` : "Rooming list");
  useEffect(() => { if (list.data) setTyped(typedFrom(list.data.rows)); }, [list.data]);

  if (list.isLoading) {
    return <Page><PageHeader title="Rooming list" description="Loading…" /><Skeleton className="h-80" /></Page>;
  }
  if (list.isError) {
    return (
      <Page>
        <PageHeader title="Rooming list" />
        <ErrorState title="The rooming list could not be read." onRetry={() => void list.refetch()} />
      </Page>
    );
  }
  if (!list.data) {
    return (
      <Page>
        <PageHeader title="Rooming list" />
        <EmptyState title="No such group" description="It may belong to another property, or every room was cancelled." />
      </Page>
    );
  }

  const { group, rows } = list.data;
  const changed = rows.filter((r) => r.editable && typed[r.reservationId]
    && (typed[r.reservationId]!.guestName.trim() !== r.guest
      || typed[r.reservationId]!.phone.trim() !== (r.phone ?? "")));
  const blank = changed.find((r) => !typed[r.reservationId]!.guestName.trim());
  const saveReason = !mayEdit ? "Filling in the rooming list is for whoever may change a booking."
    : changed.length === 0 ? "Type a guest's name, or read the group's file."
      : blank ? `${blank.reference} has no guest name.` : null;

  const set = (id: string, k: "guestName" | "phone", v: string) =>
    setTyped((t) => ({ ...t, [id]: { guestName: "", phone: "", ...t[id], [k]: v } }));

  const readFile = async (file: File) => {
    setBusy("read");
    setProblems([]);
    const result = await readRoomingFile(hotelId, groupId, file);
    setBusy(null);
    if (!("rows" in result)) { setRead(null); return toast.error("Not read", result.reason); }
    setRead(result);
    /* Filled in only when the whole file is right: nothing half-read. */
    if (!result.ok) return;
    setTyped((t) => {
      const next = { ...t };
      for (const r of result.rows) next[r.reservationId] = { guestName: r.guestName, phone: r.phone };
      return next;
    });
    toast.success(`${result.rows.length} ${result.rows.length === 1 ? "name" : "names"} read`,
      "Check them, then Save the rooming list. Nothing is saved yet.");
  };

  const save = async () => {
    setBusy("save");
    const result = await saveRoomingList(hotelId, groupId, changed.map((r) => ({
      reservationId: r.reservationId,
      guestName: typed[r.reservationId]!.guestName.trim(),
      phone: typed[r.reservationId]!.phone.trim(),
    })));
    setBusy(null);
    if (!result.ok) {
      const p = (result as { problems?: string[] }).problems;
      setProblems(p ?? [result.reason]);
      return toast.error("Not saved", "Nothing was saved. Every problem is listed above the rooms.");
    }
    setProblems([]);
    setRead(null);
    toast.success("Rooming list saved",
      result.changed === 1 ? "1 booking has its guest's name." : `${result.changed} bookings have their guests' names.`);
    void qc.invalidateQueries({ queryKey: ["rooming-list", hotelId, groupId] });
    void qc.invalidateQueries({ queryKey: ["group", hotelId, groupId] });
  };

  const download = (as: "pdf" | "xlsx" | "csv") => {
    downloadRoomingList(hotelId, groupId, as).catch((e: Error) => toast.error("Not downloaded", e.message));
  };

  const listed = [...problems, ...(read && !read.ok ? read.problems.map((p) => p.reason) : [])];

  return (
    <Page>
      <PageHeader
        title="Rooming list"
        breadcrumbs={[
          { label: "Groups", to: `/h/${hotelId}/groups` },
          { label: group.name, to: `/h/${hotelId}/groups/${group.id}` },
          { label: "Rooming list" },
        ]}
        description={[group.blockCode, group.company, `${rows.length} ${rows.length === 1 ? "room" : "rooms"}`]
          .filter(Boolean).join(" · ")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Menu label="Print or download">
              <MenuItem icon={FileDown} onSelect={() => download("pdf")}>PDF, to print or send</MenuItem>
              <MenuItem icon={FileDown} onSelect={() => download("xlsx")}>Excel</MenuItem>
              <MenuItem icon={FileDown} onSelect={() => download("csv")}>CSV</MenuItem>
            </Menu>
            {mayEdit && (
              <Button leadingIcon={<FileUp />} loading={busy === "read"}
                onClick={() => fileInput.current?.click()}>
                Read the group's file
              </Button>
            )}
            <input ref={fileInput} type="file" className="hidden" aria-label="The group's file"
              accept=".xlsx,.csv,.txt"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void readFile(f); }} />
          </div>
        }
      />

      <p className="text-sm text-grey-600 mb-4">
        Type each guest&rsquo;s name, or read the Excel or CSV file the group sent: its columns are
        matched (Booking, or Room type, Arrival and Departure; Guest name; Phone), and every problem is
        listed before anything is saved. On Save each name becomes the guest of its booking. The room
        type, dates, plan and who pays are the booking&rsquo;s and change there.
      </p>

      {listed.length > 0 && (
        <Card className="mb-4 border-brand-red-200" data-rooming-problems>
          <CardHeader title="Nothing was saved"
            description={read && !read.ok ? "The file was not filled in. Correct it, or the rooms below, and try again." : undefined} />
          <CardBody>
            <ul className="list-disc pl-5 space-y-1 text-sm text-brand-red-700">
              {listed.map((p, i) => <li key={i}>{p}</li>)}
            </ul>
          </CardBody>
        </Card>
      )}
      {read?.ok && read.unknownColumns.length > 0 && (
        <p className="mb-4 text-sm text-grey-600">Columns not read: {read.unknownColumns.join(", ")}.</p>
      )}

      <Card>
        <CardBody className="p-0">
          <div className="overflow-x-auto scrollbar-quiet">
            <table className="w-full text-base border-collapse">
              <thead className="bg-grey-50 border-b border-grey-200">
                <tr className="[&>th]:px-4 [&>th]:h-10 [&>th]:whitespace-nowrap [&>th]:text-2xs [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-wide [&>th]:text-grey-500 [&>th]:text-left">
                  <th>Booking</th>
                  <th>Room type</th>
                  <th>Dates</th>
                  <th>Plan</th>
                  <th>Who pays</th>
                  <th>Guest name</th>
                  <th>Phone</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const t = typed[r.reservationId] ?? { guestName: r.guest, phone: r.phone ?? "" };
                  const open = mayEdit && r.editable;
                  return (
                    <tr key={r.reservationId} className="border-b border-grey-100 last:border-b-0 [&>td]:align-middle">
                      <td className="px-4 py-2.5">
                        <span className="tabular text-sm whitespace-nowrap">{r.reference}</span>
                        {r.status !== "confirmed" && (
                          <span className="block"><StatusPill tone="neutral">{STATUS_WORD[r.status] ?? r.status}</StatusPill></span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {r.roomType}
                        <span className="block text-xs text-grey-500 tabular">{r.room ? `Room ${r.room}` : "No room yet"}</span>
                      </td>
                      <td className="px-4 py-2.5 tabular text-sm whitespace-nowrap">
                        {dateShort(r.checkIn)} → {dateShort(r.checkOut)}
                      </td>
                      <td className="px-4 py-2.5 text-sm">{r.mealPlan}</td>
                      <td className="px-4 py-2.5 text-sm">{r.whoPays === "host" ? "Host" : "Guest"}</td>
                      <td className="px-4 py-2 min-w-48">
                        {open ? (
                          <Input aria-label={`Guest name, ${r.reference}`} value={t.guestName} maxLength={120}
                            onChange={(e) => set(r.reservationId, "guestName", e.target.value)} />
                        ) : <span>{r.guest}</span>}
                      </td>
                      <td className="px-4 py-2 min-w-40">
                        {open ? (
                          <Input aria-label={`Phone, ${r.reference}`} value={t.phone} inputMode="tel"
                            placeholder="-" onChange={(e) => set(r.reservationId, "phone", e.target.value)} />
                        ) : <span className="tabular text-sm">{r.phone ?? "-"}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardBody>
        <CardBody className="flex flex-wrap items-center gap-3 border-t border-grey-100">
          <Button variant="primary" size="lg" disabled={saveReason !== null} loading={busy === "save"}
            onClick={() => void save()}>
            Save rooming list
          </Button>
          <span className="text-sm text-grey-600">
            {saveReason ?? `${changed.length} ${changed.length === 1 ? "booking" : "bookings"} will take the name typed.`}
          </span>
        </CardBody>
      </Card>
    </Page>
  );
}
