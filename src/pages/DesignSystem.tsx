import { useState } from "react";
import { Plus, Download, Trash2, Search, Star } from "lucide-react";
import { cn } from "@/lib/cn";
import logoFull from "@/assets/brand/logo-full.svg";
/* `?inline` forces a data URI. Vite leaves SVG imported as a module
   URL on disk whatever assetsInlineLimit says, and in the
   single-file preview build a second file is a 404. */
import logoMark from "@/assets/brand/logo-mark.svg?inline";
import {
  Page, PageHeader, Card, CardHeader, CardBody, Section, Button, Input,
  Textarea, NativeSelect, Checkbox, Switch, Field, StatusPill, Skeleton,
  EmptyState, NoResultsState, ErrorState, Spinner, ProgressBar, Avatar, StarRating,
  Segmented, Tooltip, Stat, DetailList, DetailRow, Combobox, DatePicker, DateRangePicker,
  DataTable, Pagination, FilterBar, SearchInput, Tabs, TabsList, TabsTrigger, TabsContent,
  Dialog, DialogContent, DialogTrigger, DialogClose, Drawer, DrawerContent, DrawerTrigger,
  DrawerClose, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, Popover, PopoverTrigger, PopoverContent, PopoverClose, toast, type Column,
} from "@/components/ui";

/* ══════════════════════════════════════════════════════════════════
   LIVING STYLE GUIDE
   Every token and component rendered from the real implementation,
   so brand drift is visible on one screen rather than discovered
   halfway through a feature.
   ══════════════════════════════════════════════════════════════════ */

const BRAND_COLORS = [
  { name: "Fidato Black", token: "ink-900", hex: "#031728", use: "Headings, sidebar, primary text" },
  { name: "Orange", token: "brand-orange", hex: "#DF6128", use: "Primary action, active navigation" },
  { name: "Tangerine", token: "brand-tangerine", hex: "#EB8C00", use: "Secondary accent, chart series" },
  { name: "Yellow", token: "brand-yellow", hex: "#FFB600", use: "Pending, warning" },
  { name: "Rose", token: "brand-rose", hex: "#DB536A", use: "Attention, no-show" },
  { name: "Red", token: "brand-red", hex: "#E0301E", use: "Destructive, error, overdue" },
];

const GREYS = [
  { name: "Dark Grey", token: "grey-700", hex: "#354552" },
  { name: "Medium Grey", token: "grey-500", hex: "#67737E" },
  { name: "Grey", token: "grey-400", hex: "#9AA2A9" },
  { name: "Light Grey", token: "grey-300", hex: "#CCD0D4" },
];

const TYPE_SCALE = [
  { token: "text-2xl", size: "24px", use: "KPI figures", className: "text-2xl" },
  { token: "text-xl", size: "20px", use: "Page titles", className: "text-xl" },
  { token: "text-lg", size: "18px", use: "Section headings", className: "text-lg" },
  { token: "text-md", size: "15px", use: "Card titles", className: "text-md" },
  { token: "text-base", size: "14px", use: "Body, table cells", className: "text-base" },
  { token: "text-sm", size: "13px", use: "Secondary text, hints", className: "text-sm" },
  { token: "text-xs", size: "12px", use: "Captions, footnotes", className: "text-xs" },
  { token: "text-2xs", size: "11px", use: "Pills, labels, eyebrows", className: "text-2xs" },
];

interface DemoRow {
  id: string;
  reference: string;
  guest: string;
  property: string;
  roomType: string;
  status: "confirmed" | "pending" | "cancelled";
  amount: number;
}

const DEMO_ROWS: DemoRow[] = [
  { id: "1", reference: "FH-2607-4821", guest: "Ananya Bose", property: "5 Elements Akkalkot", roomType: "Superior", status: "confirmed", amount: 64800 },
  { id: "2", reference: "FH-2607-4822", guest: "Vikram Desai", property: "5 Elements Akkalkot", roomType: "Deluxe", status: "pending", amount: 128400 },
  { id: "3", reference: "FH-2607-4823", guest: "Priya Menon", property: "5 Elements Akkalkot", roomType: "Superior", status: "cancelled", amount: 41200 },
];

