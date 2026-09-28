# Every read, as every role - 28 September 2026 (fix round B)

The proof for QA RO-1 to RO-3 and D27-140 to D27-147: every GET the server
mounts (141; the three person-less doors and /health aside), asked as each of
thirteen roles through the dev caller header, on branch fix/read-roles-28sep
against the copy database fidato_s26 (the demo, 5 Elements, business date
25 Aug 2026). Ids in the addresses are dummies, so a 404 or 400 is the ROUTE
answering: the gate let the person through.

`403g` refused by the gate in its own sentence · `403r` refused by the route's
own check (rule `own`) · anything else: the gate let them in.

**1,833 requests, 0 disagreements with the rules.**

| GET | rule | owner | admin | gm | hotel_manager | revenue_manager | front_desk | housekeeping | kitchen_manager | chef | pos | stores | finance | read_only |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `/api/admin/hotels` | own | 200 | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r |
| `/api/admin/hotels/:code` | own | 200 | 200 | 200 | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r |
| `/api/admin/overview` | anyone | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| `/api/admin/staff` | own | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| `/api/channel-manager/su` | own | 200 | 200 | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r |
| `/api/hotels` | own | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| `…` | anyone | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| `…/accounting/:file{day-book(?:\.xlsx)?}` | own | 200 | 200 | 200 | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 200 | 403r |
| `…/approval-rules` | setting | 200 | 200 | 200 | 403g | 403g | 403g | 403g | 403g | 403g | 403g | 403g | 403g | 403g |
| `…/approvals` | notification\|equipment\|purchasing | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 403g | 200 | 200 | 200 |
| `…/attachments` | purchasing\|equipment\|room_config | 409 | 409 | 409 | 409 | 409 | 409 | 409 | 409 | 409 | 403g | 409 | 409 | 409 |
| `…/attachments/:id/file` | purchasing\|equipment\|room_config | 404 | 404 | 404 | 404 | 404 | 404 | 404 | 404 | 404 | 403g | 404 | 404 | 404 |
| `…/attachments/awaiting-mirror` | integration | 200 | 200 | 403g | 403g | 403g | 403g | 403g | 403g | 403g | 403g | 403g | 403g | 403g |
| `…/audit-log` | own | 200 | 200 | 200 | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r |
| `…/banquet` | reservation | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403g | 403r | 403g | 403r | 403r |
| `…/banquet/attachable` | payment +pos | 200 | 200 | 200 | 200 | 403g | 200 | 403g | 403g | 403g | 200 | 403g | 200 | 200 |
| `…/banquet/events/:id` | reservation | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403g | 403r | 403g | 403r | 403r |
| `…/banquet/setup` | reservation\|room_config | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403g | 403r | 403g | 403r | 403r |
| `…/billable` | invoice | 200 | 200 | 200 | 200 | 403g | 200 | 403g | 403g | 403g | 403g | 403g | 200 | 200 |
| `…/billing-companies` | invoice | 200 | 200 | 200 | 200 | 403g | 200 | 403g | 403g | 403g | 403g | 403g | 200 | 200 |
| `…/booking-sources` | reservation\|commission | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 403g | 200 | 403g | 200 | 200 |
| `…/cancellation-policies` | rate | 200 | 200 | 200 | 200 | 200 | 200 | 403g | 403g | 403g | 403g | 403g | 403g | 200 |
| `…/cashier-shift` | payment | 200 | 200 | 200 | 200 | 403g | 200 | 403g | 403g | 403g | 403g | 403g | 200 | 200 |
| `…/channel-manager/availability` | own | 200 | 200 | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r |
| `…/channel-manager/bookings` | own | 200 | 200 | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r |
| `…/channel-manager/content` | own | 200 | 200 | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r |
| `…/commissioning` | room_config | 200 | 200 | 200 | 200 | 200 | 200 | 403g | 403g | 403g | 403g | 403g | 403g | 200 |
| `…/companies` | company | 200 | 200 | 200 | 200 | 403g | 200 | 403g | 403g | 403g | 403g | 403g | 200 | 200 |
| `…/crm/guests` | customer | 200 | 200 | 200 | 403r | 403g | 403r | 403g | 403g | 403g | 403g | 403g | 403r | 403r |
| `…/crm/guests/:id` | customer | 404 | 404 | 404 | 403r | 403g | 403r | 403g | 403g | 403g | 403g | 403g | 403r | 403r |
| `…/crm/joins` | customer | 200 | 200 | 200 | 403r | 403g | 403r | 403g | 403g | 403g | 403g | 403g | 403r | 403r |
| `…/crm/no-offers` | customer | 200 | 200 | 200 | 403r | 403g | 403r | 403g | 403g | 403g | 403g | 403g | 403r | 403r |
| `…/crm/not-same` | customer | 200 | 200 | 200 | 403r | 403g | 403r | 403g | 403g | 403g | 403g | 403g | 403r | 403r |
| `…/crm/offers-yes` | customer | 200 | 200 | 200 | 403r | 403g | 403r | 403g | 403g | 403g | 403g | 403g | 403r | 403r |
| `…/crm/same-person` | customer | 200 | 200 | 200 | 403r | 403g | 403r | 403g | 403g | 403g | 403g | 403g | 403r | 403r |
| `…/early-arrival` | reservation | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 403g | 200 | 403g | 200 | 200 |
| `…/equipment` | own | 200 | 200 | 200 | 200 | 403r | 200 | 200 | 200 | 200 | 403r | 200 | 200 | 200 |
| `…/equipment/export` | own | 200 | 200 | 200 | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 200 | 403r |
| `…/equipment/items/:id` | own | 409 | 409 | 409 | 409 | 403r | 409 | 409 | 409 | 409 | 403r | 409 | 409 | 409 |
| `…/equipment/options` | equipment | 200 | 200 | 200 | 200 | 403g | 200 | 200 | 200 | 200 | 403g | 200 | 200 | 200 |
| `…/folios` | invoice | 200 | 200 | 200 | 200 | 403g | 200 | 403g | 403g | 403g | 403g | 403g | 200 | 200 |
| `…/form-c` | customer | 200 | 200 | 200 | 200 | 403g | 200 | 403g | 403g | 403g | 403g | 403g | 403g | 403g |
| `…/group` | anyone | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| `…/groups` | reservation | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 403g | 200 | 403g | 200 | 200 |
| `…/groups/:id` | reservation | 409 | 409 | 409 | 409 | 409 | 409 | 409 | 409 | 403g | 409 | 403g | 409 | 409 |
| `…/guest-messages` | own | 200 | 200 | 200 | 200 | 403r | 200 | 403r | 403r | 403r | 403r | 403r | 200 | 200 |
| `…/guests` | customer | 200 | 200 | 200 | 200 | 403g | 200 | 403g | 403g | 403g | 403g | 403g | 200 | 200 |
| `…/guests/blacklist-warnings` | reservation | 400 | 400 | 400 | 400 | 400 | 400 | 400 | 400 | 403g | 400 | 403g | 400 | 400 |
| `…/guests/returning` | customer | 200 | 200 | 200 | 200 | 403g | 200 | 403g | 403g | 403g | 403g | 403g | 200 | 200 |
| `…/house-now` | anyone | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| `…/housekeepers` | inventory | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 403g | 200 |
| `…/housekeeping/assignments` | inventory | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 403g | 200 |
| `…/inclusions` | reservation | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 403g | 200 | 403g | 200 | 200 |
| `…/inventory` | inventory\|reservation | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| `…/invoice-series` | invoice\|setting | 200 | 200 | 200 | 200 | 403g | 200 | 403g | 403g | 403g | 403g | 403g | 200 | 200 |
| `…/invoices` | invoice | 200 | 200 | 200 | 200 | 403g | 200 | 403g | 403g | 403g | 403g | 403g | 200 | 200 |
| `…/invoices/:number{.+}` | invoice | 404 | 404 | 404 | 404 | 403g | 404 | 403g | 403g | 403g | 403g | 403g | 404 | 404 |
| `…/kitchen` | payment +chef,kitchen_manager | 200 | 200 | 200 | 200 | 403g | 403r | 403g | 200 | 200 | 403g | 403g | 200 | 200 |
| `…/laundry/dockets` | laundry | 403r | 403r | 403r | 403r | 403g | 403r | 403r | 403g | 403g | 403g | 403g | 403r | 403r |
| `…/laundry/dockets/:id` | laundry | 403r | 403r | 403r | 403r | 403g | 403r | 403r | 403g | 403g | 403g | 403g | 403r | 403r |
| `…/laundry/price-list` | laundry | 403r | 403r | 403r | 403r | 403g | 403r | 403r | 403g | 403g | 403g | 403g | 403r | 403r |
| `…/live` | anyone | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| `…/modules` | anyone | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| `…/night-audit` | report | 200 | 200 | 200 | 200 | 200 | 200 | 403g | 403g | 403g | 403g | 403g | 200 | 200 |
| `…/night-audit/days/:date/charges` | report | 200 | 200 | 200 | 200 | 200 | 200 | 403g | 403g | 403g | 403g | 403g | 200 | 200 |
| `…/night-audit/runs` | report | 200 | 200 | 200 | 200 | 200 | 200 | 403g | 403g | 403g | 403g | 403g | 200 | 200 |
| `…/notifications` | notification | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 403g | 200 | 200 | 200 |
| `…/online-checkin` | own | 200 | 200 | 200 | 200 | 403r | 200 | 403r | 403r | 403r | 403r | 403r | 403r | 403r |
| `…/online-checkin/messages` | own | 200 | 200 | 200 | 200 | 403r | 200 | 403r | 403r | 403r | 403r | 403r | 403r | 403r |
| `…/payments` | payment | 200 | 200 | 200 | 200 | 403g | 200 | 403g | 403g | 403g | 403g | 403g | 200 | 200 |
| `…/places` | stock\|equipment\|purchasing | 200 | 200 | 200 | 200 | 403g | 200 | 200 | 200 | 200 | 403g | 200 | 200 | 200 |
| `…/pos/outlets` | payment\|invoice\|setting +pos | 200 | 200 | 200 | 200 | 403g | 200 | 403g | 403g | 403g | 200 | 403g | 200 | 200 |
| `…/pos/tickets` | invoice | 200 | 200 | 200 | 200 | 403g | 200 | 403g | 403g | 403g | 403g | 403g | 200 | 200 |
| `…/pricing` | rate | 200 | 200 | 200 | 200 | 200 | 200 | 403g | 403g | 403g | 403g | 403g | 403g | 200 |
| `…/purchasing` | own | 200 | 200 | 200 | 200 | 403r | 403r | 200 | 200 | 403r | 403r | 200 | 200 | 200 |
| `…/purchasing/orders/:file{[0-9a-f-]+\.pdf}` | own | 404 | 404 | 404 | 404 | 403r | 403r | 404 | 404 | 403r | 403r | 404 | 404 | 404 |
| `…/purchasing/requesters` | own | 200 | 200 | 200 | 200 | 403r | 403r | 200 | 200 | 403r | 403r | 200 | 200 | 200 |
| `…/purchasing/requests/:id` | own | 404 | 404 | 404 | 404 | 403r | 403r | 404 | 404 | 403r | 403r | 404 | 404 | 404 |
| `…/rate-grid` | rate | 200 | 200 | 200 | 200 | 200 | 200 | 403g | 403g | 403g | 403g | 403g | 403g | 200 |
| `…/rate-plans` | rate | 200 | 200 | 200 | 200 | 200 | 200 | 403g | 403g | 403g | 403g | 403g | 403g | 200 |
| `…/rates` | rate | 200 | 200 | 200 | 200 | 200 | 200 | 403g | 403g | 403g | 403g | 403g | 403g | 200 |
| `…/repairable-equipment` | room_config\|equipment\|inventory | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| `…/reports/:file{[a-z0-9-]+\.(?:pdf|xlsx|csv)}` | own | 200 | 200 | 200 | 200 | 200 | 403r | 403r | 403r | 403r | 403r | 403r | 200 | 403r |
| `…/reports/balances-by-source` | invoice | 200 | 200 | 200 | 200 | 403g | 200 | 403g | 403g | 403g | 403g | 403g | 200 | 200 |
| `…/reports/c-form` | customer | 200 | 200 | 200 | 200 | 403g | 200 | 403g | 403g | 403g | 403g | 403g | 403g | 403g |
| `…/reports/cashier-shift` | invoice | 200 | 200 | 200 | 200 | 403g | 200 | 403g | 403g | 403g | 403g | 403g | 200 | 200 |
| `…/reports/city-ledger` | invoice | 200 | 200 | 200 | 200 | 403g | 200 | 403g | 403g | 403g | 403g | 403g | 200 | 200 |
| `…/reports/gst-sales` | report | 200 | 200 | 200 | 200 | 200 | 200 | 403g | 403g | 403g | 403g | 403g | 200 | 200 |
| `…/reports/guest-ledger` | invoice | 200 | 200 | 200 | 200 | 403g | 200 | 403g | 403g | 403g | 403g | 403g | 200 | 200 |
| `…/reports/lodging-tax` | report | 200 | 200 | 200 | 200 | 200 | 200 | 403g | 403g | 403g | 403g | 403g | 200 | 200 |
| `…/reports/manager` | report | 200 | 200 | 200 | 200 | 200 | 200 | 403g | 403g | 403g | 403g | 403g | 200 | 200 |
| `…/reports/monthly-occupancy` | report | 200 | 200 | 200 | 200 | 200 | 200 | 403g | 403g | 403g | 403g | 403g | 200 | 200 |
| `…/reports/monthly-statistics` | report | 200 | 200 | 200 | 200 | 200 | 200 | 403g | 403g | 403g | 403g | 403g | 200 | 200 |
| `…/reports/night-audit` | report | 200 | 200 | 200 | 200 | 200 | 200 | 403g | 403g | 403g | 403g | 403g | 200 | 200 |
| `…/reports/no-show` | report | 200 | 200 | 200 | 200 | 200 | 200 | 403g | 403g | 403g | 403g | 403g | 200 | 200 |
| `…/reports/yearly-statistics` | report | 200 | 200 | 200 | 200 | 200 | 200 | 403g | 403g | 403g | 403g | 403g | 200 | 200 |
| `…/revenue/pickup` | rate | 200 | 200 | 200 | 200 | 200 | 200 | 403g | 403g | 403g | 403g | 403g | 403g | 200 |
| `…/reviews` | own | 200 | 200 | 200 | 200 | 403r | 200 | 403r | 403r | 403r | 403r | 403r | 200 | 200 |
| `…/room-promotions` | reservation | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 403g | 200 | 403g | 200 | 200 |
| `…/room-setup` | room_config | 200 | 200 | 200 | 200 | 200 | 200 | 403g | 403g | 403g | 403g | 403g | 403g | 200 |
| `…/room-types` | room_config\|rate\|reservation | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 403g | 200 | 403g | 200 | 200 |
| `…/rooms` | anyone | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| `…/sales-people` | reservation | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 403g | 200 | 403g | 200 | 200 |
| `…/settings` | own | 200 | 200 | 200 | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r |
| `…/spa` | own | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r |
| `…/spa/therapists` | own | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r |
| `…/spa/treatments` | own | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r | 403r |
| `…/staff` | user | 200 | 200 | 200 | 200 | 403g | 403g | 403g | 403g | 403g | 403g | 403g | 403g | 403g |
| `…/statistics/daily` | report\|rate | 200 | 200 | 200 | 200 | 200 | 200 | 403g | 403g | 403g | 403g | 403g | 200 | 200 |
| `…/statistics/period` | report\|rate | 200 | 200 | 200 | 200 | 200 | 200 | 403g | 403g | 403g | 403g | 403g | 200 | 200 |
| `…/statistics/snapshot` | report\|rate | 200 | 200 | 200 | 200 | 200 | 200 | 403g | 403g | 403g | 403g | 403g | 200 | 200 |
| `…/stays` | reservation | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 403g | 200 | 403g | 200 | 200 |
| `…/stays/:id` | reservation | 404 | 404 | 404 | 404 | 404 | 404 | 404 | 404 | 403g | 404 | 403g | 404 | 404 |
| `…/stays/:id/bill` | invoice | 404 | 404 | 404 | 404 | 403g | 404 | 403g | 403g | 403g | 403g | 403g | 404 | 404 |
| `…/stays/:id/exchangeable` | reservation | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 403g | 200 | 403g | 200 | 200 |
| `…/stays/:id/folio` | invoice | 404 | 404 | 404 | 404 | 403g | 404 | 403g | 403g | 403g | 403g | 403g | 404 | 404 |
| `…/stays/:id/folios` | invoice | 200 | 200 | 200 | 200 | 403g | 200 | 403g | 403g | 403g | 403g | 403g | 200 | 200 |
| `…/stays/:id/guest-marks` | reservation | 404 | 404 | 404 | 404 | 404 | 404 | 404 | 404 | 403g | 404 | 403g | 404 | 404 |
| `…/stays/:id/inclusions` | reservation | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 403g | 200 | 403g | 200 | 200 |
| `…/stays/:id/postings` | invoice | 200 | 200 | 200 | 200 | 403g | 200 | 403g | 403g | 403g | 403g | 403g | 200 | 200 |
| `…/stores` | own | 200 | 200 | 200 | 200 | 403r | 403r | 200 | 200 | 200 | 403r | 200 | 200 | 200 |
| `…/stores/items/:id/movements` | own | 200 | 200 | 200 | 200 | 403r | 403r | 200 | 200 | 200 | 403r | 200 | 200 | 200 |
| `…/system-health` | role | 200 | 200 | 403g | 403g | 403g | 403g | 403g | 403g | 403g | 403g | 403g | 403g | 403g |
| `…/tariff` | reservation\|rate | 409 | 409 | 409 | 409 | 409 | 409 | 409 | 409 | 403g | 409 | 403g | 409 | 409 |
| `…/tax` | anyone | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| `…/tax/:kind/rate` | anyone | 409 | 409 | 409 | 409 | 409 | 409 | 409 | 409 | 409 | 409 | 409 | 409 | 409 |
| `…/till/access` | anyone | 200 | 200 | 200 | 200 | 200 | 403r | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| `…/till/day-end` | payment +pos,kitchen_manager | 200 | 200 | 200 | 200 | 403g | 403r | 403g | 200 | 403g | 200 | 403g | 200 | 200 |
| `…/till/floor` | payment +pos | 200 | 200 | 200 | 200 | 403g | 403r | 403g | 403g | 403g | 200 | 403g | 200 | 200 |
| `…/till/menu` | menu\|payment +pos | 200 | 200 | 200 | 200 | 403g | 403r | 403g | 200 | 403g | 200 | 403g | 200 | 200 |
| `…/till/menu/addon-groups` | menu\|payment +pos | 200 | 200 | 200 | 200 | 403g | 403r | 403g | 200 | 403g | 200 | 403g | 200 | 200 |
| `…/till/orders` | payment +pos | 200 | 200 | 200 | 200 | 403g | 403r | 403g | 403g | 403g | 200 | 403g | 200 | 200 |
| `…/till/orders/:id` | payment +pos | 404 | 404 | 404 | 404 | 403g | 403r | 403g | 403g | 403g | 404 | 403g | 404 | 404 |
| `…/till/orders/:id/kot/:no` | payment +pos | 404 | 404 | 404 | 404 | 403g | 403r | 403g | 403g | 403g | 404 | 403g | 404 | 404 |
| `…/till/promotions` | menu\|payment +pos | 200 | 200 | 200 | 200 | 403g | 403r | 403g | 200 | 403g | 200 | 403g | 200 | 200 |
| `…/till/rooms` | payment +pos | 200 | 200 | 200 | 200 | 403g | 403r | 403g | 403g | 403g | 200 | 403g | 200 | 200 |
| `…/till/setup` | room_config | 200 | 200 | 200 | 200 | 200 | 403r | 403g | 403g | 403g | 403g | 403g | 403g | 200 |
| `…/till/waiters` | payment +pos | 200 | 200 | 200 | 200 | 403g | 403r | 403g | 403g | 403g | 200 | 403g | 200 | 200 |
| `…/vat-bills` | invoice | 200 | 200 | 200 | 200 | 403g | 200 | 403g | 403g | 403g | 403g | 403g | 200 | 200 |
| `…/vat-bills/:number{.+}` | invoice | 404 | 404 | 404 | 404 | 403g | 404 | 403g | 403g | 403g | 403g | 403g | 404 | 404 |
| `…/work-orders` | room_config\|equipment\|inventory | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
