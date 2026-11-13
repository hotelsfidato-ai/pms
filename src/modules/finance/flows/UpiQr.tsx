import { useEffect, useState } from "react";
import { moneyPrecise } from "@/lib/format";

/* ══════════════════════════════════════════════════════════════════
   THE UPI QR CODE ON AN UNPAID BILL (D27-396 wave 4, "build all")

   The guest scans it with any UPI app and pays the amount due to the
   hotel's own UPI ID (Settings › Taxes and billing, bank details). Nothing
   is charged, sent or recorded by the system: the desk records the payment
   when it arrives, as any other UPI payment. The UPI ID and payee come from
   the server (`app.hotel_upi`, migration 275); null there, no QR.

   THE LINK is NPCI's UPI deep link ("UPI Linking Specification", the
   `upi://pay` URI that BHIM and every UPI app read from a QR):
     upi://pay?pa=<UPI ID>&pn=<payee name>&am=<amount>&cu=INR&tn=<note>
   each value URL-encoded, the amount with two decimals.

   `qrcode` only by import() (D21-95: the guest's page is in the same
   bundle). Once loaded it draws synchronously, so a print that renders and
   prints in one go (the invoice printer, the bill printer) calls
   `loadUpiQr()` first.
   ══════════════════════════════════════════════════════════════════ */

export interface Upi { id: string; payee: string }

/** The NPCI UPI deep link for this payment. */
export function upiLink(upi: Upi, amount: number, note: string): string {
  const v = (k: string, s: string) => `${k}=${encodeURIComponent(s)}`;
  return `upi://pay?${v("pa", upi.id)}&${v("pn", upi.payee)}&am=${amount.toFixed(2)}&cu=INR&${v("tn", note)}`;
}

let lib: typeof import("qrcode") | null = null;
export const loadUpiQr = () => import("qrcode").then((m) => { lib = m; });

/** Nothing at all with no UPI ID, nothing due, or before `qrcode` arrives
    on a screen (it draws a moment later). */
export function UpiQr({ upi, amount, note }: { upi?: Upi | null; amount: number; note: string }) {
  const [, setReady] = useState(lib !== null);
  useEffect(() => {
    if (upi && !lib) void loadUpiQr().then(() => setReady(true));
  }, [upi]);
  if (!upi || !(amount > 0) || !lib) return null;

  const code = lib.create(upiLink(upi, amount, note), { errorCorrectionLevel: "M" });
  const n = code.modules.size;
  let d = "";
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (code.modules.get(x, y)) d += `M${x} ${y}h1v1h-1z`;

  return (
    <div className="mt-3 flex items-center gap-3 break-inside-avoid text-xs text-ink-700" data-upi-qr>
      {/* Black on white with a quiet zone of two modules, for any printer. */}
      <svg viewBox={`-2 -2 ${n + 4} ${n + 4}`} className="size-[26mm] shrink-0 bg-white" shapeRendering="crispEdges"
           role="img" aria-label="UPI QR code">
        <path d={d} fill="#000" />
      </svg>
      <div className="min-w-0">
        <p className="font-semibold">Scan with any UPI app to pay {moneyPrecise(amount)}</p>
        <p className="mt-0.5 break-all">to <span className="tabular">{upi.id}</span> ({upi.payee}).</p>
        <p className="mt-0.5">We record the payment when it reaches us.</p>
      </div>
    </div>
  );
}
