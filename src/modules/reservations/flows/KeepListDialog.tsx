import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, Dialog, DialogContent, Input, toast } from "@/components/ui";

/* ══════════════════════════════════════════════════════════════════
   A LIST THE OWNER KEEPS - sales people (D27-37), room promotions (D27-36)

   The smallest screen that keeps one: the list as it stands, a row to add,
   a bin per row, Save. It is saved WHOLE; a name taken off is switched off
   on the server, never deleted, so the bookings that used it keep it.
   Only the owner, an administrator or the GM see the button that opens it,
   and the server asks again.
   ══════════════════════════════════════════════════════════════════ */

interface Item { name: string; percent?: number }

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  items: Item[];
  withPercent?: boolean;
  onSave: (items: Item[]) => Promise<{ ok: true } | { ok: false; reason: string }>;
}

/* The rows are drawn from the list each time it OPENS, and not while it is
   open - so a refetch behind it cannot wipe what is being typed. */
export function KeepListDialog(props: Props) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <KeepList {...props} />}
    </Dialog>
  );
}

function KeepList({
  onOpenChange, title, description, items, withPercent = false, onSave,
}: Props) {
  const [rows, setRows] = useState(() => items.map((i) => ({
    name: i.name, percent: i.percent === undefined ? "" : String(i.percent),
  })));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    const r = await onSave(rows
      .filter((row) => row.name.trim())
      .map((row) => ({
        name: row.name.trim(),
        ...(withPercent ? { percent: Number(row.percent) } : {}),
      })));
    setBusy(false);
    if (!r.ok) return toast.error("Not saved", r.reason);
    toast.success(`${title} saved`);
    onOpenChange(false);
  };

  return (
      <DialogContent
        title={title}
        description={description}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={() => void save()}>
              Save the list
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          {rows.length === 0 && (
            <p className="text-base text-grey-500">Nobody on the list yet. Add the first.</p>
          )}
          {rows.map((row, i) => (
            <div key={i} className="flex gap-2">
              <Input aria-label="Name" value={row.name} placeholder="Name"
                onChange={(e) => setRows((rs) => rs.map((r, j) => j === i ? { ...r, name: e.target.value } : r))}
                className="h-11 flex-1 min-w-0" />
              {withPercent && (
                <Input aria-label="Percent" type="number" inputMode="decimal" min={0} max={100}
                  value={row.percent} placeholder="%"
                  onChange={(e) => setRows((rs) => rs.map((r, j) => j === i ? { ...r, percent: e.target.value } : r))}
                  className="h-11 w-24 tabular" />
              )}
              <Button variant="secondary" className="h-11 w-11 p-0" aria-label="Take off the list"
                onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <Button variant="ghost" onClick={() => setRows((rs) => [...rs, { name: "", percent: "" }])}>
            <Plus className="size-4" /> Add
          </Button>
        </div>
      </DialogContent>
  );
}
