import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardBody, CardHeader, Field, fieldProps, Input, Skeleton, toast } from "@/components/ui";
import { can } from "@/lib/permissions";
import { useRole } from "@/lib/session";
import {
  getGroupSettings, setGroupName, setGroupLogo, removeGroupLogo, logoSrc, GROUP_SETTINGS_KEY,
} from "@/modules/admin/data/groupSettings";

/* The group's name and logo on Settings (the owner's D27-53 and D27-65): one
   setting for every hotel, printed on every bill as "by <group name>" under
   the property's name, with the logo. Changed by the owner, an administrator
   or the GM (the owner, 27 September) - the role gate's room-setup grant,
   which the server asks too. The logo is shown only as an <img>
   (data/groupSettings.ts says why). */
export function GroupCard({ hotelCode }: { hotelCode: string }) {
  const queryClient = useQueryClient();
  const mayEdit = can(useRole(), "edit", "room_config");
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState<string | null>(null);
  const group = useQuery({
    queryKey: GROUP_SETTINGS_KEY,
    queryFn: () => getGroupSettings(hotelCode),
    enabled: Boolean(hotelCode),
  });
  const name = group.data?.name ?? null;
  const src = logoSrc(group.data?.logo ?? null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: GROUP_SETTINGS_KEY });

  const saveName = async () => {
    const res = await setGroupName(hotelCode, typed ?? "");
    if (!res.ok) return toast.error("Not saved", res.reason);
    toast.success("Group name saved", res.name
      ? `Bills print "by ${res.name}" from now on.` : "Bills print the hotel's name alone.");
    setTyped(null);
    refresh();
  };

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
    refresh();
  };

  const remove = async () => {
    setBusy(true);
    const res = await removeGroupLogo(hotelCode);
    setBusy(false);
    if (!res.ok) return toast.error("Not removed", res.reason);
    toast.success("Logo removed", "Bills print no logo.");
    refresh();
  };

  return (
    <Card>
      <CardHeader
        title="Group name and logo"
        description={"One for every hotel, printed on every bill: the hotel's name, then \"by\" the group's."}
      />
      <CardBody className="pt-0 space-y-5">
        {group.isLoading ? (
          <Skeleton className="h-28 w-full" />
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-4">
              {typed === null ? (
                <>
                  <div>
                    <p className="text-sm text-grey-500">Group name</p>
                    <p className={name ? "text-lg font-semibold text-ink-900" : "text-lg text-grey-500"}>
                      {name ?? "-"}
                    </p>
                  </div>
                  {mayEdit && (
                    <Button variant="secondary" onClick={() => setTyped(name ?? "")}>Change</Button>
                  )}
                </>
              ) : (
                <>
                  <Field label="Group name" hint={"As it prints after \"by\". Blank for none."}>
                    {(f) => (
                      <Input {...fieldProps(f)} value={typed} autoFocus maxLength={80}
                        onChange={(e) => setTyped(e.target.value)} />
                    )}
                  </Field>
                  <Button variant="primary" onClick={() => void saveName()}>Save</Button>
                  <Button variant="ghost" onClick={() => setTyped(null)}>Cancel</Button>
                </>
              )}
            </div>

            <div>
              <p className="text-sm text-grey-500 mb-2">Logo - a PNG or an SVG, 200 KB at most</p>
              <div className="flex flex-wrap items-center gap-4">
                {src ? (
                  <img src={src} alt="The group's logo" className="h-16 w-auto max-w-full object-contain" />
                ) : (
                  <p className="text-base text-grey-500">None</p>
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
              </div>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
