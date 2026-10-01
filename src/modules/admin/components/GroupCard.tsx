import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button, Card, CardBody, Dialog, DialogContent, Field, fieldProps, Input, Skeleton, toast,
} from "@/components/ui";
import { can } from "@/lib/permissions";
import { useRole } from "@/lib/session";
import {
  getGroupSettings, setGroupName, setGroupLogo, removeGroupLogo, setHotelLogo, removeHotelLogo, setGroupOffice,
  logoSrc, GROUP_SETTINGS_KEY, groupSettingsKey, type GroupOffice,
} from "@/modules/admin/data/groupSettings";
import { SettingHeader, SettingRow, SettingValues } from "@/modules/admin/pages/Admin";

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
      <SettingHeader
        title="Group name and logo"
        line={"One for every hotel, printed on every bill: the hotel's name, then \"by\" the group's."}
      />
      <CardBody className="space-y-5">
        {group.isLoading ? (
          <Skeleton className="h-28 w-full" />
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-4">
              {typed === null ? (
                <>
                  <dl><SettingRow label="Group name" value={name ?? "-"} /></dl>
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
            <OfficeDetails hotelCode={hotelCode} office={group.data?.office} mayEdit={mayEdit} onSaved={refresh} />
          </>
        )}
      </CardBody>
    </Card>
  );
}

/* The group's office details (the owner's D27-215): the footer of every
   booking voucher - name, address, phone, email, website, GSTIN - and the
   Instagram address printed under its policies. Typed once, for every hotel.
   Until one of the footer's five is typed, a voucher's footer is the hotel's
   own, as before. */
const OFFICE: [keyof GroupOffice, string, string?][] = [
  ["address", "Office address"], ["phone", "Phone"], ["email", "Email"], ["website", "Website"],
  ["gstin", "GSTIN"], ["instagram", "Instagram", "As it should print, such as @fidatohotels."],
];

/* Shown in this order, so the long three take two cells each without a hole. */
const SHOWN: (keyof GroupOffice)[] = ["address", "phone", "gstin", "email", "website", "instagram"];
const WIDE: (keyof GroupOffice)[] = ["address", "email", "website"];

function OfficeDetails({ hotelCode, office, mayEdit, onSaved }: {
  hotelCode: string; office: GroupOffice | undefined; mayEdit: boolean; onSaved: () => void;
}) {
  const [form, setForm] = useState<Record<keyof GroupOffice, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const open = () => setForm(Object.fromEntries(
    OFFICE.map(([key]) => [key, office?.[key] ?? ""])) as Record<keyof GroupOffice, string>);

  const save = async () => {
    setBusy(true);
    const res = await setGroupOffice(hotelCode, form!);
    setBusy(false);
    if (!res.ok) return toast.error("Not saved", res.reason);
    toast.success("Office details saved", "They print in the footer of every booking voucher from now on.");
    setForm(null);
    onSaved();
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
        <div>
          <p className="text-sm font-medium text-ink-900">Office details</p>
          <p className="text-xs font-medium text-grey-500 mt-0.5">
            The footer of every booking voucher. Until one is typed, a voucher's footer is the hotel's own.
          </p>
        </div>
        {mayEdit && <Button variant="secondary" onClick={open}>Change office details</Button>}
      </div>
      <SettingValues>
        {SHOWN.map((key) => (
          <SettingRow key={key} wide={WIDE.includes(key)}
            label={OFFICE.find(([k]) => k === key)![1]} value={office?.[key] ?? "-"} />
        ))}
      </SettingValues>
      {form && (
        <Dialog open onOpenChange={(o) => !o && setForm(null)}>
          <DialogContent
            title="The group's office details"
            description="Printed in the footer of every hotel's booking voucher. Leave one blank and it is left out."
            footer={
              <>
                <Button variant="secondary" size="lg" onClick={() => setForm(null)}>Cancel</Button>
                <Button variant="primary" size="lg" loading={busy} onClick={() => void save()}>Save</Button>
              </>
            }
          >
            <div className="space-y-3">
              {OFFICE.map(([key, label, hint], i) => (
                <Field key={key} label={label} {...(hint ? { hint } : {})}>
                  {(f) => (
                    <Input {...fieldProps(f)} value={form[key]} autoFocus={i === 0}
                      onChange={(e) => setForm({ ...form,
                        [key]: key === "gstin" ? e.target.value.toUpperCase() : e.target.value })} />
                  )}
                </Field>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
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
      <p className="text-xs font-medium text-grey-500 mb-2">Logo - a PNG or an SVG, 200 KB at most</p>
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
      <SettingHeader
        title="This hotel's logo"
        line="On this hotel's bills and documents in place of the group's logo."
        info={"With none, the group's prints. "
          + "The voucher PDF prints a PNG logo; an SVG logo shows on the bills and the group's logo on the voucher."}
      />
      <CardBody>
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
