import { useLocation } from "react-router";
import { Construction } from "lucide-react";
import { Page, PageHeader, Card, CardBody, EmptyState, StatusPill } from "@/components/ui";

/* ══════════════════════════════════════════════════════════════════
   PLACEHOLDER

   A route that exists in the navigation but has not been built yet.
   It names what the screen WILL carry rather than pretending to be
   finished — an honest placeholder is a correct answer at this stage;
   an invented flow is not.
   ══════════════════════════════════════════════════════════════════ */

export default function PlaceholderPage({
  title,
  carries,
  checkpoint,
}: {
  title: string;
  /** What this screen will show once built. */
  carries?: string;
  /** Which checkpoint builds it. */
  checkpoint?: string;
}) {
  const { pathname } = useLocation();

  return (
    <Page>
      <PageHeader
        title={title}
        badge={checkpoint ? <StatusPill tone="neutral">{checkpoint}</StatusPill> : undefined}
        description={carries}
      />
      <Card>
        <CardBody>
          <EmptyState
            icon={<Construction />}
            title="Not built yet"
            description={
              carries
                ? `This screen will carry: ${carries}`
                : "This route is reserved in the navigation and has no screen yet."
            }
          />
          <p className="text-center text-2xs text-grey-400 tabular mt-2">{pathname}</p>
        </CardBody>
      </Card>
    </Page>
  );
}
