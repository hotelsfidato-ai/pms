import { Field, Input, NativeSelect, Switch, Term, fieldProps } from "@/components/ui";
import { useCurrentHotel } from "@/lib/session";
import {
  ForeignGuestFields, formIIIMissing, idExpired, idProblem, particularsPayload,
  ID_TYPES, NO_PARTICULARS, type Particulars,
} from "./ForeignGuestFields";

/* ══════════════════════════════════════════════════════════════════
   THE GUEST'S ID, ASKED ONCE (D27-158, D27-163)

   The nationality, the document, or a reason for skipping it, and Form
   III's boxes for a foreign guest - with round D's checks (an Aadhaar's
   check digit, impossible dates, an expired passport or visa warned of).
   The check-in and the walk-in each held their own copy of these boxes;
   the one page and the one-page check-in now share this one, so they
   cannot ask different questions. The server refuses independently
   (api/src/modules/guests/formIII.ts, front desk's check-in).
   ══════════════════════════════════════════════════════════════════ */

export interface GuestId {
  nationality: string;
  idType: string;
  idNumber: string;
  idSkipReason: string;
  particulars: Particulars;
  /** An expired passport or visa, and the desk said "check in anyway" (GU-2). */
  expiredOk: boolean;
}

export const noGuestId = (nationality = "IN"): GuestId => ({
  nationality, idType: "", idNumber: "", idSkipReason: "",
  particulars: NO_PARTICULARS, expiredOk: false,
});

/** The desk's empty ID started on the hotel's defaults (the owner's D27-243
    3.6): its nationality, and its ID type for a guest of that nationality -
    never an Aadhaar for a guest from abroad. */
export const deskGuestId = (
  rules?: { defaultNationality: string; defaultIdType: string | null } | null,
  nationality?: string | null,
): GuestId => {
  const home = rules?.defaultNationality ?? "IN";
  const n = nationality ?? home;
  return { ...noGuestId(n), idType: n === home ? rules?.defaultIdType ?? "" : "" };
};

/** What the boxes say, and the one reason a check-in cannot go yet
    (null when it can). `today` is the hotel's business date. */
export function guestIdState(id: GuestId, today: string) {
  const captured = Boolean(id.idType && id.idNumber.trim());
  const foreign = (id.nationality.trim().toUpperCase() || "IN") !== "IN";
  const wrong = idProblem(id.particulars, id.idType, id.idNumber, id.nationality, today);
  const formIII = foreign ? formIIIMissing(id.particulars, id.nationality, captured) : [];
  const expired = foreign ? idExpired(id.particulars, today) : [];
  const blocked =
    !captured && !id.idSkipReason.trim()
      ? "Record the ID document - type and number - or give a reason for skipping it."
      : wrong
        ?? (formIII.length > 0 ? `Form III still needs: ${formIII.join(", ")}.` : null)
        ?? (expired.length > 0 && !id.expiredOk
          ? "The document has expired: say whether to check in anyway." : null);
  return { captured, foreign, wrong, formIII, expired, blocked };
}

/** The check-in call's three fields, as the check-in has always sent them:
    the nationality always (a foreign guest with the ID skipped still
    reaches the register), the document only when it was captured. */
export function guestIdPayload(id: GuestId) {
  const { captured, foreign } = guestIdState(id, "");
  const p = particularsPayload(id.particulars);
  return {
    identity: {
      nationality: id.nationality,
      ...(captured ? { idType: id.idType, idNumber: id.idNumber.trim(), ...p.identity } : {}),
    },
    ...(foreign ? { visit: p.visit } : {}),
    idSkipReason: id.idSkipReason,
  };
}

export function GuestIdFields({ value, onChange, today, withDocument = true, companion = false }: {
  value: GuestId;
  onChange: (next: GuestId) => void;
  today: string;
  /** False for a booking that does not arrive today: its document is taken
      at check-in, so only the nationality is asked (and kept). */
  withDocument?: boolean;
  /** Another adult in the room (D27-382): nothing here holds up the check-in,
      so no reason for a missing ID is asked and an expired one is only said. */
  companion?: boolean;
}) {
  const idsOff = useCurrentHotel()?.deskRules?.idTypesOff ?? [];

  const set = (patch: Partial<GuestId>) => onChange({ ...value, ...patch });
  const s = guestIdState(value, today);

  return (
    <div className="space-y-4">
      <Field label="Nationality"
        hint={<>Two letters, IN for India. Anything else puts the stay on the <Term name="formC">Form III</Term> register.</>}>
        {(f) => (
          <Input {...fieldProps(f)} value={value.nationality} maxLength={2} placeholder="IN"
            onChange={(e) => set({ nationality: e.target.value.toUpperCase() })}
            className="w-24 uppercase" />
        )}
      </Field>

      {!withDocument ? (
        s.foreign && (
          <p className="text-sm text-warning-dark">
            A foreign guest: their <Term name="formC">Form III</Term> is due at check-in.
          </p>
        )
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Document">
              {(f) => (
                <NativeSelect {...fieldProps(f)} value={value.idType}
                  onChange={(e) => set({ idType: e.target.value })}>
                  <option value="">Not recorded</option>
                  {/* The IDs this hotel does not take are left out (192, D27-260);
                      one already chosen stays, so nothing is silently changed. */}
                  {ID_TYPES.filter(([v]) => v === value.idType || !idsOff.includes(v))
                    .map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </NativeSelect>
              )}
            </Field>
            <Field label="Number" required={Boolean(value.idType)}>
              {(f) => (
                <Input {...fieldProps(f)} value={value.idNumber} disabled={!value.idType}
                  placeholder={value.idType === "passport" ? "P1234567" : "Document number"}
                  onChange={(e) => set({ idNumber: e.target.value })} />
              )}
            </Field>
          </div>
          {!s.captured && !companion && (
            <Field label="Reason for skipping" required>
              {(f) => (
                <Input {...fieldProps(f)} value={value.idSkipReason}
                  placeholder="Scanner offline - to be captured at breakfast"
                  onChange={(e) => set({ idSkipReason: e.target.value })} />
              )}
            </Field>
          )}
          {/* Only for a foreign national: asking an Indian guest for a visa
              number teaches people to leave fields blank. */}
          {s.foreign && (
            <ForeignGuestFields value={value.particulars}
              onChange={(particulars) => set({ particulars })}
              nationality={value.nationality} idCaptured={s.captured} nothingRequired={companion} />
          )}
          {s.formIII.length > 0 && (
            <p className="text-sm text-grey-600" data-form-iii-needs>
              Form III still needs: {s.formIII.join(", ")}.
            </p>
          )}
          {s.wrong && <p className="text-sm text-brand-red-700" data-id-wrong>{s.wrong}</p>}
          {s.expired.length > 0 && (companion ? (
            <p className="text-sm text-warning-dark">{s.expired.join(" ")} It is recorded as typed.</p>
          ) : (
            <Switch checked={value.expiredOk} onCheckedChange={(expiredOk) => set({ expiredOk })}
              label="Check in anyway"
              description={`${s.expired.join(" ")} It is recorded as typed.`} />
          ))}
        </>
      )}
    </div>
  );
}
