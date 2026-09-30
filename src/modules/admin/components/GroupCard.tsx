import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardBody, CardHeader, Field, fieldProps, Input, Skeleton, toast } from "@/components/ui";
import { can } from "@/lib/permissions";
import { useRole } from "@/lib/session";
import {
  getGroupSettings, setGroupName, setGroupLogo, removeGroupLogo, setHotelLogo, removeHotelLogo,
  logoSrc, GROUP_SETTINGS_KEY, groupSettingsKey,
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
  const [typed, setTyped] = useState<string | null>(null);
  const group = useQuery({
    queryKey: groupSettingsKey(hotelCode),
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

  const upload = async (data: string) => {
    const res = await setGroupLogo(hotelCode, data);
    if (!res.ok) return void toast.error("Not saved", res.reason);
    toast.success("Logo saved", "It prints on every bill at every hotel that has no logo of its own.");
    refresh();
  };

  const remove = async () => {
    const res = await removeGroupLogo(hotelCode);
    if (!res.ok) return void toast.error("Not removed", res.reason);
    toast.success("Logo removed", "A hotel with a logo of its own still prints it.");
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

            <LogoRow src={src} alt="The group's logo" pickLabel="Choose the logo file"
              mayEdit={mayEdit} upload={upload} remove={remove} />
          </>
        )}
      </CardBody>
    </Card>
  );
}

/* A logo: the picture or "None", and Upload / Replace and Remove for whoever
   may. The file goes as it is; the server decides what it is. */
function LogoRow({ src, alt, pickLabel, mayEdit, upload, remove }: {
  src: string | null; alt: string; pickLabel: string; mayEdit: boolean;
  /** The file's bytes, base64. Says its own result. */
  upload: (data: string) => Promise<void>;
  remove: () => Promise<void>;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const during = async (work: Promise<void>) => { setBusy(true); await work; setBusy(false); };

  const pick = async (file: File) => {
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    await upload(url.slice(url.indexOf(",") + 1));
  };

  return (
    <div>
      <p className="text-sm text-grey-500 mb-2">Logo - a PNG or an SVG, 200 KB at most</p>
      <div className="flex flex-wrap items-center gap-4">
        {src ? (
          <img src={src} alt={alt} className="h-16 w-auto max-w-full object-contain" />
        ) : (
          <p className="text-base text-grey-500">None</p>
        )}
        {mayEdit && (
          <div className="flex gap-2">
            <input
              ref={picker}
              type="file"
              accept="image/png,image/svg+xml"
              aria-label={pickLabel}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void during(pick(file));
              }}
            />
            <Button variant="secondary" loading={busy} onClick={() => picker.current?.click()}>
              {src ? "Replace" : "Upload"}
            </Button>
            {src && (
              <Button variant="ghost" disabled={busy} onClick={() => void during(remove())}>Remove</Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* THIS hotel's own logo (the owner's D27-214): on its documents in place of
   the group's. None, and the group's prints. The same picture rules, and the
   same three people - at this hotel. */
export function HotelLogoCard({ hotelCode }: { hotelCode: string }) {
  const queryClient = useQueryClient();
  const mayEdit = can(useRole(), "edit", "room_config");
  const group = useQuery({
    queryKey: groupSettingsKey(hotelCode),
    queryFn: () => getGroupSettings(hotelCode),
    enabled: Boolean(hotelCode),
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: GROUP_SETTINGS_KEY });

  const upload = async (data: string) => {
    const res = await setHotelLogo(hotelCode, data);
    if (!res.ok) return void toast.error("Not saved", res.reason);
    toast.success("Logo saved", "This hotel's documents print it from now on.");
    refresh();
  };
  const remove = async () => {
    const res = await removeHotelLogo(hotelCode);
    if (!res.ok) return void toast.error("Not removed", res.reason);
    toast.success("Logo removed", "This hotel's documents print the group's logo.");
    refresh();
  };

  return (
    <Card>
      <CardHeader
        title="This hotel's logo"
        description={"On this hotel's bills and documents in place of the group's logo. With none, the group's prints. "
          + "The voucher PDF prints a PNG logo; an SVG logo shows on the bills and the group's logo on the voucher."}
      />
      <CardBody className="pt-0">
        {group.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <LogoRow src={logoSrc(group.data?.hotelLogo ?? null)} alt="This hotel's logo"
            pickLabel="Choose this hotel's logo file" mayEdit={mayEdit} upload={upload} remove={remove} />
        )}
      </CardBody>
    </Card>
  );
}
