import { Link, useParams, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { getModules } from "@/data/repositories";
import { FileText } from "lucide-react";
import { Page, PageHeader, Button, Segmented } from "@/components/ui";
import { BarStockBody } from "@/modules/stores/pages/BarStock";
import { KitchenStockBody } from "@/modules/stores/pages/KitchenStock";

/* ══════════════════════════════════════════════════════════════════
   INVENTORY (the owner's D27-354): Bar and Restaurant

   The owner: "in the inventory section, there's two different things,
   bar and restaurant". BAR is the Bar stock page's parts - today's sheet,
   requests, bills, set up - the same page the Restaurant menu opens as
   "Bar stock" (BarStock.tsx). RESTAURANT (D27-373, D27-374) is the kitchen
   store's daily sheet and the recipes every KOT takes (KitchenStock.tsx).
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
          : "The kitchen's day: what came, what the KOTs used, what was wasted, what is left, and the count."}
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

      {tab === "restaurant" ? <KitchenStockBody code={code} /> : <BarStockBody code={code} />}
    </Page>
  );
}
