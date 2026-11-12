import { useState } from "react";
import { useParams } from "react-router";
import { FileSpreadsheet, FileText } from "lucide-react";
import { Button, toast } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useUi } from "@/lib/ui";
import { useRole } from "@/lib/session";
import {
  LIST_SCREENS, exportList, exportRefusal,
  type ExportColumn, type ExportFacts, type ListScreenKey,
} from "@/modules/reports/data/listExport";

/* PDF and Excel on a list screen (D27-383 item 1): what the screen shows,
   every row, made on the server. Disabled until the list has loaded, and
   disabled WITH ITS REASON for a role that may open the screen but not
   take its money or guests away in a file (Rule 6). */
export function ExportButtons<T>({ screen, rows, columns, facts }: {
  screen: ListScreenKey;
  /** Undefined while the list loads. */
  rows: T[] | undefined;
  columns: ExportColumn<T>[];
  facts?: ExportFacts;
}) {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  const hotel = params.code ?? fallback;
  const refusal = exportRefusal(useRole(), LIST_SCREENS[screen]);
  const [busy, setBusy] = useState<"pdf" | "xlsx" | null>(null);

  const get = async (format: "pdf" | "xlsx", label: string) => {
    setBusy(format);
    try {
      toast.success(`${label} saved`, await exportList(hotel, screen, format, columns, rows ?? [], facts));
    } catch (error) {
      toast.error(`The ${label} was not made`, error instanceof ApiError ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-2" data-export={screen}>
      {([["pdf", "PDF", FileText], ["xlsx", "Excel", FileSpreadsheet]] as const).map(([format, label, Icon]) => (
        <Button key={format} variant="secondary" size="sm"
          disabled={!rows || refusal !== null || busy !== null}
          onClick={() => void get(format, label)}>
          <Icon className="size-4" />
          {busy === format ? "Saving…" : label}
        </Button>
      ))}
      {refusal && <span className="text-xs text-grey-500 max-w-xs">{refusal}</span>}
    </span>
  );
}
