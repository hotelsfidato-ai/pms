import { Page, PageHeader } from "@/components/ui";
import { useUi } from "@/lib/ui";
import { CommissioningCard } from "@/modules/admin/flows/CommissioningCard";
import { PropertyProfileCard } from "@/modules/admin/components/PropertyProfileCard";
import { RegistrationsCard } from "./RegistrationsCard";

/* The property's profile in the Settings console (phase 2; D27-257). The
   setup checklist first (it draws itself only while something is missing),
   then phase 1's profile card (the profile and FSSAI), then the four more
   registration numbers and the map link. */
export default function Profile() {
  const code = useUi((s) => s.hotelId);
  return (
    <Page>
      <PageHeader title="Profile" description="The name, address and numbers the hotel prints, and where it is." />
      <div className="flex flex-col gap-3">
        <CommissioningCard hotelId={code} />
        <PropertyProfileCard hotelId={code} />
        <RegistrationsCard hotelCode={code} />
      </div>
    </Page>
  );
}
