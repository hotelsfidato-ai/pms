import { Page, PageHeader } from "@/components/ui";
import { useUi } from "@/lib/ui";
import { HotelGalleryCard } from "@/modules/admin/components/HotelGalleryCard";
import { HotelLogoCard } from "@/modules/admin/components/GroupCard";

/* The hotel's logo and photos in the Settings console (D27-243, D27-257):
   phase 1's page at this address kept the logo here, so it stays, above
   the gallery card built on 2 October. */
export default function Photos() {
  const code = useUi((s) => s.hotelId);
  return (
    <Page>
      <PageHeader title="Logo and photos" description="The logo prints on this hotel's documents; the photos show to guests after the code." />
      <div className="flex flex-col gap-3">
        <HotelLogoCard hotelCode={code} />
        <HotelGalleryCard hotelCode={code} />
      </div>
    </Page>
  );
}
