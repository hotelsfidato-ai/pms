import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import {
  Button, Card, CardBody, Input, Page, PageHeader, SearchInput, Skeleton, StatusPill, Switch, toast,
} from "@/components/ui";
import { can } from "@/lib/permissions";
import { useRole } from "@/lib/session";
import { useUi } from "@/lib/ui";
import {
  AMENITIES_KEY, addAmenity, changeAmenity, getAmenities, orderAmenities, removeAmenity, switchAmenity,
  type Amenity,
} from "@/modules/admin/data/property";
import { amenityIcon } from "./amenityIcons";

/* ══════════════════════════════════════════════════════════════════
   AMENITIES (the owner's D27-257): ONE list for the whole group. Each
   hotel's GM switches on what the hotel has (guests see those, behind the
   code); the owner or an Admin adds, renames, orders, turns Off and
   deletes - delete only while no hotel has it on. Phase 3 lets each room
   type pick from the same list.
   ══════════════════════════════════════════════════════════════════ */

export default function Amenities() {
  const code = useUi((s) => s.hotelId);
  const qc = useQueryClient();
  const mayEdit = can(useRole(), "edit", "room_config");
  const q = useQuery({ queryKey: AMENITIES_KEY(code), queryFn: () => getAmenities(code), enabled: Boolean(code) });
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState<string | null>(null);
  const list = q.data?.amenities ?? [];
  const mayKeep = q.data?.mayKeep === true;
  const shown = list.filter((a) => a.name.toLowerCase().includes(search.trim().toLowerCase()));
  const refresh = () => void qc.invalidateQueries({ queryKey: AMENITIES_KEY(code) });
  const said = async (work: Promise<{ ok: boolean; reason?: string }>, done?: string) => {
    const res = await work;
    if (!res.ok) toast.error("Not saved", "reason" in res ? res.reason : undefined);
    else if (done) toast.success(done);
    refresh();
  };

  const move = (from: number, to: number) => {
    const ids = list.map((a) => a.id);
    [ids[from], ids[to]] = [ids[to]!, ids[from]!];
    void said(orderAmenities(code, ids));
  };

  return (
    <Page>
      <PageHeader title="Amenities"
        description="Switch on what this hotel has; guests see them on their page. One list for every hotel in the group."
        actions={mayKeep && adding === null && (
          <Button aria-label="Add an amenity" onClick={() => setAdding("")}><Plus className="size-4" /> Add</Button>
        )} />
      <Card>
        <CardBody className="flex flex-col gap-3">
          <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find an amenity" aria-label="Find an amenity" />
          {adding !== null && (
            <form className="flex gap-2" onSubmit={(e) => {
              e.preventDefault();
              void said(addAmenity(code, adding.trim()), "Added - every hotel can switch it on now");
              setAdding(null);
            }}>
              <Input autoFocus maxLength={40} aria-label="New amenity" placeholder="Rooftop garden"
                value={adding} onChange={(e) => setAdding(e.target.value)} />
              <Button type="submit" disabled={!adding.trim()}>Add</Button>
              <Button type="button" variant="ghost" onClick={() => setAdding(null)}>Cancel</Button>
            </form>
          )}
          {q.isLoading ? <Skeleton className="h-64 w-full" /> : (
            <ul className="divide-y divide-grey-100">
              {shown.map((a) => (
                <AmenityRow key={a.id} code={code} amenity={a} mayEdit={mayEdit} mayKeep={mayKeep}
                  first={list[0]?.id === a.id} last={list.at(-1)?.id === a.id} searching={search.trim() !== ""}
                  onMove={(by) => { const i = list.findIndex((x) => x.id === a.id); move(i, i + by); }}
                  said={said} />
              ))}
            </ul>
          )}
          {!q.isLoading && shown.length === 0 && <p className="text-sm text-grey-500">Nothing by that name.</p>}
        </CardBody>
      </Card>
    </Page>
  );
}

function AmenityRow({ code, amenity: a, mayEdit, mayKeep, first, last, searching, onMove, said }: {
  code: string; amenity: Amenity; mayEdit: boolean; mayKeep: boolean; first: boolean; last: boolean;
  searching: boolean; onMove: (by: -1 | 1) => void;
  said: (work: Promise<{ ok: boolean; reason?: string }>, done?: string) => Promise<void>;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const Icon = amenityIcon(a.icon);

  return (
    <li className="flex flex-wrap items-center gap-2 py-2.5">
      <Icon className="size-4 shrink-0 text-grey-500" aria-hidden />
      <div className="min-w-0 flex-1">
        {renaming !== null ? (
          <form className="flex gap-2" onSubmit={(e) => {
            e.preventDefault();
            void said(changeAmenity(code, a.id, { name: renaming.trim() }));
            setRenaming(null);
          }}>
            <Input autoFocus maxLength={40} aria-label={`New name for ${a.name}`} value={renaming}
              onChange={(e) => setRenaming(e.target.value)} />
            <Button type="submit" variant="secondary" disabled={!renaming.trim()}>Save</Button>
          </form>
        ) : mayEdit && a.isActive ? (
          <Switch label={a.name} checked={a.on} onCheckedChange={(on) => void said(switchAmenity(code, a.id, on))} />
        ) : (
          <span className="flex items-center gap-2 text-base text-ink-900">
            {a.name}{!a.isActive && <StatusPill tone="neutral">Off for every hotel</StatusPill>}
            {a.isActive && a.on && <StatusPill tone="success">Here</StatusPill>}
          </span>
        )}
      </div>
      {mayKeep && renaming === null && (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" aria-label={`Move ${a.name} up`} disabled={first || searching} onClick={() => onMove(-1)}>
            <ArrowUp className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" aria-label={`Move ${a.name} down`} disabled={last || searching} onClick={() => onMove(1)}>
            <ArrowDown className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" aria-label={`Rename ${a.name}`} onClick={() => setRenaming(a.name)}>
            <Pencil className="size-4" />
          </Button>
          <Button variant="ghost" onClick={() => void said(changeAmenity(code, a.id, { isActive: !a.isActive }))}>
            {a.isActive ? "Turn Off" : "Turn On"}
          </Button>
          {!a.used && (
            <Button variant="ghost" size="icon" aria-label={`Delete ${a.name}`}
              onClick={() => void said(removeAmenity(code, a.id), "Deleted")}>
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
      )}
    </li>
  );
}
