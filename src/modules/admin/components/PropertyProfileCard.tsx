import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/lib/session";
import { Card, CardBody, CardHeader, Button, Skeleton } from "@/components/ui";
import { getPropertyDetail, PROPERTY_TYPES } from "@/modules/admin/data/admin";
import { SettingRow, SettingValues } from "@/modules/admin/pages/Admin";
import { EditPropertyDialog } from "@/modules/admin/pages/Properties";
import { FssaiCard } from "@/modules/admin/pages/Property";

/* ══════════════════════════════════════════════════════════════════
   THE HOTEL'S PROFILE (D27-214), and its FSSAI number beside it: what
   Settings › Property showed, as one component, so the console's
   Property › Profile page - phase 1's stand-in, then phase 2's own (D27-254)
   - draws the same thing. Grouped the way the edit form asks: who, where,
   how to reach, the tax numbers. A long value takes two cells.
   ══════════════════════════════════════════════════════════════════ */

export function PropertyProfileCard({ hotelId }: { hotelId: string }) {
  const qc = useQueryClient();
  const groupAdmin = useSession((s) => s.scope?.isGroupAdmin === true);
  const [editing, setEditing] = useState(false);
  const q = useQuery({
    queryKey: ["property-detail", hotelId],
    queryFn: () => getPropertyDetail(hotelId),
    enabled: Boolean(hotelId),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["property-detail", hotelId] });
    void qc.invalidateQueries({ queryKey: ["commissioning", hotelId] });
  };

  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  const p = q.data?.property;
  if (!p) return null;
  const type = PROPERTY_TYPES.find(([word]) => word === p.propertyType)?.[1];

  return (
    <>
      <Card>
        <CardHeader title="Profile" description="The name, address, GSTIN, phone and email print on this property's invoices."
          actions={<Button variant="secondary" onClick={() => setEditing(true)}>Edit</Button>} />
        <CardBody>
          <SettingValues>
            <SettingRow wide label="Name" value={p.name} />
            <SettingRow label="Property type" value={type ?? "-"} />
            <SettingRow label="Stars" value={p.starRating?.toString() ?? "-"} />
            <SettingRow wide label="Address" value={p.addressLine ?? "-"} />
            <SettingRow wide label="Address line 2" value={p.addressLine2 ?? "-"} />
            <SettingRow label="City" value={p.city ?? "-"} />
            <SettingRow label="State" value={p.state ?? "-"} />
            <SettingRow label="PIN code" value={p.pin ?? "-"} />
            <SettingRow label="Map point"
              value={p.latitude && p.longitude ? `${p.latitude}, ${p.longitude}` : "-"} />
            <SettingRow label="Phone" value={p.phone ?? "-"} />
            <SettingRow label="Reservations phone" value={p.reservationsPhone ?? "-"} />
            <SettingRow wide label="Reservations contact" value={p.reservationsContact ?? "-"} />
            <SettingRow wide label="Email" value={p.email ?? "-"} />
            <SettingRow wide label="Website" value={p.website ?? "-"} />
            <SettingRow label="GSTIN" value={p.gstin ?? "-"} />
            <SettingRow label="PAN" value={p.pan ?? "-"} />
          </SettingValues>
        </CardBody>
      </Card>
      <FssaiCard code={p.code} value={p.fssaiNumber} onSaved={refresh} />
      {editing && (
        <EditPropertyDialog hotel={p} nameLocked={!groupAdmin}
          onClose={() => setEditing(false)} onSaved={refresh} />
      )}
    </>
  );
}
