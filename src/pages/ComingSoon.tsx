import { Info, type LucideIcon } from "lucide-react";
import { Page, PageHeader, Card, CardBody, StatusPill, IconChip } from "@/components/ui";
import { COMING_SOON_ROLES, ROLE_LABELS } from "@/lib/permissions";

/* ══════════════════════════════════════════════════════════════════
   COMING SOON — a service the hotel system will have, named not hidden

   The owner's decision, 16 September: every service the system does not
   have yet — the CRS, the channel manager, leads, spa and the rest — gets
   a page in one "Coming soon" section at the foot of the menu, seen by
   the owner, admins and general managers (`seesComingSoon`). Somebody
   looking for a spa screen finds one that says "not yet, and here is
   what it needs", instead of concluding the system cannot do it or that
   they have not looked hard enough.

   The same rule the channel manager's page set: NOTHING IS INVENTED.
   Every page says what the service will do, what it needs before it can
   be built, and what exists today — true of the system as it stands.
   No figures, no sample rows, no mock screens. A service's page lives in
   its own folder (`src/modules/<service>/pages/`) and is replaced by the
   real screens the day it is built.
   ══════════════════════════════════════════════════════════════════ */

export interface ComingSoonContent {
  /** The menu name, and the page heading. */
  title: string;
  /** One sentence under the heading: what the service is for. */
  summary: string;
  /** The pill beside the heading. "Coming soon" unless it says otherwise
      — a parked service, or one built only when a hotel asks, says so. */
  status?: string;
  /** Three things it will do. */
  willDo: ReadonlyArray<{ icon: LucideIcon; title: string; body: string }>;
  /** What must exist or be decided before it can be built. */
  needs: readonly string[];
  /** Where it stands today — a fact about the system as it is. */
  today: string;
  /** The screens it will work with, by their menu names. */
  leansOn?: readonly string[];
}

const WHO = COMING_SOON_ROLES.map((role) => ROLE_LABELS[role]);
const WHO_SEES = `${WHO.slice(0, -1).join(", ")} and ${WHO[WHO.length - 1]}`;

export function ComingSoonPage({ content }: { content: ComingSoonContent }) {
  const { title, summary, status = "Coming soon", willDo, needs, today, leansOn } = content;

  return (
    <Page>
      <PageHeader
        title={title}
        badge={<StatusPill tone="neutral">{status}</StatusPill>}
        description={summary}
      />

      {/* 12px between cards (the Rhythm Rule); they touched before. The
          three tiles go three across on a desktop: `@2xl:` had no
          container to measure, so they were one long column everywhere. */}
      <div className="grid gap-3">
        <Card>
          <CardBody className="space-y-3">
            <h2 className="text-md font-semibold text-ink-900">What it will do</h2>
            <ul className="grid gap-2 lg:grid-cols-3">
              {willDo.map((x) => (
                <li key={x.title} className="rounded-lg border border-grey-200 bg-white px-3.5 py-3">
                  <IconChip className="mb-2"><x.icon /></IconChip>
                  <p className="text-base font-medium text-ink-900">{x.title}</p>
                  <p className="text-sm text-grey-600 mt-1 leading-relaxed">{x.body}</p>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="space-y-3">
            <h2 className="text-md font-semibold text-ink-900">
              What it needs before it can be built
            </h2>
            <ol className="space-y-1.5 text-base text-ink-900">
              {needs.map((need, i) => (
                <li key={need} className="flex gap-2">
                  <span className="text-grey-500 tabular">{i + 1}</span>
                  <span>{need}</span>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <h2 className="text-md font-semibold text-ink-900 mb-3">Where it stands today</h2>
            <p className="text-base text-ink-900 leading-relaxed max-w-prose">{today}</p>
            {leansOn && leansOn.length > 0 && (
              <p className="text-sm text-grey-500 mt-2">
                It will work with: {leansOn.join(", ")}.
              </p>
            )}
          </CardBody>
        </Card>
      </div>

      <p className="flex items-start gap-2 text-sm text-grey-500 leading-relaxed mt-5">
        <Info className="size-3.5 shrink-0 mt-0.5" aria-hidden />
        <span>
          Nothing on this page works yet. It says what will be built and what
          it needs, so nobody has to wonder whether they missed a screen.
          Only {WHO_SEES} see the Coming soon pages.
        </span>
      </p>
    </Page>
  );
}
