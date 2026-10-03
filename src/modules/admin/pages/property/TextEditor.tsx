import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Textarea, toast } from "@/components/ui";
import { can } from "@/lib/permissions";
import { useRole } from "@/lib/session";
import { PROFILE_KEY, saveText, type TextKind } from "@/modules/admin/data/property";

/* One of the hotel's texts (D27-257): plain text, a blank line between
   paragraphs, 2000 characters. Saved blank, it is removed. */
export function TextEditor({ code, kind, label, value, hint }: {
  code: string; kind: TextKind; label: string; value: string; hint?: string;
}) {
  const qc = useQueryClient();
  const mayEdit = can(useRole(), "edit", "room_config");
  const [typed, setTyped] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const text = typed ?? value;

  const save = async () => {
    setBusy(true);
    const res = await saveText(code, kind, text);
    setBusy(false);
    if (!res.ok) return void toast.error("Not saved", res.reason);
    toast.success(`${label} saved`, text.trim() ? "Guests see it from now on." : "Removed.");
    setTyped(null);
    void qc.invalidateQueries({ queryKey: PROFILE_KEY(code) });
  };

  return (
    <div>
      <label className="block text-sm font-medium text-ink-900 mb-1.5" htmlFor={`text-${kind}`}>{label}</label>
      {hint && <p className="text-sm text-grey-500 mb-2">{hint}</p>}
      <Textarea id={`text-${kind}`} rows={6} maxLength={2000} value={text} readOnly={!mayEdit}
        onChange={(e) => setTyped(e.target.value)} />
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="text-xs text-grey-500 tabular">{text.length} / 2000</span>
        {mayEdit && (
          <Button variant="secondary" loading={busy} disabled={typed === null || typed === value}
            aria-label={`Save ${label}`} onClick={() => void save()}>Save</Button>
        )}
      </div>
    </div>
  );
}
