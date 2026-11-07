import { useState, type ReactNode } from "react";
import { Printer, FileSpreadsheet, FileText, Table2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { dateShort } from "@/lib/format";
import {
  Button, Card, Page, PageHeader, Term, toast, DocMasthead, DOC_TH,
} from "@/components/ui";
import { downloadFile, ApiError } from "@/lib/api";
import type { TermKey } from "@/lib/glossary";
import { toCsv, downloadCsv, reportFilename } from "@/lib/csv";
import { useDocumentIdentity } from "@/lib/documentIdentity";
import { useUi } from "@/lib/ui";
import { useGroupSettings } from "@/modules/admin";
import { useIsTestHotel } from "@/lib/testHotel";
import { TestDocumentMark } from "@/components/app/TestHotel";

/* ══════════════════════════════════════════════════════════════════
   REPORT SHELL

   Every report carries the same four things, because the real exports
   do: the property name, the report title, the period, and a
   generated-at stamp naming the user. The live system's footer reads
   `26/08/2026 07:43:49 AM   admin   Page 1 of 1` and an accountant
   reads that line.

   Print styling lives here too — `no-print` on the chrome, so what
   reaches paper is the report and nothing else. On paper and on screen
   the report wears the printed documents' look (the CRS voucher, D27-52):
   the masthead with the property, the title and the period, and a 2px
   ink rule over who printed it.
   ══════════════════════════════════════════════════════════════════ */

const DASH = "-";

export function ReportShell({
  title,
  /** The property this report is for.
   *
   *  ⚠ THIS DEFAULTED TO THE LITERAL "5 Elements By Fidato Hotels" and
   *  not one of the thirty report screens passed it, so every report of
   *  every property printed that one name. It now comes from the
   *  property in view; an override is still accepted for a report that
   *  genuinely knows better. */
  property,
  period,
  children,
  onExportPdf,
  csv,
  /** Shown above the table — the report's own header line. */
  meta,
  /** The report's own settings (a switch, a date), above it and never printed. */
  controls,
  /** The report and its query, for the files the server makes of it. */
  download,
  /** Its Email button (D27-383 item 5), beside the files. */
  email,
}: {
  title: string;
  property?: string;
  period: string;
  children: ReactNode;
  onExportPdf?: () => void;
  /** The report's own rows, for the export.
   *
   *  A FUNCTION rather than an array so a report with ten thousand rows
   *  does not build the whole export on every render just in case
   *  somebody clicks.
   *
   *  This replaced `onExportExcel`, which one report passed as
   *  `() => window.print()` — a button labelled Excel that opened a
   *  print dialogue. A control that lies about what it does is worse
   *  than one that is missing. */
  csv?: () => { headers: string[]; rows: unknown[][] };
  meta?: ReactNode;
  controls?: ReactNode;
  download?: { path: (kind: "pdf" | "xlsx" | "csv") => string; ready: boolean };
  email?: ReactNode;
}) {
  const identity = useDocumentIdentity();
  const propertyName = property ?? identity.property ?? DASH;
  /* The group's name and logo on every printed document (D27-53). */
  const group = useGroupSettings(useUi((s) => s.hotelId) ?? "");
  /* WHO RAN IT. The footer said "front desk" whoever was signed in. An
     accountant reading a stamp needs the person, and the session has
     had their name all along. */
  const ranBy = identity.user ?? DASH;
  /* A test hotel's report (the owner's D27-296 (8)): TEST · NOT VALID on
     the report itself, on screen and on paper. */
  const test = useIsTestHotel();

  const stamp = new Date().toLocaleString("en-IN", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });

  return (
    <Page className="max-w-[1400px] print:p-0">
      {/* Chrome — never printed. The header names the tab too. */}
      <PageHeader
        className="no-print"
        title={title}
        description={period}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => window.print()}>
              <Printer className="size-4" />
              Print
            </Button>
            {onExportPdf && (
              <Button variant="secondary" size="sm" onClick={onExportPdf}>
                <FileText className="size-4" />
                PDF
              </Button>
            )}
            {download && <Downloads download={download} />}
            {email}
            {csv && !download && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const { headers, rows } = csv();
                  downloadCsv(
                    reportFilename(propertyName, title, period),
                    toCsv(headers, rows),
                  );
                }}
              >
                <FileSpreadsheet className="size-4" />
                {/* CSV and not "Excel". It writes a .csv, Excel opens it,
                    and a label naming a product the file is not is the
                    same lie in a smaller font. */}
                CSV
              </Button>
            )}
          </>
        }
      />

      {controls && (
        <div className="no-print flex flex-wrap items-center gap-4 mb-5">{controls}</div>
      )}

      <Card className="px-4 py-4 sm:px-6 sm:py-5 print:border-0 print:p-0">
        {/* The report's own header, as the exports carry it: the property,
            then the report and its period behind the orange bar. */}
        {test && <TestDocumentMark />}
        <DocMasthead name={propertyName} group={group.name} logo={group.logo} title={title} number={period} />
        {meta && (
          <p className="text-sm text-grey-600 tabular mb-4">{meta}</p>
        )}

        <div className="overflow-x-auto scrollbar-quiet">{children}</div>

        <footer className="mt-6 border-t-2 border-ink-700 pt-2.5 flex items-center justify-between gap-4 flex-wrap">
          {/* Labelled: a bare date and time under a report headed "As on
              25 Aug 2026" reads as a second report date. It is when this
              copy was produced. */}
          <p className="text-xs text-grey-500 tabular">Printed {stamp}</p>
          <p className="text-xs text-grey-500">{ranBy}</p>
        </footer>
      </Card>
    </Page>
  );
}

