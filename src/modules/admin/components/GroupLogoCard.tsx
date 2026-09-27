import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardBody, CardHeader, Skeleton, toast } from "@/components/ui";
import { can } from "@/lib/permissions";
import { useRole } from "@/lib/session";
import {
  getGroupLogo, setGroupLogo, removeGroupLogo, logoSrc, GROUP_LOGO_KEY,
} from "@/modules/admin/data/groupLogo";

/* The group's logo on Settings (the owner's D27-53): one for every hotel,
   printed on every bill. Changed by the owner, an administrator or the GM
   (the owner, 27 September) - the role gate's room-setup grant, which the
   server asks too. Shown only as an <img> (data/groupLogo.ts says why). */
export function GroupLogoCard({ hotelCode }: { hotelCode: string }) {
  const queryClient = useQueryClient();
  const mayEdit = can(useRole(), "edit", "room_config");
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const logo = useQuery({
    queryKey: GROUP_LOGO_KEY,
    queryFn: () => getGroupLogo(hotelCode),
    enabled: Boolean(hotelCode),
  });
  const src = logoSrc(logo.data ?? null);

  const upload = async (file: File) => {
    setBusy(true);
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    const res = await setGroupLogo(hotelCode, url.slice(url.indexOf(",") + 1));
    setBusy(false);
    if (!res.ok) return toast.error("Not saved", res.reason);
    toast.success("Logo saved", "It prints on every bill at every hotel from now on.");
    void queryClient.invalidateQueries({ queryKey: GROUP_LOGO_KEY });
  };

  const remove = async () => {
    setBusy(true);
    const res = await removeGroupLogo(hotelCode);
    setBusy(false);
    if (!res.ok) return toast.error("Not removed", res.reason);
    toast.success("Logo removed", "Bills print the hotel's name.");
    void queryClient.invalidateQueries({ queryKey: GROUP_LOGO_KEY });
  };

  return (
    <Card>
      <CardHeader
        title="Group logo"
        description="One logo for every hotel, printed on every bill. A PNG or an SVG, 200 KB at most."
      />
      <CardBody className="pt-0 flex flex-wrap items-center gap-4">
        {logo.isLoading ? (
          <Skeleton className="h-16 w-48" />
        ) : src ? (
          <img src={src} alt="The group's logo" className="h-16 w-auto max-w-full object-contain" />
        ) : (
          <p className="text-base text-grey-500">None - bills print the hotel's name.</p>
        )}
        {mayEdit && (
          <div className="flex gap-2">
            <input
              ref={picker}
              type="file"
              accept="image/png,image/svg+xml"
              aria-label="Choose the logo file"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void upload(file);
              }}
            />
            <Button variant="secondary" loading={busy} onClick={() => picker.current?.click()}>
              {src ? "Replace" : "Upload"}
            </Button>
            {src && (
              <Button variant="ghost" disabled={busy} onClick={() => void remove()}>Remove</Button>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