export default function DesignSystemPage() {
  const [checked, setChecked] = useState(true);
  const [switched, setSwitched] = useState(true);
  const [segment, setSegment] = useState("month");
  const [combo, setCombo] = useState("");
  const [range, setRange] = useState<{ from?: string; to?: string }>({});

  const demoColumns: Column<DemoRow>[] = [
    { key: "reference", header: "Reference", sortable: true, cell: (r) => <span className="tabular font-medium">{r.reference}</span> },
    { key: "guest", header: "Guest", cell: (r) => r.guest },
    { key: "property", header: "Property", hideBelow: "md", cell: (r) => r.property },
    { key: "roomType", header: "Room Type", cell: (r) => r.roomType },
    {
      key: "status", header: "Status",
      cell: (r) => (
        <StatusPill tone={r.status === "confirmed" ? "success" : r.status === "pending" ? "warning" : "danger"}>
          {r.status}
        </StatusPill>
      ),
    },
    {
      key: "amount", header: "Value", numeric: true, sortable: true,
      cell: (r) => <span className="font-medium">₹{r.amount.toLocaleString("en-IN")}</span>,
    },
  ];

  return (
    <Page>
      <PageHeader
        title="Design system"
        description="Every token and component the platform is built from, rendered live. If something here looks wrong, it is wrong everywhere."
        badge={<StatusPill tone="neutral" dot={false}>Internal</StatusPill>}
      />

      {/* ── Brand ── */}
      <Section title="Brand mark" description="Used unaltered, per the visual identity guide">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="p-8 flex items-center justify-center">
            <img src={logoFull} alt="Fidato Hotels" className="h-9" />
          </Card>
          <Card className="p-8 flex items-center justify-center gap-8">
            <img src={logoMark} alt="" className="h-10" />
            <div className="flex items-center justify-center size-11 rounded-md bg-ink-900">
              <img src={logoMark} alt="" className="h-6 brightness-0 invert" />
            </div>
          </Card>
        </div>
        <p className="text-sm text-grey-500 mt-3 leading-relaxed">
          The lockup is never distorted, recoloured or rebuilt. The mark alone is used in
          the collapsed rail, the favicon and the assistant avatar. Clear space of one
          &lsquo;O&rsquo; is preserved on all sides.
        </p>
      </Section>

      {/* ── Colour ── */}
      <Section
        title="Colour"
        description="Five warm brand colours and a grey ramp, from the visual identity guide (p.13)"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {BRAND_COLORS.map((color) => (
            <Card key={color.token} className="overflow-hidden">
              <div className="h-16" style={{ backgroundColor: color.hex }} />
              <div className="p-3.5">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-base font-medium text-ink-900">{color.name}</p>
                  <code className="text-2xs text-grey-500 tabular">{color.hex}</code>
                </div>
                <code className="text-2xs text-brand-orange-700">{color.token}</code>
                <p className="text-sm text-grey-500 mt-1.5 leading-relaxed">{color.use}</p>
              </div>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          {GREYS.map((grey) => (
            <Card key={grey.token} className="overflow-hidden">
              <div className="h-11" style={{ backgroundColor: grey.hex }} />
              <div className="p-3">
                <p className="text-sm text-ink-900">{grey.name}</p>
                <code className="text-2xs text-grey-500 tabular">{grey.hex}</code>
              </div>
            </Card>
          ))}
        </div>

        <Card className="mt-4 p-5">
          <div className="flex items-start gap-4 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <p className="text-2xs font-semibold uppercase tracking-wide text-grey-500 mb-2">
                Added for the product
              </p>
              <div className="flex items-center gap-3">
                <span className="size-10 rounded-md bg-success shrink-0" />
                <div>
                  <p className="text-base font-medium text-ink-900">Success</p>
                  <code className="text-2xs text-grey-500 tabular">#1F6F5C</code>
                </div>
              </div>
              <p className="text-sm text-grey-600 mt-2.5 leading-relaxed">
                The brand palette has no success colour, which an operational system
                cannot do without - confirmed, paid, reconciled and synced all need one.
                This muted teal-green was tuned to sit with the warm palette rather than
                fight it. Flagged for brand review.
              </p>
            </div>
            <div className="flex-1 min-w-[200px]">
              <p className="text-2xs font-semibold uppercase tracking-wide text-grey-500 mb-2">
                Logo gradient
              </p>
              <div className="h-10 rounded-md brand-gradient" />
              <p className="text-sm text-grey-600 mt-2.5 leading-relaxed">
                <code className="text-2xs">#FE611F → #F4BF54</code>, taken from the logo
                mark. Reserved for the brand mark, the collapsed rail and a single hero
                accent. Never on buttons.
              </p>
            </div>
          </div>
        </Card>
      </Section>

      {/* ── Typography ── */}
      <Section
        title="Typography"
        description="Inter Variable throughout, with tabular figures on every number"
      >
        <Card>
          <CardBody className="space-y-4">
            {TYPE_SCALE.map((entry) => (
              <div
                key={entry.token}
                className="flex items-baseline gap-5 pb-4 border-b border-grey-100 last:border-b-0 last:pb-0"
              >
                <div className="w-28 shrink-0">
                  <code className="text-2xs text-brand-orange-700">{entry.token}</code>
                  <p className="text-2xs text-grey-500 tabular">{entry.size}</p>
                </div>
                <p className={cn(entry.className, "text-ink-900 flex-1 min-w-0 truncate")}>
                  Fidato Hotels - 7 properties
                </p>
                <p className="text-sm text-grey-500 hidden lg:block w-40 shrink-0">
                  {entry.use}
                </p>
              </div>
            ))}
          </CardBody>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2 mt-4">
          <Card className="p-5">
            <p className="text-2xs font-semibold uppercase tracking-wide text-grey-500 mb-2">
              Tabular figures
            </p>
            <div className="space-y-1">
              <p className="text-base tabular text-ink-900">₹1,28,400.00</p>
              <p className="text-base tabular text-ink-900">₹64,800.00</p>
              <p className="text-base tabular text-ink-900">₹9,120.00</p>
            </div>
            <p className="text-sm text-grey-500 mt-3 leading-relaxed">
              Digits share a fixed width, so figures in a column line up regardless of
              value. Applied to all money, dates, counts and references.
            </p>
          </Card>

          <Card className="p-5">
            <p className="text-2xs font-semibold uppercase tracking-wide text-grey-500 mb-2">
              Brand serif - print only
            </p>
            <p className="print-serif text-xl text-ink-900">Tax Invoice</p>
            <p className="print-serif text-base text-grey-600 mt-1">Fidato Hotels</p>
            <p className="text-sm text-grey-500 mt-3 leading-relaxed">
              Georgia is retained for invoice and report covers - a deliberate, documented
              narrowing of the guide's Georgia + Arial pairing, which reads dated in a
              dense interface.
            </p>
          </Card>
        </div>
      </Section>

      {/* ── Buttons ── */}
      <Section title="Buttons">
        <Card>
          <CardBody className="space-y-5">
            <Row label="Variants">
              <Button variant="primary">Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="danger">Danger</Button>
            </Row>
            <Row label="Sizes">
              <Button variant="primary" size="sm">Small</Button>
              <Button variant="primary">Default</Button>
              <Button variant="primary" size="icon" aria-label="Add"><Plus className="size-4" /></Button>
            </Row>
            <Row label="With icons">
              <Button variant="primary" leadingIcon={<Plus className="size-4" />}>New reservation</Button>
              <Button variant="secondary" leadingIcon={<Download className="size-4" />}>Export</Button>
              <Button variant="danger" leadingIcon={<Trash2 className="size-4" />}>Cancel booking</Button>
            </Row>
            <Row label="States">
              <Button variant="primary" loading>Saving</Button>
              <Button variant="primary" disabled>Disabled</Button>
              <Button variant="secondary" disabled>Disabled</Button>
            </Row>
          </CardBody>
        </Card>
      </Section>

      {/* ── Status pills ── */}
      <Section title="Status" description="One vocabulary of tones across every module">
        <Card>
          <CardBody className="flex flex-wrap gap-2.5">
            <StatusPill tone="success">Confirmed</StatusPill>
            <StatusPill tone="warning">Pending approval</StatusPill>
            <StatusPill tone="danger">Cancelled</StatusPill>
            <StatusPill tone="info">Checked in</StatusPill>
            <StatusPill tone="accent">VIP</StatusPill>
            <StatusPill tone="neutral">Draft</StatusPill>
            <StatusPill tone="success" dot={false}>No dot</StatusPill>
            <StatusPill tone="accent" dot={false}>
              <Star className="size-2.5 fill-current" /> With icon
            </StatusPill>
          </CardBody>
        </Card>

        <Card className="mt-4">
          <CardHeader title="PMS tone sets" />
          <CardBody className="space-y-4">
            <div>
              <h4 className="text-sm font-semibold text-ink-900 mb-2">Room status</h4>
              <div className="flex flex-wrap gap-2">
                <StatusPill tone="success">Clean</StatusPill>
                <StatusPill tone="warning">Dirty</StatusPill>
                <StatusPill tone="success">Inspected</StatusPill>
                <StatusPill tone="danger">Out of order</StatusPill>
                <StatusPill tone="neutral">Out of service</StatusPill>
              </div>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-ink-900 mb-2">Stay status</h4>
              <div className="flex flex-wrap gap-2">
                <StatusPill tone="info">Due in</StatusPill>
                <StatusPill tone="success">In house</StatusPill>
                <StatusPill tone="warning">Due out</StatusPill>
                <StatusPill tone="neutral">Checked out</StatusPill>
                <StatusPill tone="danger">No show</StatusPill>
              </div>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-ink-900 mb-2">Housekeeping</h4>
              <div className="flex flex-wrap gap-2">
                <StatusPill tone="info">Assigned</StatusPill>
                <StatusPill tone="warning">In progress</StatusPill>
                <StatusPill tone="success">Done</StatusPill>
                <StatusPill tone="danger">Blocked</StatusPill>
              </div>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-ink-900 mb-2">Folio status</h4>
              <div className="flex flex-wrap gap-2">
                <StatusPill tone="info">Open</StatusPill>
                <StatusPill tone="success">Settled</StatusPill>
                <StatusPill tone="warning">Disputed</StatusPill>
                <StatusPill tone="danger">Written off</StatusPill>
              </div>
            </div>
          </CardBody>
        </Card>
      </Section>

      {/* ── Forms ── */}
      <Section title="Form controls">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Inputs" />
            <CardBody className="space-y-5">
              <Field label="Text" hint="With a helpful hint">
                {({ id }) => <Input id={id} placeholder="Ananya Bose" />}
              </Field>
              <Field label="Required" required error="This field is required">
                {({ id, invalid }) => <Input id={id} invalid={invalid} />}
              </Field>
              <Field label="Numeric" hint="Tabular figures">
                {({ id }) => <Input id={id} numeric defaultValue="64800" />}
              </Field>
              <Field label="With icon">
                {({ id }) => (
                  <Input id={id} leadingIcon={<Search className="size-4" />} placeholder="Search…" />
                )}
              </Field>
              <Field label="Select">
                {({ id }) => (
                  <NativeSelect id={id}>
                    <option>Confirmed</option>
                    <option>Pending approval</option>
                    <option>Cancelled</option>
                  </NativeSelect>
                )}
              </Field>
              <Field label="Textarea">
                {({ id }) => <Textarea id={id} rows={3} placeholder="Special requests…" />}
              </Field>
              <Field label="Disabled">
                {({ id }) => <Input id={id} disabled defaultValue="Read-only for your role" />}
              </Field>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Selection" />
            <CardBody className="space-y-6">
              <div className="space-y-2.5">
                <Checkbox label="Flag as VIP" checked={checked} onCheckedChange={setChecked} />
                <Checkbox label="Unchecked option" checked={false} onCheckedChange={() => {}} />
                <Checkbox label="Disabled" checked disabled onCheckedChange={() => {}} />
              </div>

              <div className="flex items-center gap-3">
                <Switch checked={switched} onCheckedChange={setSwitched} aria-label="Toggle" />
                <span className="text-base text-grey-700">
                  {switched ? "Workflow active" : "Workflow paused"}
                </span>
              </div>

              <Segmented
                value={segment}
                onChange={setSegment}
                options={[
                  { value: "month", label: "Month" },
                  { value: "quarter", label: "Quarter" },
                  { value: "year", label: "Year" },
                ]}
              />

              <Field label="Combobox" hint="Type to filter">
                {({ id }) => (
                  <Combobox
                    id={id}
                    value={combo}
                    onChange={setCombo}
                    placeholder="Select meal plan…"
                    options={[
                      { value: "ep", label: "EP", description: "Room only" },
                      { value: "cp", label: "CP", description: "Breakfast" },
                      { value: "map", label: "MAP", description: "Breakfast + one meal" },
                    ]}
                  />
                )}
              </Field>

              <Field label="Date range">
                {({ id }) => (
                  <DateRangePicker id={id} from={range.from} to={range.to} onChange={setRange} />
                )}
              </Field>
            </CardBody>
          </Card>
        </div>
      </Section>

      {/* ── Data display ── */}
      <Section title="Data display">
        <div className="grid gap-4 lg:grid-cols-2 mb-4">
          <Card className="p-5">
            <Stat label="Revenue this month" value="₹48.2L" hint="+12.4% vs last month" />
          </Card>
          <Card className="p-5">
            <p className="text-2xs font-semibold uppercase tracking-wide text-grey-500 mb-3">
              Progress
            </p>
            <div className="space-y-3">
              <ProgressBar value={82} tone="success" />
              <ProgressBar value={54} tone="accent" />
              <ProgressBar value={31} tone="warning" />
              <ProgressBar value={94} tone="danger" />
            </div>
          </Card>
        </div>

        <Card className="mb-4">
          <CardHeader title="Data table" description="Sortable, responsive, clickable rows" />
          <DataTable
            columns={demoColumns}
            rows={DEMO_ROWS}
            rowKey={(r) => r.id}
            onRowClick={() => toast.info("Row selected", "In a real screen this opens the record.")}
            className="border-0 rounded-none"
            stickyHeader={false}
          />
          <Pagination page={1} pageSize={3} total={9} onPageChange={() => {}} className="px-4 py-3" />
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Detail list" />
            <CardBody className="pt-0">
              <DetailList>
                <DetailRow label="Reference">
                  <span className="tabular">FH-2607-4821</span>
                </DetailRow>
                <DetailRow label="Guest">Ananya Bose</DetailRow>
                <DetailRow label="Property">5 Elements Akkalkot</DetailRow>
                <DetailRow label="Status">
                  <StatusPill tone="success">Confirmed</StatusPill>
                </DetailRow>
              </DetailList>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Avatars, ratings, tooltips" />
            <CardBody className="space-y-5">
              <div className="flex items-center gap-3">
                <Avatar name="Ananya Bose" color="#df6128" size="lg" />
                <Avatar name="Vikram Desai" color="#9aa2a9" size="md" />
                <Avatar name="Priya Menon" color="#1f6f5c" size="sm" />
                <Avatar name="Kabir Thakur" color="#67737e" size="xs" />
              </div>
              <div className="space-y-1.5">
                <StarRating value={5} />
                <StarRating value={4} />
                <StarRating value={3} />
              </div>
              <Tooltip content="Tooltips explain restrictions rather than hiding them">
                <Button variant="secondary" size="sm">Hover me</Button>
              </Tooltip>
            </CardBody>
          </Card>
        </div>
      </Section>

      {/* ── Overlays ── */}
      <Section title="Overlays and feedback">
        <Card>
          <CardBody className="flex flex-wrap gap-3">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="secondary">Open dialog</Button>
              </DialogTrigger>
              <DialogContent
                title="Cancel this reservation?"
                description="The record is kept and marked cancelled - reservations are never deleted."
                footer={
                  <>
                    <DialogClose asChild>
                      <Button variant="ghost">Keep it</Button>
                    </DialogClose>
                    <DialogClose asChild>
                      <Button variant="danger">Cancel reservation</Button>
                    </DialogClose>
                  </>
                }
              >
                <p className="text-base text-grey-600 leading-relaxed">
                  Dialogs carry the one shadow in the system. Everything else uses hairline
                  borders.
                </p>
              </DialogContent>
            </Dialog>

            <Button variant="secondary" onClick={() => toast.success("Saved", "The record has been updated.")}>
              Success toast
            </Button>
            <Button variant="secondary" onClick={() => toast.warning("Needs approval", "This booking is above ₹50,000.")}>
              Warning toast
            </Button>
            <Button variant="secondary" onClick={() => toast.error("Could not save", "Nothing was changed.")}>
              Error toast
            </Button>
            <Button variant="secondary" onClick={() => toast.info("Preview only", "Wired up in Phase 3.")}>
              Info toast
            </Button>
          </CardBody>
        </Card>
      </Section>

      {/* ── Tabs ── */}
      <Section title="Tabs">
        <Tabs defaultValue="one">
          <TabsList>
            <TabsTrigger value="one">Folio</TabsTrigger>
            <TabsTrigger value="two" count={4}>Guests</TabsTrigger>
            <TabsTrigger value="three" count={12}>Timeline</TabsTrigger>
          </TabsList>
          <TabsContent value="one">
            <Card><CardBody><p className="text-base text-grey-600">First panel.</p></CardBody></Card>
          </TabsContent>
          <TabsContent value="two">
            <Card><CardBody><p className="text-base text-grey-600">Second panel.</p></CardBody></Card>
          </TabsContent>
          <TabsContent value="three">
            <Card><CardBody><p className="text-base text-grey-600">Third panel.</p></CardBody></Card>
          </TabsContent>
        </Tabs>
      </Section>

      {/* ── Drawer — CRITICAL for PMS ── */}
      <Section
        title="Drawer"
        description="The most important primitive in the PMS - every flow opens a side panel over Stay View"
      >
        <Card>
          <CardBody>
            <p className="text-sm text-grey-600 mb-4">
              Arrival, charge, settle, check-out - every front desk flow opens as a drawer rather than navigating away.
              The tape chart stays visible behind it so the clerk keeps their place in the day.
            </p>
            <Drawer>
              <DrawerTrigger asChild>
                <Button variant="primary">Open arrival flow</Button>
              </DrawerTrigger>
              <DrawerContent
                title="Check in - Room 206"
                description="Ananya Bose · 2 nights · CP"
                footer={
                  <>
                    <DrawerClose asChild>
                      <Button variant="ghost">Cancel</Button>
                    </DrawerClose>
                    <Button variant="primary">Confirm check-in</Button>
                  </>
                }
              >
                <div className="space-y-4">
                  <Field label="Guest name">
                    {({ id }) => <Input id={id} defaultValue="Ananya Bose" />}
                  </Field>
                  <Field label="Adults">
                    {({ id }) => <Input id={id} type="number" defaultValue="2" numeric />}
                  </Field>
                  <p className="text-sm text-grey-500">
                    The drawer slides from the right, traps focus inside, and returns focus to the trigger on close.
                    Size, motion, and focus behavior must be correct - if this is wrong, every flow in CP5 is wrong.
                  </p>
                </div>
              </DrawerContent>
            </Drawer>
          </CardBody>
        </Card>
      </Section>

      {/* ── Dropdown Menu — Row actions ── */}
      <Section title="Dropdown menu" description="Row actions in every table">
        <Card>
          <CardBody>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary">Actions</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => toast.info("View", "Opens detail panel")}>
                  View details
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => toast.info("Edit", "Opens edit form")}>
                  Edit reservation
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => toast.info("Move", "Opens room picker")}>
                  Move to another room
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => toast.warning("Cancel", "Confirmation required")} className="text-brand-red">
                  Cancel reservation
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </CardBody>
        </Card>
      </Section>

      {/* ── Popover ── */}
      <Section title="Popover" description="Lightweight floating content">
        <Card>
          <CardBody>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="secondary">More info</Button>
              </PopoverTrigger>
              <PopoverContent>
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-ink-900">Rate breakdown</h4>
                  <div className="text-sm space-y-1">
                    <div className="flex justify-between">
                      <span className="text-grey-600">Base rate</span>
                      <span className="tabular text-ink-900">₹3,400</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-grey-600">CGST 2.5%</span>
                      <span className="tabular text-ink-900">₹85</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-grey-600">SGST 2.5%</span>
                      <span className="tabular text-ink-900">₹85</span>
                    </div>
                    <div className="flex justify-between pt-1 border-t border-grey-200">
                      <span className="text-ink-900 font-medium">Total</span>
                      <span className="tabular text-ink-900 font-medium">₹3,570</span>
                    </div>
                  </div>
                  <PopoverClose asChild>
                    <Button variant="ghost" size="sm" className="w-full mt-2">Close</Button>
                  </PopoverClose>
                </div>
              </PopoverContent>
            </Popover>
          </CardBody>
        </Card>
      </Section>

      {/* ── Date pickers ── */}
      <Section title="Date pickers">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Single date" />
            <CardBody>
              <Field label="Check-in date">
                {({ id }) => (
                  <DatePicker
                    id={id}
                    value={new Date().toISOString()}
                    onChange={() => {}}
                  />
                )}
              </Field>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Date range" />
            <CardBody>
              <Field label="Reporting period">
                {({ id }) => (
                  <DateRangePicker
                    id={id}
                    from={range.from}
                    to={range.to}
                    onChange={setRange}
                  />
                )}
              </Field>
            </CardBody>
          </Card>
        </div>
      </Section>

      {/* ── Search and filters ── */}
      <Section title="Search and filters">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Search input" />
            <CardBody>
              <Field label="Find guest">
                {({ id }) => (
                  <SearchInput
                    id={id}
                    placeholder="Search by name, phone, or reference..."
                  />
                )}
              </Field>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Filter bar" />
            <CardBody>
              <FilterBar
                search=""
                onSearchChange={() => {}}
                filters={[
                  { key: "status", label: "Status", options: [
                    { value: "confirmed", label: "Confirmed" },
                    { value: "tentative", label: "Tentative" },
                    { value: "cancelled", label: "Cancelled" },
                  ]},
                ]}
                values={{ status: "confirmed" }}
                onFilterChange={() => {}}
              />
            </CardBody>
          </Card>
        </div>
      </Section>

      {/* ── States ── */}
      <Section
        title="Empty, loading and error states"
        description="Every list screen ships all three - empty vs no-results vs error have different words and different exits"
      >
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader title="Empty" />
            <CardBody>
              <EmptyState
                icon={<Plus />}
                title="No reservations yet"
                description="This property has no reservations. Create your first one to get started."
                action={<Button variant="primary" size="sm">New reservation</Button>}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="No results" />
            <CardBody>
              <NoResultsState
                onClear={() => toast.info("Clear", "Filters cleared")}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Error" />
            <CardBody>
              <ErrorState
                title="Failed to load reservations"
                description="Could not connect to the server. Check your connection and try again."
                onRetry={() => toast.info("Retry", "Retrying...")}
              />
            </CardBody>
          </Card>
        </div>
        <div className="grid gap-4 lg:grid-cols-2 mt-4">
          <Card>
            <CardHeader title="Loading skeleton" />
            <CardBody className="space-y-3">
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-11/12" />
              <Skeleton className="h-3.5 w-4/5" />
              <Skeleton className="h-20 w-full" />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Spinner" />
            <CardBody className="flex items-center justify-center h-32">
              <Spinner />
            </CardBody>
          </Card>
        </div>
      </Section>

      {/* ── Motion & spacing ── */}
      <Section title="Motion and spacing">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-5">
            <p className="text-2xs font-semibold uppercase tracking-wide text-grey-500 mb-3">
              Spacing - 8pt grid
            </p>
            <div className="space-y-2">
              {[4, 8, 12, 16, 24, 32].map((size) => (
                <div key={size} className="flex items-center gap-3">
                  <span className="w-10 text-2xs text-grey-500 tabular">{size}px</span>
                  <span className="h-3 bg-brand-orange-100 rounded-xs" style={{ width: size * 4 }} />
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <p className="text-2xs font-semibold uppercase tracking-wide text-grey-500 mb-3">
              Motion
            </p>
            <p className="text-base text-grey-600 leading-relaxed">
              Every transition is 150–200ms with an ease-out curve. Nothing bounces,
              nothing springs, nothing slides further than it needs to. Hover an element
              anywhere on this page - the change should register without ever asking you
              to wait for it.
            </p>
            <div className="flex gap-2 mt-4">
              <span className="px-3 py-1.5 rounded-md bg-grey-100 text-sm text-grey-600 hover:bg-brand-orange hover:text-white transition-colors duration-150 cursor-default">
                150ms
              </span>
              <span className="px-3 py-1.5 rounded-md bg-grey-100 text-sm text-grey-600 hover:bg-ink-900 hover:text-white transition-colors duration-200 cursor-default">
                200ms
              </span>
            </div>
          </Card>
        </div>
      </Section>

      <Card className="bg-grey-50 mt-8">
        <CardBody>
          <p className="text-sm text-grey-600 leading-relaxed">
            Every component on this page is imported from{" "}
            <code className="text-grey-700">src/components/ui</code> - the same modules the
            product uses. Nothing here is a mock-up, so this page cannot drift from the
            application.
          </p>
        </CardBody>
      </Card>
    </Page>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-5 flex-wrap">
      <p className="text-sm text-grey-500 w-24 shrink-0 pt-2">{label}</p>
      <div className="flex flex-wrap items-center gap-2.5 flex-1">{children}</div>
    </div>
  );
}