/* ── The files the server makes of a report ────────────────────────
   PDF, a real spreadsheet and a CSV (D17-31, D17-32), all made on the
   server from the same document the screen is drawing, so what is
   filed and what is read cannot differ. The button says what went
   wrong in the server's own words, and it is disabled until the report
   itself has loaded — a file of a report nobody has seen is a file of
   nothing. */

const FILES: Array<{ kind: "pdf" | "xlsx" | "csv"; label: string; icon: typeof FileText }> = [
  { kind: "pdf", label: "PDF", icon: FileText },
  { kind: "xlsx", label: "Excel", icon: FileSpreadsheet },
  { kind: "csv", label: "CSV", icon: Table2 },
];

function Downloads({ download }: {
  download: { path: (kind: "pdf" | "xlsx" | "csv") => string; ready: boolean };
}) {
  const [busy, setBusy] = useState<string | null>(null);

  const get = async (kind: "pdf" | "xlsx" | "csv", label: string) => {
    setBusy(kind);
    try {
      const name = await downloadFile(download.path(kind));
      toast.success(`${label} saved`, name);
    } catch (error) {
      toast.error(
        `The ${label} was not made`,
        error instanceof ApiError ? error.message : String(error),
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {FILES.map((f) => (
        <Button
          key={f.kind}
          variant="secondary"
          size="sm"
          disabled={!download.ready || busy !== null}
          onClick={() => void get(f.kind, f.label)}
        >
          <f.icon className="size-4" />
          {busy === f.kind ? "Saving…" : f.label}
        </Button>
      ))}
    </>
  );
}

/* ── Shared table pieces ─────────────────────────────────────────── */

export function ReportTable({ children }: { children: ReactNode }) {
  return <table className="w-full border-collapse text-base">{children}</table>;
}

export function ReportHead({ columns }: {
  columns: Array<{ label: string; numeric?: boolean; width?: string; term?: TermKey }>;
}) {
  return (
    <thead>
      <tr>
        {columns.map((c) => (
          <th
            key={c.label}
            scope="col"
            /* The printed documents' header: small capitals over a 2px ink rule. */
            className={cn(
              DOC_TH,
              "px-4 pt-2 align-bottom whitespace-nowrap",
              c.numeric ? "text-right" : "text-left",
              c.width,
            )}
          >
            {c.term ? <Term name={c.term}>{c.label}</Term> : c.label}
          </th>
        ))}
      </tr>
    </thead>
  );
}

/**
 * A money cell. Negatives are real and stay visible — never blank,
 * never in brackets. A null is a figure this system cannot derive,
 * and prints as a dash rather than a misleading zero.
 */
export function Amount({
  value, bold, format,
}: {
  value: number | null | undefined;
  bold?: boolean;
  format: (n: number) => string;
}) {
  if (value === null || value === undefined) {
    return <span className="text-grey-500" title="Not held in this system yet">-</span>;
  }
  return (
    <span
      className={cn(
        "tabular",
        bold && "font-semibold text-ink-900",
        value < 0 && "text-brand-red",
      )}
    >
      {format(value)}
    </span>
  );
}

export { dateShort };
