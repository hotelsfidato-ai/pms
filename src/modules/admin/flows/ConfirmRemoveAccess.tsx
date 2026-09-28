import { useState } from "react";
import { Button, Dialog, DialogContent } from "@/components/ui";

/* "ARE YOU SURE?" BEFORE A PERSON LOSES A PROPERTY - the owner's D27-117
   (QA Q-6, AD-7). One click on the ✕ used to take somebody's access away at
   once. Now it asks, names who and where, and does nothing until Remove. */
export function ConfirmRemoveAccess({ name, code, onCancel, onRemove }: {
  name: string;
  code: string;
  onCancel: () => void;
  /** Resolves when the removal is done, whatever its answer. */
  onRemove: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    await onRemove();
    setBusy(false);
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onCancel()}>
      <DialogContent
        title={`Remove ${name} from ${code}?`}
        size="sm"
        footer={
          <>
            <Button variant="secondary" size="lg" disabled={busy} onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="danger" size="lg" loading={busy} onClick={() => void remove()}>
              Remove
            </Button>
          </>
        }
      >
        <p className="text-base text-grey-600 leading-relaxed">
          They can no longer work at {code}. Their account stays, and their
          name stays on everything they did there.
        </p>
      </DialogContent>
    </Dialog>
  );
}
