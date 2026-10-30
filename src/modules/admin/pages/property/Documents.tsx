import { useEffect, useState, type ReactNode } from "react";
import { createPortal, flushSync } from "react-dom";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Printer } from "lucide-react";
import { Button, Card, CardBody, Page, PageHeader, Skeleton, Tabs, TabsList, TabsTrigger, toast } from "@/components/ui";
import { TestDocumentMark } from "@/components/app/TestHotel";
import { apiBase, authHeaders } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useUi } from "@/lib/ui";
import { getPropertyDetail } from "@/modules/admin/data/admin";
import { useGroupSettings } from "@/modules/admin/data/groupSettings";
import { SettingHeader } from "@/modules/admin/pages/Admin";
import { InvoiceSheet, proformaOf, useInvoiceCopies, type InvoiceDetail, type StayBill } from "@/modules/finance";
import { RegistrationCardSheet, type RegistrationCard } from "@/modules/front-desk";
import { BillSlip, type Order } from "@/modules/pos";

/* ══════════════════════════════════════════════════════════════════
   DOCUMENTS (the owner's D27-344, D27-348; 19 October)

   What the hotel prints and sends, one tab each: when it is printed and
   where that is set, and a sample - the real document, drawn by its own
   component with this hotel's header and a made-up guest, marked SAMPLE ·
   NOT VALID and with no GSTIN. "Print a sample" opens the print window:
   pick the printer to test it, or Save as PDF. The voucher is the server's
   own PDF (a sample made there). Nothing here is saved or sent.

   The figures are a sample's, not prices: nothing reads them.
   ══════════════════════════════════════════════════════════════════ */

const SAMPLE = "SAMPLE · NOT VALID";
const GUEST = "A. Sample Guest";

type Doc = "invoice" | "proforma" | "card" | "voucher" | "restaurant";
const DOCS: Array<[Doc, string]> = [
  ["invoice", "Tax invoice"], ["proforma", "Proforma bill"], ["card", "Registration card"],
  ["voucher", "Booking voucher"], ["restaurant", "Restaurant bill"],
];

const AT_CHECKOUT: Record<string, string> = {
  print: "Issued and printed by itself when the guest checks out.",
  offer: "Offered on the bill after check-out: Issue tax invoice.",
  invoices: "Issued on Invoices; nothing happens at check-out.",
};

/** This financial year, "2026-27": April to March. */
const finYear = () => {
  const d = new Date();
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
};

const day = (offset: number) => {
  const d = new Date(Date.now() + offset * 86_400_000);
  return { iso: d.toISOString().slice(0, 10), words: d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) };
};

/* Only the sample reaches the paper, as the invoice printer does
   (finance/pages/Invoice.tsx). */
const PRINT_CSS = `
  @media screen { .invoice-print { display: none; } }
  @media print { body > *:not(.invoice-print) { display: none !important; } }`;

function usePrinter() {
  const [node, setNode] = useState<ReactNode>(null);
  const print = (what: ReactNode) => {
    flushSync(() => setNode(what));
    try { window.print(); } finally { setNode(null); }
  };
  return { print, portal: node && createPortal(<div className="invoice-print"><style>{PRINT_CSS}</style>{node}</div>, document.body) };
}

