import { useParams } from "react-router";
import { Page, PageHeader } from "@/components/ui";
import { SupplierDues } from "@/modules/purchasing/components/SupplierDues";

/* Supplier dues on its own address, for the Accountant's menu (the owner's
   D27-372); the same list as Purchasing's Supplier dues tab. */
export default function SupplierDuesPage() {
  const { code = "" } = useParams();
  return (
    <Page>
      <PageHeader title="Supplier dues"
        description="What we owe suppliers: the bills taken on credit, what is paid and what is left." />
      <SupplierDues hotelId={code} />
    </Page>
  );
}
