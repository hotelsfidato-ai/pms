import { Link, useParams, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { getModules } from "@/data/repositories";
import { FileText } from "lucide-react";
import { Page, PageHeader, Card, CardBody, Button, Segmented } from "@/components/ui";
import { BarStockBody } from "@/modules/stores/pages/BarStock";

/* ══════════════════════════════════════════════════════════════════
   INVENTORY (the owner's D27-354): Bar, and Restaurant to come

   The owner: "in the inventory section, there's two different things,
   bar and restaurant ... leave restaurant open for now". BAR is the Bar
   stock page's three parts - today's sheet, bills, set up - the same page
   the Restaurant menu opens as "Bar stock" (BarStock.tsx).
   ══════════════════════════════════════════════════════════════════ */

export default function InventoryPage() {
  const { code = "" } = useParams<{ code: string }>();
  const [params, setParams] = useSearchParams();
  /* Bar stock switched off at this hotel (D27-367): no Bar tab. */
  const modules = useQuery({ queryKey: ["modules", code], queryFn: () => getModules(code), staleTime: 5 * 60_000 }).data;
  const barOn = modules?.["bar_stock"] !== false;
  const tab = params.get("tab") === "restaurant" || !barOn ? "restaurant" : "bar";

  return (
    <Page>
      <PageHeader
        title="Inventory"
        description={tab === "bar"
          ? "The bar's day: what came, what was sold, what is left, and the count."
          : "The restaurant's stock comes next."}
        actions={tab === "bar" && (
          <Button asChild variant="secondary" leadingIcon={<FileText />}>
            <Link to="/reports/bar-stock">Bar stock report</Link>
          </Button>
        )}
      />
      <Segmented className="mb-4" value={tab}
        onChange={(t) => setParams(t === "restaurant" ? { tab: "restaurant" } : {}, { replace: true })}
        options={barOn ? [{ value: "bar", label: "Bar" }, { value: "restaurant", label: "Restaurant" }]
          : [{ value: "restaurant", label: "Restaurant" }]} />

      {tab === "restaurant" ? (
        <Card><CardBody className="text-sm text-grey-600">
          The restaurant's stock is being built next. Until then the Store keeps the kitchen's stock, as it does today.
        </CardBody></Card>
      ) : <BarStockBody code={code} />}
    </Page>
  );
}
