import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Upload, Download, FileWarning, CheckCircle2, PlusCircle, RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  Button, Dialog, DialogContent, StatusPill, toast,
} from "@/components/ui";
import {
  downloadTemplate, parseCsv, fileProblem, type ImportSpec,
} from "@/lib/importSpec";
import { importMenu, type ImportReport } from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   A FILE, LOOKED AT BEFORE IT LANDS

   Three states, and the middle one is the reason this exists:

     choose   the template is offered FIRST, because the commonest
              failure is a file with the wrong columns and the cheapest
              fix is starting from the right ones
     preview  every row, and what would happen to it. Nothing has been
              written
     done     what actually happened

   The preview is not a courtesy. An import is the one action in this
   system that can change two hundred prices at once, and the only
   moment anybody can catch a shifted column is before it applies.

   REJECTED ROWS ARE LISTED, NOT SWALLOWED, AND NOT REPAIRED. A dish
   with no price does not land at zero; it is named with its line
   number so the file can be fixed and sent again — which updates
   rather than duplicates.
   ══════════════════════════════════════════════════════════════════ */

export function ImportDialog({
  hotelId, spec, open, onOpenChange, onImported,
}: {
  hotelId: string;
  spec: ImportSpec;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onImported: () => void;
}) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [applied, setApplied] = useState(false);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setRows(null); setFileName(""); setProblem(null);
    setReport(null); setApplied(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const choose = async (file: File) => {
    reset();
    setFileName(file.name);

    /* The wrong FILE is far commoner than a wrong row, and it fails
       silently otherwise — an .xlsx read as text is binary noise, and
       every row then fails for a reason unrelated to the real one. */
    const bad = fileProblem(file);
    if (bad) { setProblem(bad); return; }

    const text = await file.text();
    const parsed = parseCsv(text, spec);

    if (parsed.missing.length > 0) {
      setProblem(
        `That file has no ${parsed.missing.join(" or ")} column. `
        + "Start from the template — the headers have to match.");
      return;
    }
    if (parsed.rows.length === 0) {
      setProblem("That file has headers and no rows.");
      return;
    }

    setRows(parsed.rows);

    /* Unknown columns are NOT an error. Somebody's own spreadsheet
       carries a supplier column and a note to themselves, and refusing
       the file over them would be officious. Said out loud, though, so
       a misspelled header is not mistaken for a working one. */
    if (parsed.unknown.length > 0) {
      setProblem(
        `Ignoring ${parsed.unknown.length === 1 ? "a column" : "columns"} `
        + `this does not use: ${parsed.unknown.join(", ")}. `
        + "If one of those was meant to be a heading above, check its spelling.");
    }

    setBusy(true);
    const dry = await importMenu(hotelId, parsed.rows, true);
    setBusy(false);
    if (!dry.ok) { setProblem(dry.reason ?? "That file could not be read."); return; }
    setReport(dry);
  };

  const apply = async () => {
    if (!rows || busy) return;
    setBusy(true);
    const done = await importMenu(hotelId, rows, false);
    setBusy(false);
    if (!done.ok) return toast.error("Not imported", done.reason);

    setReport(done);
    setApplied(true);
    void qc.invalidateQueries();
    toast.success(
      `${done.creates + done.updates} ${spec.what} imported`,
      done.rejected > 0
        ? `${done.rejected} rows were rejected and are listed — fix them and send the file again.`
        : "Nothing was rejected.");
    onImported();
  };

  const rejected = (report?.verdicts ?? []).filter((v) => v.action === "rejected");
  const accepted = (report?.verdicts ?? []).filter((v) => v.action !== "rejected");

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent
        title={`Import ${spec.what}`}
        description={
          applied
            ? "Done. What happened is below."
            : report
              ? "Nothing has been saved yet. This is what would happen."
              : "A spreadsheet, saved as CSV. Start from the template."
        }
        footer={
          applied ? (
            <Button className="h-11" onClick={() => onOpenChange(false)}>Close</Button>
          ) : (
            <>
              <Button variant="secondary" className="h-11"
                      onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button className="h-11"
                      disabled={!report || busy || accepted.length === 0}
                      onClick={() => void apply()}>
                {busy ? "Working…"
                  : report
                    ? `Import ${accepted.length} ${accepted.length === 1 ? "row" : "rows"}`
                    : "Import"}
              </Button>
            </>
          )
        }
      >
        <div className="space-y-3">
          {/* ── The template, offered first ───────────────────────── */}
          {!report && (
            <div className="rounded-md border border-grey-200 bg-grey-50 p-3">
              <p className="text-base text-ink-900">Start from the template</p>
              <p className="text-sm text-grey-600 mt-0.5 leading-relaxed">
                It carries the headers this reads, a note under each saying
                what belongs in it, and a few worked rows. Delete the
                examples, put your own in, and save it as CSV.
              </p>
              <Button variant="secondary" className="h-11 mt-2"
                      onClick={() => downloadTemplate(spec)}>
                <Download className="size-4" /> Download the template
              </Button>
            </div>
          )}

          {/* ── Choosing a file ───────────────────────────────────── */}
          {!report && (
            <div>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.txt,text/csv"
                className="sr-only"
                id="import-file"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void choose(f);
                }}
              />
              <label
                htmlFor="import-file"
                className="flex items-center justify-center gap-2 min-h-11
                           rounded-md border border-dashed border-grey-300
                           bg-white px-3 py-4 cursor-pointer
                           hover:border-brand-orange transition-colors"
              >
                <Upload className="size-4 text-grey-400" />
                <span className="text-base text-ink-900">
                  {fileName || "Choose a CSV file"}
                </span>
              </label>
            </div>
          )}

          {problem && (
            <div className="flex items-start gap-2.5 rounded-md border
                            border-amber-300 bg-amber-50 p-3">
              <FileWarning className="size-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-sm text-ink-900 leading-relaxed">{problem}</p>
            </div>
          )}

          {busy && !report && (
            <p className="text-sm text-grey-500">Reading {fileName}…</p>
          )}

          {/* ── What would happen ─────────────────────────────────── */}
          {report && (
            <>
              <div className="flex flex-wrap gap-2">
                <Tally icon={PlusCircle} tone="ok"
                       n={report.creates} what="new" />
                <Tally icon={RefreshCw} tone="ok"
                       n={report.updates} what="updated" />
                <Tally icon={FileWarning} tone="bad"
                       n={report.rejected} what="rejected" />
              </div>

              {applied && (
                <div className="flex items-start gap-2.5 rounded-md border
                                border-green-200 bg-green-50 p-3">
                  <CheckCircle2 className="size-4 text-green-700 shrink-0 mt-0.5" />
                  <p className="text-sm text-ink-900 leading-relaxed">
                    Saved. {report.rejected > 0
                      ? "The rejected rows below did not land — correct them in "
                        + "the file and import it again, which updates rather "
                        + "than duplicates."
                      : "Every row landed."}
                  </p>
                </div>
              )}

              {rejected.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-ink-900 mb-1.5">
                    {applied ? "Did not land" : "Will not land"}
                  </p>
                  <ul className="space-y-1 max-h-40 overflow-y-auto scrollbar-quiet">
                    {rejected.map((v) => (
                      <li key={v.line}
                          className="flex gap-2 text-sm rounded border
                                     border-red-200 bg-red-50 px-2.5 py-1.5">
                        <span className="tabular text-grey-500 shrink-0">
                          line {v.line}
                        </span>
                        <span className="text-ink-900 min-w-0">
                          <span className="font-medium">{v.name}</span>
                          {" — "}{v.detail}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {accepted.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-ink-900 mb-1.5">
                    {applied ? "Landed" : "Will land"}
                  </p>
                  <ul className="space-y-0.5 max-h-48 overflow-y-auto scrollbar-quiet">
                    {accepted.map((v) => (
                      <li key={v.line}
                          className="flex items-baseline gap-2 text-sm px-2.5 py-1">
                        <StatusPill tone={v.action === "create" ? "success" : "neutral"}>
                          {v.action === "create" ? "New" : "Update"}
                        </StatusPill>
                        <span className="text-ink-900 truncate">{v.name}</span>
                        <span className="text-grey-500 truncate">{v.detail}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {!applied && (
                <p className="text-sm text-grey-500 leading-relaxed">
                  Nothing above has been saved. Importing the same file again
                  later corrects prices rather than adding a second copy.
                </p>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Tally({ icon: Icon, n, what, tone }: {
  icon: typeof PlusCircle; n: number; what: string; tone: "ok" | "bad";
}) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1",
      n === 0
        ? "border-grey-200 bg-grey-50 text-grey-400"
        : tone === "bad"
          ? "border-red-200 bg-red-50 text-ink-900"
          : "border-grey-200 bg-white text-ink-900",
    )}>
      <Icon className="size-3.5" />
      <span className="tabular font-medium">{n}</span>
      <span className="text-sm">{what}</span>
    </span>
  );
}
