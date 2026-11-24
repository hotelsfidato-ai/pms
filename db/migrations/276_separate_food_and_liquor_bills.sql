-- =============================================================================
-- 276 · Food and liquor on separate bills (the owner, 25 November 2026)
-- =============================================================================
-- "Few guests want separate bill for liquor & food. So need such option at the
-- time of billing." One order, one payment, as before; the cashier ticks it
-- on the open bill and the paper comes out as two: the Food bill (the GST
-- lines) and the Liquor bill (the VAT lines, with its VAT bill number once
-- paid, D22-44). Each with its own share of the discount, its own taxes and
-- its own total, from app.pos_order_by_tax (the one split everything reads),
-- and the two totals add up to the payable. Nothing about the sale, its tax,
-- its numbers or its payment changes: this is how the bill is printed.
--
-- Re-runnable.
-- =============================================================================

alter table pos_orders add column if not exists separate_bills boolean not null default false;

comment on column pos_orders.separate_bills is
  'Printed as two bills, food (GST) and liquor (VAT), when true (the owner, 25 Nov 2026). '
  'How the bill prints only: the sale, its tax and its payment are one.';
