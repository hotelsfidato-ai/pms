/* What an import would do, or did — shared by the menu and room imports.

   Service: core. Moved out of till.ts on 15 September in the
   service-folder move (docs/SERVICE-FOLDERS-PLAN.md); the code is
   unchanged. */

export interface ImportVerdict {
  line: number;
  name: string;
  action: "create" | "update" | "rejected";
  detail: string;
}

export interface ImportReport {
  ok: boolean;
  reason?: string;
  dryRun: boolean;
  verdicts: ImportVerdict[];
  creates: number;
  updates: number;
  rejected: number;
}