export default function Documents() {
  const code = useUi((s) => s.hotelId);
  const detail = useQuery({ queryKey: ["property-detail", code], queryFn: () => getPropertyDetail(code), enabled: Boolean(code) });
  const rules = useSession((s) => s.hotels.find((h) => h.code === code || h.id === code))?.deskRules;
  const group = useGroupSettings(code);
  const copies = useInvoiceCopies(code);
  const [doc, setDoc] = useState<Doc>("invoice");
  const printer = usePrinter();
  const p = detail.data?.property;

  if (!p) {
    return (
      <Page>
        <PageHeader title="Documents" />
        <Skeleton className="h-96 w-full" />
      </Page>
    );
  }

  const [arrive, leave] = [day(-2), day(0)];
  const hotel = { name: p.name, address: p.addressLine, city: p.city, state: p.state, phone: p.phone, gstin: null };
  const stay = {
    reference: "SAMPLE", grCardNo: 1, guest: GUEST, roomType: p.roomTypes[0] ?? "Room", room: "101",
    adults: 2, children: 0, plan: "CP", nights: 2,
    arrival: `${arrive.words}, 14:05`, departure: `${leave.words}, 10:30`, source: "Walk-in",
    checkedInBy: "Reception", checkedOutBy: "Reception",
  };
  const night = (n: number) => ({ description: `Room 101 · 1 night`, category: "room", amount: 3000, taxRate: 5,
    taxAmount: 150, date: day(n - 2).iso, sac: "996311" });

  const invoice: InvoiceDetail = {
    number: "SAMPLE", finYear: finYear(), issuedAt: `${leave.words}, 10:32`, issuedBy: "Reception", businessDate: leave.iso,
    supplier: { ...hotel, fssai: null, email: p.email, website: p.website, pan: p.pan },
    recipient: { name: GUEST, gstin: null, address: null },
    placeOfSupply: p.state, sacCode: "996311",
    lines: [night(0), night(1)],
    taxableValue: 6000, cgst: { rate: 2.5, amount: 150 }, sgst: { rate: 2.5, amount: 150 }, taxTotal: 300, total: 6300,
    creditsInvoiceId: null, creditsNumber: null, reason: null, creditedBy: null, vatBill: null,
    stay, payments: [{ date: leave.iso, description: "Received - UPI", amount: 6300 }],
  };
  const bill: StayBill = {
    hotel: { ...hotel, email: p.email, website: p.website, pan: p.pan },
    stay: { reference: "SAMPLE", guest: GUEST, checkIn: arrive.iso, checkOut: day(1).iso, room: "101" },
    lines: [{ date: arrive.iso, description: "Room 101 · 1 night", category: "room", amount: 3000, tax: 150, rate: 5,
              billTo: "guest", company: null, sac: "996311" }],
    taxes: [{ rate: 5, taxable: 3000, cgst: 75, sgst: 75 }], vat: [],
    net: 3000, tax: 150, total: 3150, rounded: 3150, roundOff: 0, paid: 1000, balance: 2150,
    tonight: { description: "Room 101 · 1 night", amount: 3000, tax: 150, rate: 5 },
    details: { ...stay, departure: day(1).words, checkedOutBy: null },
    payments: [{ date: arrive.iso, description: "Received - UPI", amount: 1000 }],
  };
  const card: RegistrationCard = {
    hotel: { name: p.name, address: p.addressLine, city: p.city, state: p.state, phone: p.phone, email: p.email,
             website: p.website, gstin: null },
    housePolicies: p.housePolicies ?? [], grCardNo: 1,
    stay: { reference: "SAMPLE", roomType: stay.roomType, room: "101", adults: 2, children: 0, plan: "CP", nights: 2,
            arrival: stay.arrival, departure: day(0).words },
    rate: "3000.00",
    guest: { title: "Mr", name: GUEST, email: "guest@example.com", phone: "+91 90000 00000", nationality: "IN",
             address: { line: "1 Sample Road", city: "Pune", state: "Maharashtra", pincode: "411001", country: "IN" },
             idType: "aadhaar", idNumber: "XXXX XXXX 0000" },
    companions: [], company: null, agent: null, arrivedFrom: null, nextDestination: null,
  };
  const order: Order = {
    id: "sample", orderNo: "SAMPLE", outlet: "REST", outletName: "Restaurant",
    hotelName: p.name, hotelCity: p.city, hotelGstin: null, hotelFssai: p.fssaiNumber, hotelSac: "996331",
    table: "T1", status: "open", businessDate: leave.iso, paymentMethod: null,
    openedBy: "Steward", settledBy: null, settledAt: null, abandonedReason: null, ticketId: null,
    eventId: null, eventTitle: null,
    lines: [
      { id: "1", name: "Paneer Tikka", qty: 1, unitPrice: 320, taxRate: 5, note: null, voided: false, kotStatus: "sent",
        addedBy: null, parentLineId: null, isAddon: false, variationId: null },
      { id: "2", name: "Butter Naan", qty: 2, unitPrice: 60, taxRate: 5, note: null, voided: false, kotStatus: "sent",
        addedBy: null, parentLineId: null, isAddon: false, variationId: null },
    ],
    net: 440, discount: 0, discountType: null, discountValue: null, discountReason: null,
    promotionId: null, promotionName: null, taxable: 440, tax: 22, taxes: [{ scheme: "gst", rate: 5, tax: 22 }],
    gross: 462, roundOff: 0, payable: 462, tenders: [], covers: 2, waiter: "Steward", orderType: "dine_in",
    customerName: null, customerPhone: null, customerAddress: null, customerLocality: null, heldAt: null,
  };

  const { sample, when, where } = {
    invoice: {
      sample: <>{copies.map((copy, i) => (
        <div key={copy} className={i === 0 ? undefined : "break-before-page"}>
          <TestDocumentMark label={SAMPLE} />
          <InvoiceSheet data={invoice} hotelId={code} test group={group} copy={copy} />
        </div>
      ))}</>,
      when: `${AT_CHECKOUT[rules?.invoiceAtCheckout ?? "print"]} ${copies.length === 2
        ? "Two copies: ORIGINAL FOR RECIPIENT and DUPLICATE FOR SUPPLIER." : "One copy."}`,
      where: { to: "/settings/front-desk/front-desk", label: "Front desk rules" },
    },
    proforma: {
      sample: <><TestDocumentMark label={SAMPLE} />
        <InvoiceSheet {...proformaOf(bill)} hotelId={code} test group={group} /></>,
      when: "From the Bill tab's Proforma bill, at any time before the tax invoice. Never by itself.",
      where: null,
    },
    card: {
      sample: <RegistrationCardSheet card={card} test hotelCode={code} label={SAMPLE} />,
      when: "From Print registration card on the guest's panel, once checked in. Never by itself. The house policies print above the signature.",
      where: { to: "/settings/property/policies", label: "Policies" },
    },
    voucher: {
      sample: <VoucherSample code={code} />,
      when: "Sent with the booking's confirmation, by e-mail or WhatsApp, and opened by View voucher.",
      where: { to: `/h/${encodeURIComponent(code)}/guest-messages`, label: "Guest messages" },
    },
    restaurant: {
      sample: <BillSlip order={order} heading="interim" sample={SAMPLE} />,
      when: "From the till's Print bill, or by the bill printer at the printing station.",
      where: null,
    },
  }[doc];

  const printSample = () => {
    if (doc === "voucher") { void openVoucher(code); return; }
    printer.print(sample);
  };

  return (
    <Page>
      <PageHeader title="Documents"
        description="What the hotel prints and sends, as the guest gets it. Each sample has a made-up guest and says SAMPLE · NOT VALID." />
      <div className="flex flex-col gap-3">
        <Tabs value={doc} onValueChange={(v) => setDoc(v as Doc)}>
          <TabsList>
            {DOCS.map(([k, label]) => <TabsTrigger key={k} value={k}>{label}</TabsTrigger>)}
          </TabsList>
        </Tabs>
        <Card>
          <SettingHeader title={DOCS.find(([k]) => k === doc)![1]} line={when} />
          <CardBody className="flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={printSample} data-documents-print>
              <Printer className="size-4" /> Print a sample
            </Button>
            <span className="text-sm text-grey-600">Pick the printer to test it, or Save as PDF.</span>
            {where && (
              <Link to={where.to} className="ml-auto inline-flex items-center gap-1 text-sm font-medium text-brand-orange-700 hover:underline">
                Change it on {where.label} <ExternalLink className="size-3.5" />
              </Link>
            )}
          </CardBody>
        </Card>
        <div className="overflow-x-auto rounded-md border border-grey-200 bg-grey-100 p-4" data-documents-sample={doc}>
          <div className={doc === "restaurant" ? "mx-auto w-fit bg-white" : "mx-auto max-w-[210mm] bg-white p-6 sm:p-[12mm]"}>
            {sample}
          </div>
        </div>
      </div>
      {printer.portal}
    </Page>
  );
}

