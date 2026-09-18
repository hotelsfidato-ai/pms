import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { ShieldCheck } from "lucide-react";
import { ROLE_LABELS, type Role } from "@/lib/permissions";
import {
  Page, PageHeader, Card, CardBody, Button, Skeleton, ErrorState, toast,
} from "@/components/ui";
import { getRequesters, setRequester } from "@/modules/purchasing/data/purchasing";

/* ══════════════════════════════════════════════════════════════════
   WHO MAY RAISE A PURCHASE REQUEST — the owner's D18-2

   Their answer, in their terms: a SETTING, per property, so it can be
   changed at any time without a deploy. It starts as the Inventory
   Manager, the general manager, the owner and an administrator; a
   department head - the kitchen, housekeeping - is switched on the day
   the owner wants them.

   A ROLE AND NOT A PERSON, for the reason the approvals engine gives
   about approvers: staff leave, and a list pointing at somebody who has
   left is a list that stops.

   SWITCHED OFF, NEVER DELETED. Who was allowed to buy things last March
   is part of the record of what was bought.

   Every switch is shown to anybody who may see purchasing, because a
   person refused needs to know who to ask; only the owner and an
   administrator may move one.
   ══════════════════════════════════════════════════════════════════ */

export default function WhoMayAskPage() {
  const { code = "" } = useParams<{ code: string }>();
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["purchasing", "requesters", code],
    queryFn: () => getRequesters(code),
    enabled: !!code,
  });

  const flip = async (role: string, next: boolean) => {
    const out = await setRequester(code, role, next);
    if (!out.ok) { toast.error(out.reason); return; }
    toast.success(
      next
        ? `${ROLE_LABELS[role as Role] ?? role} can now raise a purchase request.`
        : `${ROLE_LABELS[role as Role] ?? role} can no longer raise one.`);
    void qc.invalidateQueries({ queryKey: ["purchasing", "requesters", code] });
    /* The Purchasing screen asks the same question of itself. */
    void qc.invalidateQueries({ queryKey: ["purchasing", code] });
  };

  const body = (() => {
    if (q.data === undefined) {
      if (q.isError) {
        return (
          <ErrorState
            title="The setting did not load"
            error={q.error}
            onRetry={() => void q.refetch()}
          />
        );
      }
      return <Skeleton className="h-64" />;
    }

    const { mayChange } = q.data;
    /* SORTED BY WHAT A PERSON READS, not by the key underneath it. The
       server answers in `stores`/`front_desk` order, which puts Reception
       between Accountant and General Manager on screen and reads like an
       accident. The stored value is an identifier; ROLE_LABELS is what
       anybody reads (src/lib/permissions.ts says so itself). */
    const roles = [...q.data.roles].sort((a, b) =>
      (ROLE_LABELS[a.role as Role] ?? a.role)
        .localeCompare(ROLE_LABELS[b.role as Role] ?? b.role));

    return (
      <div className="space-y-4">
        {!mayChange && (
          <Card>
            <CardBody className="text-sm text-ink-700">
              Changing this is for the owner or an administrator. What it says
              today is below.
            </CardBody>
          </Card>
        )}

        <Card>
          <CardBody className="p-0">
            <ul className="divide-y divide-grey-200">
              {roles.map((r) => (
                <li
                  key={r.role}
                  className="flex items-center justify-between gap-4 px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-medium text-ink-900">
                      {ROLE_LABELS[r.role as Role] ?? r.role}
                    </p>
                    <p className="text-sm text-ink-600">
                      {r.mayRaise ? "Can raise a request" : "Cannot raise a request"}
                    </p>
                  </div>
                  {mayChange ? (
                    /* SECONDARY, both ways. `primary` is solid brand orange
                       and there is ONE per screen (clarity step 2); a switch
                       per role drew nine of them down one list. The label
                       says which way it goes and the line above says where
                       it stands, so nothing is lost by being quiet. */
                    <Button
                      variant="secondary"
                      onClick={() => void flip(r.role, !r.mayRaise)}
                    >
                      {r.mayRaise ? "Switch off" : "Switch on"}
                    </Button>
                  ) : (
                    <span className="text-sm text-ink-600">
                      {r.mayRaise ? "Yes" : "-"}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>
    );
  })();

  return (
    <Page>
      <PageHeader
        title="Who may ask to buy"
        description={
          "The roles at this property that may raise a purchase request. It "
          + "takes effect at once - nothing has to be released for it. The "
          + "general manager still approves every purchase, whoever asked."
        }
        breadcrumbs={[
          { label: "Purchasing", to: `/h/${code}/purchasing` },
          { label: "Who may ask to buy" },
        ]}
        badge={<ShieldCheck className="size-5 text-ink-500" aria-hidden />}
        actions={
          <Button asChild variant="secondary">
            <Link to={`/h/${code}/purchasing`}>Back to purchasing</Link>
          </Button>
        }
      />
      {body}
    </Page>
  );
}
