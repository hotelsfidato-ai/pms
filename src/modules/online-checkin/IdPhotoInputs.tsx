import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { Field } from "@/components/ui";

/* The two photos of an ID - the front, and the back if it has one - chosen
   on the device and shown FROM the device before anything is sent. Used by
   the guest's own page and by the desk at check-in; what each says around
   it (the notice, the tick) is theirs.

   Only a JPEG or a PNG is asked for, so a phone hands over a JPEG rather
   than its own format. The server decides again by the file's own bytes. */

export interface ChosenPhotos { front: File | null; back: File | null }

const FILE = cn(
  "block w-full min-h-12 text-base text-grey-700",
  "file:mr-3 file:min-h-11 file:rounded-md file:border file:border-grey-300",
  "file:bg-white file:px-3 file:text-base file:text-ink-900",
);

/** The chosen file as this device shows it; never fetched from anywhere. */
function Preview({ file, alt }: { file: File | null; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file || typeof URL.createObjectURL !== "function") { setUrl(null); return; }
    const made = URL.createObjectURL(file);
    setUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [file]);
  return url ? <img src={url} alt={alt} className="mt-2 max-h-40 rounded-md border border-grey-200" /> : null;
}

export function IdPhotoInputs(
  { value, onChange, camera = false, disabled = false }:
  { value: ChosenPhotos; onChange: (next: ChosenPhotos) => void; camera?: boolean; disabled?: boolean },
) {
  const input = (side: "front" | "back", label: string) => (
    <Field label={label}>
      {(f) => (
        <>
          <input
            id={f.id} type="file" accept="image/jpeg,image/png" disabled={disabled}
            /* At the desk the clerk photographs the ID in their hand. */
            {...(camera ? { capture: "environment" as const } : {})}
            onChange={(e) => onChange({ ...value, [side]: e.target.files?.[0] ?? null })}
            className={FILE}
          />
          <Preview file={value[side]} alt={`${label}, as it will be sent`} />
        </>
      )}
    </Field>
  );
  return (
    <>
      {input("front", "Front of the ID")}
      {input("back", "Back, if it has one")}
    </>
  );
}