/* The voucher is the server's PDF: a sample made there (D27-348). */
async function voucherBlob(code: string): Promise<string> {
  const headers = new Headers(await authHeaders());
  headers.delete("content-type");
  const res = await fetch(`${await apiBase()}/api/hotels/${encodeURIComponent(code)}/documents/sample-voucher.pdf`, { headers });
  if (!res.ok) throw new Error("The sample voucher could not be made.");
  return URL.createObjectURL(await res.blob());
}

/** Opened in a new tab to print; the tab first, inside the press (MEMORY 290). */
async function openVoucher(code: string) {
  const tab = window.open("", "_blank");
  try {
    const url = await voucherBlob(code);
    if (tab) tab.location.href = url; else window.location.href = url;
  } catch (e) {
    tab?.close();
    toast.error("Not opened", (e as Error).message);
  }
}

function VoucherSample({ code }: { code: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let made: string | null = null;
    voucherBlob(code).then((u) => { made = u; setUrl(u); }).catch(() => setFailed(true));
    return () => { if (made) URL.revokeObjectURL(made); };
  }, [code]);
  if (failed) return <p className="text-sm text-brand-red-700">The sample voucher could not be made. Try again.</p>;
  if (!url) return <Skeleton className="h-[60vh] w-full" />;
  return <iframe title="Sample voucher" src={url} className="h-[80vh] w-full" data-documents-voucher />;
}
