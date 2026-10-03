import { Page, PageHeader } from "@/components/ui";
import { useUi } from "@/lib/ui";
import { HotelGalleryCard } from "@/modules/admin/components/HotelGalleryCard";

/* The hotel's photos in the Settings console (D27-243, D27-257): the
   gallery card built on 2 October, on its own page. */
export default function Photos() {
  const code = useUi((s) => s.hotelId);
  return (
    <Page>
      <PageHeader title="Photos" description="Twenty at most, shown to guests on their page after the code." />
      <HotelGalleryCard hotelCode={code} />
    </Page>
  );
}
