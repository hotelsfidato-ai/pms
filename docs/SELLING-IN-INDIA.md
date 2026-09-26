# Selling in India

**What has to be true before the hotel system is sold to other hotel groups in India: the law as it stands on 25 September 2026, what the code does today, and what is missing.**

As of **25 September 2026**, on `cp6` at `733eb98` (branch `audit/selling-in-india`). The same report as a page to share: https://claude.ai/artifact/LnyUdYEsa9JDYdagwKXCVD

> A checklist for the owner to take to their CA and lawyer, not legal advice. Every rule cites its primary source; where only a secondary source could be reached, or sources disagree, the item says so. Research was web reading only: nothing from the code, the data or `api/.env` left this machine.

## The owner's answers (25 September 2026)

- **Who sells and hosts:** **Influvate** sells the system and runs every buyer's copy on its own servers. Fidato Hotels is one customer, with its own copy.
- **Who owns the code:** Influvate (the owner), without doubt.
- **Product name:** A new name, not Fidato.
- **Influvate's GST:** Already registered.
- **How buyers pay:** A yearly subscription per property.
- **Where buyers are:** Anywhere in India.
- **Online payments:** Not for now: guests pay at the desk.

## In plain words

1. **The foundations a CA looks for are already here.** Tax follows the hotel's state (never IGST), an issued invoice is never edited and is corrected only by a credit note, no tax rate or price is ever assumed, liquor is kept off the GST invoice with its own VAT bill, no service charge exists anywhere, and every change is logged.
2. **Five things break a law that is in force today**, for every hotel on the system, Fidato's included: the full Aadhaar number is stored (the Aadhaar Act forbids it); a restaurant sale to someone who is not staying gets no GST tax invoice; invoice numbers are 17 characters where the limit is 16; foreign-guest reporting still follows the old Form C, not the Form III rules of 1 September 2025; and the tax invoice lacks the legal name, a SAC per line and the reverse-charge line.
3. **Because Influvate hosts every buyer, Influvate carries duties of its own from the first sale:** CERT-In's six-hour incident reporting, 180 days of logs and a synchronised clock; backups off the server; its own paid servers and accounts instead of Fidato's free ones; and papers: a subscription agreement with an SLA, a data processing agreement, a privacy notice per buyer, and Fidato Hotels' written word that Influvate owns the code.
4. **The desk must obey the new Income-tax Act (1 April 2026):** no cash of ₹2 lakh or more from one guest in a day, for one bill or one event (section 186, penalty equal to the amount), and a PAN or Form 97 when more than ₹1 lakh is paid in cash at once.
5. **The data protection law (DPDP) applies from 13 May 2027**, possibly from 13 November 2026 if a January 2026 proposal is notified. Consent records, opt-in marketing (today it is opt-out), erasure on a schedule (today nothing is ever erased), a 90-day request tracker, a 72-hour breach workflow and a year of access logs have to be built before then.
6. **Before a buyer in another state, or a bigger one:** e-invoicing (IRN and QR) for any group above ₹5 crore turnover, which is most multi-hotel groups; liquor VAT that differs by state (in UP and HP it seems to be collected before the bar, so no VAT line at all); police register rules that differ by state and district; and the yearly "specified premises" test for the restaurant's rate.
7. **Fidato's name is still in 36 places** and has to come out before the first buyer, with the new name searched and filed as a trade mark. The open-source licences are clean: nothing forces the code to be published.
8. **Online payments stay out.** If they ever come, Influvate must never hold guests' money, and no card number may be stored.

## The list

Effort: **S** up to 2 days · **M** up to 2 weeks · **L** longer. For CA, lawyer and owner work it is that person's time.

Each item: **what** needs to be true, **why** (the rule, its date, the primary source), what the code does **today** (with paths), what is **missing**, the effort, and who does it.

### A · MUST before the first sale (16)

In force today, or needed for any hotel on any contract. Most of these apply to Fidato's own first real day too.

#### A1 · Stop storing the full Aadhaar number

- **What:** Keep only the last four digits of an Aadhaar number (or the Aadhaar App's verified credential), always offer another ID, and remove the full numbers already stored, including their copies in the change log.
- **Why:** A hotel that checks a guest's Aadhaar in any form (card, photocopy, e-Aadhaar, QR) is doing "offline verification", and such an entity "shall not collect, use or store an Aadhaar number". Only the masked number may be kept, with consent; another ID must always be accepted. Civil penalty up to ₹1 crore per contravention plus ₹10 lakh a day. In force since 2019; the 9 December 2025 amendment kept paper verification and added app-based verification. An announced ban on keeping photocopies is still not notified (a proposal on 30 August 2026).
- **Sources:** [Aadhaar Act 2016, s.4(3), s.8A(3)–(4), s.29, s.33A (UIDAI consolidated text)](https://backend.uidai.gov.in/get/files/media/document/2026-05/images_Aadhaar_Act_2016_English_0.pdf) · [Aadhaar (Authentication and Offline Verification) Amendment Regulations, 9 Dec 2025](https://backend.uidai.gov.in/get/files/media/document/2026-05/Regulation.pdf) · [Authentication and Offline Verification Regulations 2021, regs 2(1)(mc), 14A, 16A (Indian Kanoon copy; UIDAI link is dead)](https://indiankanoon.org/doc/95940041/) · [Aadhaar (Sharing of Information) Regulations 2016, reg 6 (Indian Kanoon copy)](https://indiankanoon.org/doc/65276361/)
- **Today:** By the owner's decision D21-17 the full number is stored: `guest_documents.id_number` (`db/migrations/013_policies.sql`) and `guest_detail_submissions` (121). The desk screen shows the last four (`api/src/routes/guestDoor.ts:551`), but the check-in flow shows what was typed and the change log keeps every before-and-after copy of `guest_documents` for good (`db/migrations/011_model_additions.sql:284`, audited from `016_audit_coverage.sql:35`).
- **Missing:** Mask on save; a one-off scrub of stored numbers, the waiting submissions and the change-log copies; the words "you may use another ID" at the desk and on the guest page. **Needs the owner to reverse D21-17** (the advisor's word was still awaited).
- **Effort:** M · **Who:** Owner, Lawyer, Code

#### A2 · A GST tax invoice for every restaurant sale

- **What:** A diner who is not staying and pays at the till must get a numbered GST tax invoice, and those sales must reach the GST register. For bills under ₹200 where the guest does not ask for one, one consolidated invoice at the end of each day is allowed.
- **Why:** A registered person issues a tax invoice for every taxable supply (CGST Act s.31, Rule 46), with the daily consolidated invoice for B2C supplies under ₹200 as the only relief.
- **Sources:** [CGST Rules, Rule 46 (CBIC consolidated text)](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter6/rule46_v1.00.html) · [CGST Rules, Rule 47 (30 days for services)](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter6/rule47_v1.00.html)
- **Today:** The restaurant bill says "This is a restaurant bill, not a tax invoice. A GST invoice is issued against the room folio at checkout" (`src/modules/pos/pages/Bill.tsx:191`). Its number restarts every day (`YYYYMMDD-n`, `db/migrations/028_pos_till.sql:345`). Tax invoices exist only for room bills (`invoices` belong to folios, 011/025), and the GST sales register lists only those (`api/src/modules/reports/reports.ts:310`). A restaurant bill charged to a room is fine: it reaches the room's invoice. The alcohol on the same restaurant sale already gets its own numbered VAT bill (D22-44), so only the GST half is missing.
- **Missing:** A GST invoice series for restaurant settlements (one per hotel, per financial year), the invoice itself on the thermal bill, and the register and day book including them.
- **Effort:** M · **Who:** CA, Code

#### A3 · Foreign guests: Form III under the 2025 Act

- **What:** Record every field Form III asks for, run both 24-hour clocks (arrival and departure), keep the record electronically for at least a year, and stop calling it Form C.
- **Why:** Since 1 September 2025 the Immigration and Foreigners Act 2025 s.8 and Rule 17 of its Rules replace the Foreigners Act 1946 and the 1992 Rules. The keeper of the accommodation sends Form III within 24 hours of arrival and the departure within 24 hours after it, through indianfrro.gov.in; the guest signs on arrival; records are kept electronically for at least a year and shown on demand. OCI, Nepali and Bhutanese guests are included. Penalty up to 3 years or ₹3 lakh; the FRRO compounds it at ₹50,000 per case. No public API exists, so the hotel still files on the portal.
- **Sources:** [Immigration and Foreigners Act 2025, s.8, s.23, s.25 (MHA)](https://www.mha.gov.in/sites/default/files/2025-09/Immigration_and_Foreigners_Act_2025_16092025.pdf) · [Immigration and Foreigners Rules 2025, G.S.R. 596(E), 1 Sep 2025, Rule 17 and Form III](https://www.mha.gov.in/sites/default/files/2025-09/Immigration_and_Foreigners_Rules_2025_16092025.pdf) · [Commencement, S.O. 3981(E), 31 Aug 2025](https://www.mha.gov.in/sites/default/files/2025-09/Notification_on_commencement_date_of_Immigration_and_Foreigners_Act_2025_16092025.pdf) · [Compounding, S.O. 3999(E), 1 Sep 2025](https://www.mha.gov.in/sites/default/files/2025-09/NotificationregardingcompoundingofcertainoffencesundertheImmigrationandForeignersAct2025_16092025.pdf)
- **Today:** A register (`db/migrations/025_invoices_form_c.sql:141-256`, `api/src/modules/guests/formC.ts`, report `api/src/modules/reports/reports.ts:381`) lists foreign stays and records the portal's reference. Its deadline is the check-in date plus one day, not 24 hours from the arrival time; nothing tracks departure; it holds passport number and expiry, visa number and expiry, and address (`guest_documents`, 013). The guest page asks for the same (D21-19).
- **Missing:** The guest's photograph, arrival time, arrived from, purpose of visit, previous place of stay, visa type, phone and email in India, departure date and time, next destination, the departure filing's reference, and a signed arrival and departure card (paper is fine). A one-year minimum in the retention rule (C4).
- **Effort:** M · **Who:** Code

#### A4 · Invoice numbers of 16 characters or fewer

- **What:** Shorten the tax invoice and credit note number, for example `5EL/2627/00001` (14). The CA chooses the format.
- **Why:** Rule 46(b): "a consecutive serial number not exceeding sixteen characters … unique for a financial year"; the same limit applies to credit notes (Rule 53) and receipt vouchers (Rule 50). Since 1 June 2025 the e-invoice portal treats numbers as case-insensitive.
- **Sources:** [CGST Rules, Rule 46(b)](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter6/rule46_v1.00.html) · [GSTN advisory, 4 Apr 2025 (case-insensitive numbers)](https://www.gst.gov.in/newsandupdates/read/592)
- **Today:** `app.next_invoice_number` builds `<hotel code>/<2026-27>/<5 digits>` (`db/migrations/138_a_gst_series_opens_itself.sql:45`). `5EL/2026-27/00001` is 17 characters, and a hotel code may be 2 to 10 letters (`002_tenancy.sql:38`), so up to 24. The CA question page's own example (E1) is 17.
- **Missing:** A shorter format and a check that refuses anything over 16. The VAT bill (`VAT/5EL/2026-27/0001`, 20) is state law, not Rule 46; its limit is a question for each state's CA.
- **Effort:** S · **Who:** CA, Code

#### A5 · What the tax invoice must print

- **What:** Add what Rule 46 and Rule 48 ask for and the printed invoice leaves out.
- **Why:** Rule 46: (a) the supplier's name, meaning the registered legal (or trade) name; (e) for an unregistered recipient at ₹50,000 or more, the state name and code, and for any booking through an OTA the recipient's state whatever the value; (g) the HSN or SAC of each supply; (p) whether tax is payable on reverse charge; (q) a signature or digital signature on a printed invoice (not needed on an electronic one). Rule 48: a service invoice is marked "ORIGINAL FOR RECIPIENT" and "DUPLICATE FOR SUPPLIER". Rule 53(1A): a credit note quotes the original invoice's number **and date**.
- **Sources:** [CGST Rules, Rule 46](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter6/rule46_v1.00.html) · [CGST Rules, Rule 48](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter6/rule48_v1.00.html) · [CGST Rules, Rule 53](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter6/rule53_v1.00.html) · [Scheme of Classification of Services (SAC codes)](https://www.gstcouncil.gov.in/sites/default/files/2024-02/scheme_of_classification_of_services_amended.pdf)
- **Today:** The invoice prints the hotel's display name (`api/src/modules/finance/invoices.ts:360`); no legal-name setting exists anywhere, although the owner decided on 14 September that the legal name is chosen in settings. One SAC, `996311`, is stored and printed for the whole invoice (`025`, `src/modules/finance/pages/Invoice.tsx:318`) even when the stay's invoice carries restaurant (996331/996332), laundry (9997xx) or spa (99972x) lines. There is no reverse-charge line, no original/duplicate mark and a blank signatory line (`Invoice.tsx:458-476`), and no recipient state.
- **Missing:** A legal-name field per GSTIN; a SAC on each line, set by the charge's kind; "Reverse charge: No"; the original/duplicate mark; the recipient's state and code; the original invoice's date on a credit note.
- **Effort:** S · **Who:** CA, Code

#### A6 · Cash limits and PAN at the desk

- **What:** Refuse cash of ₹2 lakh or more from one person in a day, for one bill, or for one event such as a wedding. When more than ₹1 lakh is paid in cash against a bill at one time, take the guest's PAN or a Form 97 and record it (foreign non-resident guests are exempt).
- **Why:** Income-tax Act 2025 s.186 (was 269ST), unchanged in substance; the penalty under s.451 equals the amount received. Income-tax Rules 2026, Rule 159 Table Sl. 15 (was Rule 114B): PAN for cash paid to a hotel, restaurant, banquet hall or convention centre above ₹1,00,000 at one time, raised from ₹50,000; Form 97 replaces Form 60. Audited hotels file Form 98 of the Form 97s received (Rule 160) and report cash receipts above ₹2 lakh on Form 165 (Rule 237). All in force from 1 April 2026.
- **Sources:** [Income-tax Act 2025, s.186 (CBDT)](https://www.incometaxindia.gov.in/w/section-186-41) · [Income-tax Act 2025, s.451 (CBDT)](https://www.incometaxindia.gov.in/w/section-451-6) · [Income-tax Rules 2026, Rule 159 (CBDT)](https://www.incometaxindia.gov.in/w/rule-159-1) · [Income-tax Rules 2026, Rule 160 and Rule 237 (CBDT)](https://www.incometaxindia.gov.in/w/rule-237-1) · [CBDT's 1961-to-2025 section finder](https://www.incometaxindia.gov.in/utility-to-check-provisions-of-income-tax-act-1961-vis-a-vis-income-tax-act-2025)
- **Today:** A payment takes any cash amount (`api/src/modules/finance/postings.ts`, `/stays/:id/payments`); the restaurant's settlement too. No PAN or Form 97 field exists.
- **Missing:** The ₹2 lakh check across one guest's day, one bill and one event (a group or banquet); the PAN or Form 97 prompt above ₹1 lakh in cash; a list of both for the CA.
- **Effort:** S · **Who:** Code, CA

#### A7 · The server must check the role when personal data is read

- **What:** Refuse reads of guest documents, contact details, bills and reports to roles that may not see them, as writes already are.
- **Why:** The IT Act's security-practice rules (SPDI Rules 2011, rule 8) apply now; the Aadhaar sharing rules require stored numbers to be kept secure (reg 6(2)); from 13 May 2027 the DPDP Rules require access control (rule 6(1)(b)). It is also the first thing a buyer's security test (VAPT) will try.
- **Sources:** [SPDI Rules 2011, G.S.R. 313(E), 11 Apr 2011 (gazette copy on DataGuidance; MeitY link is dead)](https://www.dataguidance.com/sites/default/files/in098en.pdf) · [DPDP Rules 2025, G.S.R. 846(E), 13 Nov 2025, rule 6](https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf)
- **Today:** `api/src/roleGate.ts` asks the role on every write, by design (its header says so). Reads are limited only by hotel, through row security. Example: `GET /api/hotels/:code/reports/c-form` (`api/src/modules/reports/reports.ts:381`) returns foreign guests' passport and visa numbers and addresses to any login at that hotel, housekeeping included, when called directly. The menu hides it; the server does not refuse.
- **Missing:** A read rule per resource, from the same permission matrix (`api/src/permissions.ts`), and a test that fails for a read route with no rule, as `roleGate.test.ts` does for writes.
- **Effort:** M · **Who:** Code

#### A8 · CERT-In's rules for Influvate (and each hotel)

- **What:** Register a Point of Contact with CERT-In; write down who reports an incident within six hours (Influvate and the hotel each report what they notice); keep logs of every system for 180 days; set the servers' clocks to NIC or NPL time.
- **Why:** CERT-In Directions No. 20(3)/2022-CERT-In of 28 April 2022, in force 27 June 2022 (for MSMEs from 25 September 2022), cover every "body corporate", however small. The FAQs say the duty to report cannot be moved to someone else by contract (Q13); logs may sit outside India if they can be produced (Q35), but records of financial transactions stay in India (Q36). Since the Jan Vishwas Act 2023 the fine is up to ₹1 crore. CERT-In's guidance of 10 June 2026 (CISG-2026-03) is addressed to software vendors: tell customers and CERT-In of critical flaws at once, patch high ones in 7 days, supply an SBOM.
- **Sources:** [CERT-In Directions, 28 Apr 2022](https://www.cert-in.org.in/PDF/CERT-In_Directions_70B_28.04.2022.pdf) · [CERT-In FAQs on the Directions, May 2022](https://www.cert-in.org.in/PDF/FAQs_on_CyberSecurityDirections_May2022.pdf) · [Jan Vishwas (Amendment of Provisions) Act 2023 (s.70B(7) fine)](https://egazette.gov.in/WriteReadData/2023/248047.pdf) · [CERT-In CISG-2026-03, 10 Jun 2026 (guideline index)](https://www.cert-in.org.in/s2cMainServlet?pageid=GUIDLNVIEW02&refcode=CISG-2026-03)
- **Today:** `deploy/launch.sh` sets no log retention (nginx and journald keep their defaults) and no time source, and empties the backup log on every run (`launch.sh:577`). There is no incident plan and no Point of Contact. Staff sign-in logs sit with Google (Firebase Authentication); whether they can be kept for 180 days is not known.
- **Missing:** 180 days of logs from the API, nginx, Postgres, ssh, sign-in and n8n; chrony pointed at `samay1.nic.in` or `time.nplindia.org` (or the cloud's own time service, which the FAQs allow); a one-page incident runbook with the CERT-In address and the hotel's contact; the Point of Contact filed.
- **Effort:** M · **Who:** Code, Owner

#### A9 · Backups off the server, tested restores, and something watching

- **What:** Copy each night's backup to storage somewhere else in India, restore one on a schedule, and alert someone when the API stops answering.
- **Why:** GST records must be kept and produced, with backups that can be restored (CGST Rule 57, s.36: 72 months). Security practice under SPDI rule 8 now, and "backups" by name in DPDP rule 6(1)(d) from 13 May 2027. Every buyer's SLA will ask.
- **Sources:** [CGST Rules, Rule 57](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter7/rule57_v1.00.html) · [CGST Act, s.36](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter8/section36_v1.00.html)
- **Today:** A nightly `pg_dump` at 03:00, 14 kept, **on the same disk** (`deploy/launch.sh:565-587`, `db/backup.sh:129`); uploaded purchase bills on the same disk (`launch.sh:410-425`). `/health` exists (`deploy/nginx.conf:141`) and nothing checks it. HANDOVER § 8 already lists the off-box copy as P0.
- **Missing:** The off-box copy (for example object storage in another Indian region), `db/verify-backup.sh` on a timer, an uptime check with an alert to a phone.
- **Effort:** S · **Who:** Code, Owner

#### A10 · Influvate's own servers and accounts, on a paid plan

- **What:** Run each buyer's copy on accounts Influvate owns and pays for: a paid cloud server in India per buyer, Influvate's own Firebase project, and Influvate's own domain.
- **Why:** Not a statute: an SLA cannot rest on a free tier, and a buyer's copy cannot sit in Fidato's accounts. Oracle's Always Free shape was halved on 15 June 2026 without notice and reclaims idle machines (`docs/MASTER-ARCHITECTURE.md` § 6).
- **Today:** Live runs on Oracle Always Free in Mumbai, the Firebase project `poms-fad05` (`.firebaserc`) and the domain `fidatohotels.com`. The Firebase Admin key is due for rotation (HANDOVER § 8).
- **Missing:** The owner confirms whose accounts these are today; Influvate opens its own; one copy per buyer on a paid plan; fresh keys per copy.
- **Effort:** M · **Who:** Owner, Code

#### A11 · Influvate's papers: agreement, SLA, data processing agreement

- **What:** A subscription agreement with an SLA and a support schedule; a data processing agreement (the hotel decides what is done with guest data, Influvate only processes it); an exit clause that returns and then deletes the buyer's data; Fidato Hotels' short written confirmation that Influvate owns the code and may sell it; Udyam (MSME) registration before the first contract; stamp duty on each agreement.
- **Why:** Now: the SPDI Rules let sensitive data go only to someone who keeps the same protection (rule 7) and require security practices (rule 8); IT Act s.72A punishes a contractor who discloses personal data. From 13 May 2027: DPDP Act s.8(2), a processor only "under a valid contract", with security terms (DPDP rule 6(1)(f)) and data and logs kept at least a year (rule 8(3)). A clause shortening the time to sue is void (Contract Act s.28), so cap liability instead; name the arbitration seat. MSMED Act s.15–16 (payment in 45 days) and Income-tax Act 2025 s.37(2)(g) protect a registered micro or small supplier; register before the contract.
- **Sources:** [DPDP Act 2023 (MeitY)](https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf) · [DPDP Rules 2025, G.S.R. 846(E)](https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf) · [SPDI Rules 2011 (gazette copy)](https://www.dataguidance.com/sites/default/files/in098en.pdf) · [MSME limits from 1 Apr 2025, S.O. 1364(E)](https://www.dcmsme.gov.in/Notification-S.O-no-1364-E-dated-21.03.2025-Revised-Definition.pdf) · [Udyam registration](https://udyamregistration.gov.in)
- **Today:** None of these exists. The master's draft privacy notice has blanks for the advisor (`docs/go-live/privacy-notice-draft.md`).
- **Missing:** All of it, drafted once and reused per buyer. The DPA's list is in the research notes: instructions only, no own use, security, breach notice to the hotel well inside 72 hours (6–24 hours given CERT-In's clock), help with guests' requests, sub-processors (Oracle, Google Firebase, Meta for WhatsApp, the email service), data kept in India, deletion at the end.
- **Effort:** M · **Who:** Lawyer, Owner

#### A12 · A privacy notice and a grievance contact for each buyer

- **What:** Finish the guest page's notice and a privacy policy, with each buyer's legal name and grievance officer filled in from settings, not typed into the code.
- **Why:** Now: SPDI rule 4 (a published privacy policy) and rule 5 (purpose, recipients, a grievance officer who answers within a month); the Aadhaar Act s.8A(3) (tell the guest the purpose and the alternatives). From 13 May 2027: DPDP s.5 and rule 3 (an itemised notice), rule 9 (a published contact) and rule 14 (how to make a request, answered within 90 days).
- **Sources:** [SPDI Rules 2011 (gazette copy)](https://www.dataguidance.com/sites/default/files/in098en.pdf) · [DPDP Rules 2025, rules 3, 9, 14](https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf)
- **Today:** The guest page has the notice's place and shows nothing until the advisor approves it (`src/modules/online-checkin/MODULE.md`, D21-61). No setting holds a company's legal name or grievance officer.
- **Missing:** The lawyer's final text; the per-buyer fields; the same notice at the desk (a printed line on the registration card).
- **Effort:** S · **Who:** Lawyer, Code

#### A13 · Influvate's own GST invoice to buyers

- **What:** Invoice the subscription at 18% under the right SAC: IGST for a buyer registered in another state, CGST + SGST in Influvate's own state; one invoice per buyer GSTIN; e-invoice if Influvate's turnover calls for it.
- **Why:** SAC 998315 fits a hosted, managed application (998313 support, 998314 implementation); 18% unchanged by Notification 15/2025-CT(Rate). Place of supply for a registered buyer is the buyer's location (IGST Act s.12(2)(a)). Turnover for e-invoicing counts everything under Influvate's PAN (CGST s.2(6)); above ₹5 crore in any year since 2017-18, B2B invoices must be e-invoices (10/2023-CT). A buyer with several state GSTINs would otherwise need an Input Service Distributor registration (since 1 April 2025).
- **Sources:** [Explanatory notes to the SAC scheme (998313–998315)](https://www.gstcouncil.gov.in/sites/default/files/2024-02/explanatory_notes_01oct19.pdf) · [IGST Act, s.12](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_IGST_Act/active/chapterv/section12_v1.00.html) · [CGST Act, s.2(6) aggregate turnover](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter1/section2_v1.00.html) · [Notification 10/2023-Central Tax (e-invoicing at ₹5 crore)](https://taxinformation.cbic.gov.in/view-pdf/1009732/ENG/Notifications)
- **Today:** Outside the code. Influvate is GST-registered (the owner, 25 September).
- **Missing:** The CA confirms the SAC, adds the service to Influvate's registration if needed, and says whether Influvate's own invoices must be e-invoices.
- **Effort:** S · **Who:** CA, Owner

#### A14 · Take Fidato out of the product, and file the new name

- **What:** Clear the 36 places the system names Fidato, starting with the three that write it into records, and search and file the new product name as a trade mark.
- **Why:** The owner's rule D21-27. A trade mark is filed in classes 9 (software) and 42 (SaaS), ₹4,500 per class for a small enterprise and ₹9,000 otherwise; ® may be used only after registration (Trade Marks Act 1999, s.107).
- **Sources:** [IP India, trade mark forms and fees](https://ipindia.gov.in/pages/trade-marks/learn/forms-and-official-fees) · [IP India public search](https://tmrsearch.ipindia.gov.in/tmrpublicsearch)
- **Today:** `docs/go-live/fidato-hard-wired.md` lists 36; re-checked on 25 September, unchanged (item 18 is now `src/modules/finance/pages/Invoices.tsx:310`). First three: the `FH-` booking reference written into every booking (`db/migrations/092_booking_reference.sql:84`); the "Fidato Hotels" booking source seeded into every copy and never deletable (`082_booking_sources.sql:241`); the name and logo with no setting behind them (`index.html`, `src/components/app/Sidebar.tsx:123`, `src/pages/SignIn.tsx`, `vite.config.ts:116-127`). Also the first admin `REPLACE@fidato.in` (`008_seed.sql:48`), the `x-fidato-secret` header (`api/src/sending.ts:162`), the reports' author (`api/src/reportRender.ts:167, 371`), and the GM guide's `pms.fidatohotels.com`.
- **Missing:** The two settings the list recommends (one in the web build, one row in the database), then the 36 fixes. The owner picks the name; the lawyer searches and files it.
- **Effort:** M · **Who:** Code, Owner, Lawyer

#### A15 · Open-source notices, and the product's own licence line

- **What:** Ship a list of third-party licences with the website, confirm three packages that carry no licence field, and state the product's own proprietary licence.
- **Why:** MIT, ISC and BSD require their notice in every copy; Apache-2.0 s.4 also its NOTICE file; the Inter font is under the SIL Open Font Licence. The JavaScript sent to every browser is a copy. Nothing here is copyleft: no GPL, LGPL or AGPL component is in the production build.
- **Sources:** [MIT licence](https://opensource.org/license/mit) · [Apache-2.0](https://spdx.org/licenses/Apache-2.0.html) · [AGPL-3.0 (for why it must stay out)](https://www.gnu.org/licenses/agpl-3.0.en.html)
- **Today:** Read from the lockfiles: the website 776 packages (210 in the build) and the API 418 (298). Production is MIT, Apache-2.0, ISC, BSD and 0BSD, plus the OFL font. `jszip` is "MIT or GPL-3.0" (take MIT). `lightningcss` (MPL-2.0) is a build tool only. `buffers`, `limiter` and `png-js` (inside `exceljs` and `pdfkit`) have no licence field. The repository has no LICENSE, NOTICE or third-party list, and `package.json` states no licence.
- **Missing:** A generated notices page, a one-line proprietary licence, and a check of the three. Keep AGPL and EUPL out: hosting alone triggers them.
- **Effort:** S · **Who:** Code, Lawyer

#### A16 · The FSSAI licence number on food bills

- **What:** Print each hotel's 14-digit FSSAI licence or registration number on the restaurant bill and on invoices carrying food.
- **Why:** FSSAI orders of 8 June 2021 and 30 September 2021, in force from 1 January 2022, repeated to hotels and restaurants on 13 September 2022. Menus also need the veg or non-veg mark and allergen information for every outlet, and calories for Central-licence or 10-plus-outlet businesses (FSS Labelling and Display Regulations 2020, reg 9).
- **Sources:** [FSSAI order, 13 Sep 2022](https://www.fssai.gov.in/docs/food-law/advisory/6320614d91afaOrder_License_Food_13_09_2022.pdf) · [FSS (Labelling and Display) Regulations 2020, compendium](https://www.fssai.gov.in/docs/food-law/regulations/Comp_Labelling%20Display_Version%20VIII_09_09_2025.pdf)
- **Today:** The restaurant bill prints the GSTIN only (`src/modules/pos/pages/Bill.tsx:194`); no FSSAI field exists. Dishes carry veg or non-veg (`is_veg`, `db/migrations/045_variations_and_addons.sql:127`); allergens are not recorded.
- **Missing:** An FSSAI number per hotel, printed; an allergen note per dish.
- **Effort:** S · **Who:** Code

### B · MUST before a buyer in another state or above a threshold (4)

Needed the day a buyer crosses a turnover line, runs rooms above ₹7,500, serves liquor, or sits in a state with its own rules.

#### B1 · E-invoicing (IRN and QR) for buyers above ₹5 crore

- **What:** For a buyer whose turnover crossed ₹5 crore in any year since 2017-18, report every invoice and credit note to a company guest with a GSTIN to the invoice portal, and print the IRN and signed QR. Above ₹10 crore, within 30 days.
- **Why:** CGST Rule 48(4) with Notification 13/2020-CT as amended by 10/2023-CT, from 1 August 2023; hotels are not exempt. A B2B invoice that should have been an e-invoice "shall not be a valid invoice" (Rule 48(5)). The 30-day limit for turnover of ₹10 crore or more applies from 1 April 2025. Two-step login on the e-invoice portal since 1 April 2025. Most multi-hotel groups are above ₹5 crore, so for them this is a MUST before the first sale.
- **Sources:** [Notification 10/2023-Central Tax, 10 May 2023](https://taxinformation.cbic.gov.in/view-pdf/1009732/ENG/Notifications) · [CGST Rules, Rule 48](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter6/rule48_v1.00.html) · [GSTN advisory, 5 Nov 2024 (30-day limit)](https://www.gst.gov.in/newsandupdates/read/543)
- **Today:** Not built, on the reasoning that the group is under ₹5 crore (`deploy/README.md:355`); the Invoices screen says so in Fidato's name (`src/modules/finance/pages/Invoices.tsx:310`).
- **Missing:** A per-buyer switch; a connection to the invoice portal (through a GST Suvidha Provider or the portal's API); IRN and QR on the invoice and credit note; cancellation inside 24 hours; a 30-day warning.
- **Effort:** L · **Who:** Code, CA

#### B2 · Liquor tax differs by state

- **What:** Let each hotel say whether VAT is charged on the bar bill or was already paid on the stock, and print the hotel's VAT registration and liquor licence numbers on the VAT bill.
- **Why:** Liquor is outside GST (Constitution Art. 366(12A)). Maharashtra: VAT at the bar is 10% of the sale price for 3-star and below and clubs (VAT-1523/C.R.47/Taxation-1, 19 Oct 2023, from 1 Nov 2023) and 20% for 4-star and above (VAT-1511/C.R.57, 30 Apr 2011, read through a transcription). Uttar Pradesh (UPVAT Schedule IV, 32.5% at the maker or importer) and Himachal (HP VAT Schedule D, 12.5% at the first purchase) appear to collect VAT before the bar, so a bar bill there would carry **no VAT line**. The only primary schedules for UP and HP date from 2015 and about 2014; a local CA must confirm.
- **Sources:** [Maharashtra, 19 Oct 2023 notification](https://www.mahagst.gov.in/public/uploads/mvatservices/1760429297LIQUOR%20NOTIFICATION.pdf) · [Maharashtra, 30 Apr 2011 notification](https://www.mahagst.gov.in/public/uploads/mvatservices/KNOW_NOTIFI_MVAT_05_02_11_7_12_57PM.pdf) · [UP VAT schedule (to 12 Mar 2015)](https://comtax.up.nic.in/Vat_Act/UPVAT%20SCHEDULE%20Updated%20upto%20dt%2012-03-2015.pdf) · [HP VAT schedule](https://www.hptax.gov.in/ckfinder/userfiles/files/schedule.pdf)
- **Today:** One VAT rate per hotel, typed by an accountant, never seeded; a separate VAT bill with its own yearly series (D21-90, D21-91, D22-44; `db/migrations/125_alcohol_and_vat.sql`, `135_a_vat_bill_for_alcohol.sql`; `src/modules/finance/pages/VatBill.tsx`). The VAT bill prints no VAT or TIN number and no licence number.
- **Missing:** The "VAT-paid stock" choice, the two numbers, and each state's CA confirmation before a hotel there serves liquor.
- **Effort:** S · **Who:** CA, Code

#### B3 · Guest-register rules set by each state or district

- **What:** A printed guest registration card, and extra register fields a hotel can switch on for its state or district, with an export where the police run a portal.
- **Why:** No national law makes Indian guests show ID; the duty comes from state tourism rules, the Sarais Act 1867 where still applied, police Acts, and district orders under BNSS s.163 that last two months unless extended. Himachal's Tourism Trade Rules 2012, rule 13(2) and Annexure A, prescribe the register (arrival and departure times, persons, nationality, arrived from, rate, advance, signature) and forbid letting a room before the entry is made. Gujarat's police require live upload to "Pathik". A 2026 Raigad (Maharashtra) order asks purpose, vehicle and records kept two years (primary order not read).
- **Sources:** [HP Tourism Development and Registration of Tourism Trade Rules 2012](https://himachaltourism.gov.in/wp-content/uploads/2018/09/58e76f88225c2_H.P.-Tourism-Trade-Rules-2012.pdf) · [Navsari district Pathik notification (scanned)](https://navsari.nic.in/document/pathik-app-notification/)
- **Today:** Check-in records ID type and number, address and nationality (`src/modules/front-desk/flows/CheckInFlow.tsx`). There is no registration card print, although D21-18 speaks of one, and no purpose, arrived from, going to, vehicle, number of persons or signature.
- **Missing:** The card; the optional fields; a retention period per hotel (C4); an export for Pathik-style portals when a buyer needs one. Each buyer names its local order.
- **Effort:** M · **Who:** Code, Owner

#### B4 · The restaurant's rate follows "specified premises", year by year

- **What:** Tell each hotel before 1 April whether its restaurant must charge 18% with credit next year, and remind it of the January to March declaration window.
- **Why:** From 1 April 2025 a premises is "specified" for a financial year if any unit was sold above ₹7,500 on any day of the year before, or it opted in (Annexure VII, 1 January to 31 March; Annexure VIII on new registration). Its restaurant then charges 18% with credit instead of 5% without (Notification 05/2025-CT(Rate); explanations added by 15/2025-CT(Rate)). The opt-out form is still not on the portal.
- **Sources:** [Notification 05/2025-Central Tax (Rate), 16 Jan 2025](https://taxinformation.cbic.gov.in/view-pdf/1010273/ENG/Notifications) · [Notification 15/2025-Central Tax (Rate), 17 Sep 2025](https://taxinformation.cbic.gov.in/view-pdf/1010453/ENG/Notifications) · [GSTN advisory, 4 Jan 2026 (declarations online)](https://www.gst.gov.in/newsandupdates/read/645)
- **Today:** The restaurant rate is typed per hotel on the tax card (`src/modules/finance/flows/TaxRulesCard.tsx`, `db/migrations/067_tax_rules.sql`), which is the right shape. Nothing tells the hotel it crossed ₹7,500.
- **Missing:** A year-end check from the room charges ("a room was sold above ₹7,500 on <date>") per premises, and the January reminder.
- **Effort:** S · **Who:** Code, CA

### C · SHOULD (9)

Buyers and their CAs will ask for these, or a law switches them on in 2027. Build them in the first months of selling.

#### C1 · GST return reports a CA can file from

- **What:** One screen per month and GSTIN: B2B invoices, B2C by rate, credit notes, advances, the HSN summary split B2B and B2C, and documents issued (series, from–to, cancelled), restaurant sales included.
- **Why:** GSTR-1 (CGST Rule 59), tables 4, 7, 9, 11, 12 and 13. Table 12's B2B/B2C split and Table 13 are mandatory from the May 2025 period. GSTR-3B's tax is locked to GSTR-1 since the July 2025 period, and from February 2026 the portal splits liability by invoice date, so a late invoice now carries interest automatically.
- **Sources:** [CGST Rules, Rule 59](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter8/rule59_v1.00.html) · [GSTN advisory, 1 May 2025 (Table 12 and 13)](https://www.gst.gov.in/newsandupdates/read/597) · [GSTN advisory, 7 Jun 2025 (GSTR-3B locked)](https://www.gst.gov.in/newsandupdates/read/606) · [GSTN advisory, 16 Mar 2026 (liability by invoice date)](https://www.gst.gov.in/newsandupdates/read/653)
- **Today:** A GST sales register, invoice by invoice (`api/src/modules/reports/reports.ts:310`), and the Lodging tax sheet. No B2B/B2C split, HSN summary or documents-issued table; restaurant sales are absent (A2). The CA question page asks the same (F5).
- **Missing:** The report and an Excel file in the order of the GSTR-1 tables.
- **Effort:** M · **Who:** Code, CA

#### C2 · Advances: a receipt voucher, GST at receipt, a refund voucher

- **What:** When an advance is taken for a stay or an event, issue a numbered receipt voucher with its tax; when it is returned without a stay, a refund voucher.
- **Why:** For services, GST is due on the earlier of invoice or payment (CGST s.13(2)); a receipt voucher is required (s.31(3)(d), Rule 50) and a refund voucher when no supply follows (Rule 51); a separate account of advances (Rule 56(3)); GSTR-1 Table 11.
- **Sources:** [CGST Act, s.13](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter4/section13_v1.00.html) · [CGST Rules, Rule 50](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter6/rule50_v1.00.html) · [CGST Rules, Rule 51](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter6/rule51_v1.00.html)
- **Today:** An advance is a payment on the booking (`api/src/modules/finance/postings.ts`); no voucher and no tax on it. The CA question page asks this (B5).
- **Missing:** The CA's answer, then the two vouchers and their series (16 characters, A4).
- **Effort:** M · **Who:** CA, Code

#### C3 · Deadlines the system can watch

- **What:** Warn when a departed stay has had no tax invoice for 25 days, and refuse a credit note after the legal date.
- **Why:** A service invoice within 30 days of the supply (Rule 47). A credit note no later than 30 November after the financial year ends, or the annual return if earlier (CGST s.34); since 1 October 2025 the supplier's tax falls only if a registered company reverses its credit, and a company that rejects a credit note in the Invoice Management System puts the hotel's liability back.
- **Sources:** [CGST Rules, Rule 47](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter6/rule47_v1.00.html) · [CGST Act, s.34](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter7/section34_v1.00.html)
- **Today:** The Invoices screen lists departed stays waiting for an invoice with no clock (`src/modules/finance/pages/Invoices.tsx`); credit notes have no date limit (`api/src/modules/finance/invoices.ts`).
- **Missing:** The two checks.
- **Effort:** S · **Who:** Code

#### C4 · Keep guest data as long as the law needs, then erase it

- **What:** A retention period per kind of data per hotel, and a nightly job that blanks ID numbers, passport details and addresses once it passes, in the change log and backups too.
- **Why:** Now: Aadhaar numbers may not be kept longer than the purpose (Sharing Regulations reg 6(5)), nor sensitive data (SPDI rule 5(4)). From 13 May 2027: erase once the purpose is served unless a law needs it (DPDP s.8(7)), and keep data and logs at least a year (rule 8(3)). Floors: GST records 72 months after the annual return's due date (s.36; FY 2025-26 until 31 December 2032); Form III at least a year; local police orders (two years in Raigad). GST also needs a log of every edited or deleted entry (Rule 56(8)), so erase by blanking fields, not deleting rows.
- **Sources:** [DPDP Act 2023, s.8(7)](https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf) · [CGST Rules, Rule 56](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter7/rule56_v1.00.html)
- **Today:** Nothing is ever erased: `guest_documents` refuses deletion by design (`db/migrations/026_identity_capture.sql:53-58`, "Correct it; do not erase it"), and `audit_log` keeps every before-and-after for good (`011_model_additions.sql:278`).
- **Missing:** The periods (the lawyer sets them, D21-11 is part of it), the job, and a way to carry erasure into backups (short backup retention is the usual answer).
- **Effort:** L · **Who:** Lawyer, Code

#### C5 · Ready for the data protection law by 13 May 2027

- **What:** An itemised notice; consent records that say who agreed, when and to which notice; marketing only with opt-in consent; a request tracker with a 90-day clock that also lists who the data was shared with; a breach workflow (guests without delay, the Board within 72 hours, CERT-In within 6); a year of logs of who viewed guest data; a minor flag tied to the parent's consent.
- **Why:** DPDP Act 2023 and DPDP Rules 2025 (G.S.R. 846(E), 13 November 2025): rules 3, 5–16 and the Act's duties start 18 months later, 13 May 2027 (14 May by PIB's count). MeitY floated bringing everything to 13 November 2026 in January 2026; nothing has been notified. Penalties up to ₹250 crore (security) and ₹200 crore (breach notice, children). The notice must be available in English or any Eighth Schedule language (s.5(3)).
- **Sources:** [DPDP Rules 2025, G.S.R. 846(E)](https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf) · [Commencement, G.S.R. 843(E), 13 Nov 2025](https://www.meity.gov.in/static/uploads/2025/11/c56ceae6c383460ca69577428d36828b.pdf) · [DPDP Act 2023](https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf)
- **Today:** "Do not send me offers" is an opt-out held against the phone or email (`offer_opt_outs`, `db/migrations/122_one_guest_one_record.sql` § 7, D21-22), so offers go to everybody else by default. The WhatsApp tick is a yes or no on the booking with no time or notice version (122 § 9). Writes are logged; reads are not. Nothing tracks requests, breaches or minors.
- **Missing:** All of the above. The marketing switch to opt-in changes the owner's D21-22 and needs the owner's decision.
- **Effort:** L · **Who:** Code, Lawyer, Owner

#### C6 · Encrypt ID numbers, and keep them out of the change log

- **What:** Store ID, passport and visa numbers encrypted, and record in the change log that they changed, not what they are.
- **Why:** Encryption, masking or tokens by name in DPDP rule 6(1)(a) from 13 May 2027; reasonable security under SPDI rule 8 now; Aadhaar numbers sent over a network only encrypted (Sharing Regulations reg 6(4)).
- **Sources:** [DPDP Rules 2025, rule 6](https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf)
- **Today:** Plain text in `guest_documents` (013) and `guest_detail_submissions` (121); `pgcrypto` is installed for ids only (`001_foundation.sql:12`); every change copied whole into `audit_log`.
- **Missing:** Column encryption with the key outside the database, and a redacting audit trigger for those columns.
- **Effort:** M · **Who:** Code

#### C7 · What a buyer's IT or security team will ask for

- **What:** A yearly security test by a CERT-In empanelled auditor; two-step sign-in for owners and admins (and for n8n); the Firebase key rotated; a Content-Security-Policy and HSTS; an SBOM per release and patch deadlines; ISO/IEC 27001:2022 when a buyer insists.
- **Why:** A security test by an empanelled auditor is a market expectation for hotels (a legal duty only for RBI-regulated and government bodies); CERT-In's July 2025 audit guidelines govern how such audits run. ISO 27001 is named in SPDI rule 8 until 13 May 2027; all 2013-version certificates lapsed on 31 October 2025. CISG-2026-03 (10 June 2026) asks software vendors for SBOMs and patch timelines.
- **Sources:** [CERT-In empanelled auditors (current list)](https://www.cert-in.org.in/PDF/Empanel_org.pdf) · [CERT-In Comprehensive Cyber Security Audit Policy Guidelines, 25 Jul 2025](https://www.cert-in.org.in/PDF/Comprehensive_Cyber_Security_Audit_Policy_Guidelines.pdf) · [CERT-In SBOM technical guidelines v2.0, 9 Jul 2025](https://www.cert-in.org.in/PDF/TechnicalGuidelines-on-SBOM,QBOM&CBOM,AIBOM_and_HBOM_ver2.0.pdf)
- **Today:** The API sends `X-Content-Type-Options` and `Referrer-Policy` only (`deploy/nginx.conf:159-160`); the website adds `X-Frame-Options` and `noindex` (`firebase.json`); no CSP or HSTS header is set by either. Two-step sign-in is recommended for n8n and not yet on (D21-96). The Firebase Admin key rotation is still owed (HANDOVER § 8). The guest page is rate-limited (`deploy/nginx.conf:49`).
- **Missing:** The headers, two-step sign-in, the key rotation, an SBOM from the lockfiles at each release, and a first security test before the first buyer goes live.
- **Effort:** M · **Who:** Code, Owner

#### C8 · TDS taken off hotel bills

- **What:** Let a company or OTA receipt carry "TDS deducted" so the bill closes, and list it for the CA to match against Form 168.
- **Why:** Under the Income-tax Act 2025 every TDS rule is one table in s.393: an OTA deducts 0.1% of the gross booking (Sl. 8(v), was 194-O); commission 2% (was 194H); a company booking rooms regularly may treat it as rent (Circular 5/2002 under the old Act; not re-verified under the new one). Certificates are now Form 131 (was 16A), statements Form 140 (was 26Q), the annual statement Form 168 (was 26AS).
- **Sources:** [Income-tax Act 2025, s.393 (CBDT)](https://www.incometaxindia.gov.in/w/section-393-6)
- **Today:** Nothing records TDS; company accounts show balances only (the city ledger).
- **Missing:** A TDS line on a receipt, and a quarterly list. The CA question page asks the section (G2).
- **Effort:** M · **Who:** Code, CA

#### C9 · Setting up a new buyer, and letting one go

- **What:** One runbook (or script) that brings up a buyer's copy with its own name, logo, domain and reference prefix; a GM guide without Fidato's address; a support routine and a status page; an export of all the buyer's data at the contract's end, then deletion.
- **Why:** The contract and the data processing agreement (A11) promise all of it; DPDP s.8(7)(b) makes the processor erase at the end.
- **Today:** Eight manual steps (`deploy/README.md`): the server, the Oracle ports, DNS, a Firebase service account, email sign-in, linking each person, building with `API_URL`, the provisioning key; a ten-check `npm run preflight` (`api/scripts/preflight.ts`). The GM guide (`docs/go-live/gm-setup-guide.md`) names `pms.fidatohotels.com` and "the owner". No export beyond `pg_dump`.
- **Missing:** The runbook, the per-buyer settings (with A14), the export.
- **Effort:** M · **Who:** Code, Owner

### D · LATER (6)

Only if the business changes: online payments, government buyers, very large groups, more languages.

#### D1 · If payments are ever taken online

- **What:** Each hotel uses its own merchant account with an RBI-authorised payment aggregator; card details are entered on the aggregator's page; the system keeps a token and the last four digits only; Influvate never holds guests' money.
- **Why:** Collecting and settling money for others is payment-aggregator business: RBI authorisation and ₹15 crore net worth (Master Direction RBI/DPSS/2025-26/141, 15 September 2025). No one but the card issuer and network may store card data, from 1 October 2022. Two-factor authentication for domestic digital payments from 1 April 2026, cross-border card-not-present from 1 October 2026. A UPI merchant fee of 0.4% above ₹2,000 (capped at ₹300) is announced for 15 October 2026 and is being challenged.
- **Sources:** [RBI Master Direction on Payment Aggregators, 15 Sep 2025](https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=12896) · [RBI CoF tokenisation, 7 Sep 2021](https://rbi.org.in/Scripts/NotificationUser.aspx?Id=12159&Mode=0) · [RBI Authentication Directions 2025, 25 Sep 2025](https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12898&Mode=0) · [NPCI FAQ on UPI MDR, 15 Sep 2026](https://www.npci.org.in/uploads/FA_Qs_Merchant_Discount_Rate_MDR_on_Select_UPI_P2_M_Transactions_58dba1d39e.pdf)
- **Today:** No gateway, by the owner's decision (finance `MODULE.md`). Payments record the method and at most the card's last four (`011_model_additions.sql:262`); the channel manager strips card fields from OTA payloads (`api/src/modules/channel-manager/inbound/scrub.ts:29`).
- **Missing:** Nothing now.
- **Effort:** L · **Who:** Owner, Code

#### D2 · Verifying Aadhaar through the Aadhaar App

- **What:** If a buyer wants Aadhaar checked electronically, the hotel itself registers with UIDAI as an offline-verification entity; the system reads the verified credential (last four digits, name, photo) and never the number.
- **Why:** Since 9 December 2025, verification through the Aadhaar App needs the entity's own registration (reg 13A), and verification "on behalf of another entity" is barred (reg 16A(2)), so Influvate cannot run it for hotels. UIDAI lists hospitality as the first use case.
- **Sources:** [UIDAI, OVSE registration](https://uidai.gov.in/en/ovse)
- **Today:** Not built.
- **Missing:** Only on a buyer's request, after A1.
- **Effort:** M · **Who:** Code, Lawyer

#### D3 · Other languages

- **What:** Staff screens in a hotel's language, as decided (D21-99, D21-100); the privacy notice in any of the Eighth Schedule languages on request, from 13 May 2027.
- **Why:** DPDP s.5(3). Bills, tax invoices and Form III stay in English, which the rules allow.
- **Today:** English only (D21-73).
- **Missing:** The notice's translations first (C5); the screens when the owner decides.
- **Effort:** L · **Who:** Owner, Code

#### D4 · Government and PSU hotel buyers

- **What:** A security audit certificate from a CERT-In empanelled auditor, a MeitY-empanelled cloud, a GeM listing, and 2% GST TDS on contracts above ₹2.5 lakh.
- **Why:** Their procurement rules and CGST s.51.
- **Sources:** [CGST Act, s.51](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter10/section51_v1.00.html)
- **Today:** Not relevant yet.
- **Missing:** Only if such a buyer appears.
- **Effort:** M · **Who:** Owner

#### D5 · Very large buyers: a payment QR on B2C invoices

- **What:** A dynamic UPI QR on every B2C invoice for a group above ₹500 crore turnover.
- **Why:** Notification 14/2020-CT, as amended.
- **Sources:** [Notification 14/2020-Central Tax](https://taxinformation.cbic.gov.in/view-pdf/1000622/ENG/Notifications)
- **Today:** Not built.
- **Missing:** Only for such a buyer.
- **Effort:** M · **Who:** Code

#### D6 · SMS

- **What:** If guest messages ever go by SMS, register the sender on the telecom operators' DLT platform with approved templates.
- **Why:** TRAI's commercial-communication regulations (TCCCPR 2018, amended 12 February 2025). The Telecom Cyber Security Amendment Rules of 22 October 2025 may, on a direction, reach a business that identifies people by mobile number.
- **Sources:** [TRAI TCCCPR amendment, 12 Feb 2025](https://trai.gov.in/sites/default/files/2025-02/Regulation_12022025.pdf)
- **Today:** Messages go by WhatsApp and email through n8n (`api/src/sending.ts`); no SMS.
- **Missing:** Nothing now.
- **Effort:** S · **Who:** Owner

## Already right — keep it that way

| What | Rule / where |
|---|---|
| Tax follows the hotel's state: CGST + SGST, never IGST | IGST Act s.12(3)(b); `db/migrations/025_invoices_form_c.sql`, `api/src/modules/finance/invoices.ts` |
| The room's rate is picked from the actual value per night, at 5% up to ₹7,500 and 18% above; no rate is ever assumed | Notification 15/2025-CT(Rate) (22 Sep 2025); `067_tax_rules.sql`, `136_no_default_gst_rate.sql` |
| An issued invoice is never edited; a credit note with its own number corrects it | `025`; the Invoice page states it |
| Every change is logged and the ledger only grows | CGST Rule 56(8) asks for a log of every edited or deleted entry; `011`, `016`, `006`, `014`, `021` |
| No service charge exists anywhere | CCPA guidelines, 4 Jul 2022, upheld by the Delhi High Court on 28 Mar 2025; the CCPA fined a restaurant on 29 Dec 2025 for billing software that added one by default. `api/src/modules/reports/builders/lodgingTax.ts:163` |
| Liquor stays off the GST invoice, with its own VAT bill and series | Constitution Art. 366(12A); D21-91, D22-44 |
| A no-show retention is charged like the room | Circular 178/10/2022-GST |
| Each hotel has its own invoice series, restarting each 1 April | `025`, `138` |
| Every hotel's data is walled off from the others; every write asks the role | Row security; `api/src/roleGate.ts` |
| The guest's page keeps only hashes and unlocks one phone for an hour | `src/modules/online-checkin/MODULE.md` |
| No card number is stored, and OTA card fields are stripped on arrival | RBI CoF rules; `api/src/modules/channel-manager/inbound/scrub.ts` |
| The database and API are in India (Oracle, Mumbai) | `START-HERE.md` |
| No copyleft licence in the production build | Lockfile check, 25 Sep 2026 |

## Timeline

### In force already

| Date | What |
|---|---|
| 1 Jan 2022 | FSSAI number on every food bill |
| 27 Jun 2022 | CERT-In Directions in force (MSMEs from 25 Sep 2022): 6-hour reporting, 180-day logs, clock sync |
| 4 Jul 2022 | CCPA service charge guidelines; upheld by the Delhi High Court on 28 Mar 2025, appeal pending |
| 1 Oct 2022 | No merchant may store card data |
| 1 Aug 2023 | E-invoicing for turnover above ₹5 crore |
| 30 Nov 2023 | CERT-In fine raised to ₹1 crore |
| 1 Apr 2025 | "Specified premises" redefined; 30-day e-invoice reporting at ₹10 crore; two-step login on the e-invoice portal |
| May 2025 | GSTR-1 Table 12 split B2B/B2C and Table 13 mandatory |
| 1 Jun 2025 | E-invoice numbers treated as case-insensitive |
| Jul 2025 | GSTR-3B tax locked to GSTR-1 |
| 1 Sep 2025 | Immigration and Foreigners Act 2025 and Rules: Form III, arrival and departure within 24 hours |
| 15 Sep 2025 | RBI Master Direction on payment aggregators |
| 22 Sep 2025 | GST rates: rooms up to ₹7,500 at 5% without credit (mandatory), spa 5%, laundry 18% |
| 1 Oct 2025 | Credit notes reduce tax only when the company reverses its credit |
| 13 Nov 2025 | DPDP Rules notified; the Data Protection Board established (no members yet) |
| 1 Dec 2025 | Returns barred three years after their due date |
| 9 Dec 2025 | Aadhaar: registration needed for app-based verification |
| Feb 2026 | GSTR-3B liability split by invoice date |
| 1 Apr 2026 | Income-tax Act 2025 and Rules 2026: cash ban s.186, PAN above ₹1 lakh cash (Rule 159), new form numbers; RBI two-factor rule for domestic payments |
| 10 Jun 2026 | CERT-In guidance to software vendors (CISG-2026-03) |

### Coming (after 25 September 2026)

| Date | What |
|---|---|
| 1 Oct 2026 | RBI two-factor rule for cross-border card-not-present payments |
| 7 Oct 2026 | 57th GST Council meeting (agenda only) |
| 15 Oct 2026 | UPI merchant fee (announced, challenged) |
| 31 Oct 2026 | Form 98 due from audited hotels for Form 97s received April to September |
| 13 Nov 2026 | DPDP: consent managers. **All DPDP duties too, if MeitY's January 2026 proposal is notified** (not notified as of 6 Sep 2026) |
| 30 Nov 2026 | Last day for credit notes on FY 2025-26 supplies |
| 31 Dec 2026 | GSTR-9 and 9C for FY 2025-26 |
| 1 Jan – 31 Mar 2027 | Window to opt a premises in as "specified" for FY 2027-28 |
| 13 May 2027 | DPDP: every hotel duty and the processor contract; IT Act s.43A and the SPDI Rules end (14 May by PIB's count) |
| 31 Aug 2028 | End of the Immigration Act's window for "removal of difficulties" orders |

### Announced, no date

- UIDAI's ban on keeping Aadhaar photocopies (announced December 2025, not notified)
- Finance Act 2026 s.153–154: post-sale discounts and their credit notes (start date not notified)
- The specified-premises opt-out form (Annexure IX) on the GST portal
- GSTR-1 HSN table, phase 4
- An e-invoice threshold below ₹5 crore: talked about, not announced
- The Digital India Act: no bill
- IT Rules draft Second Amendment 2026 (comments closed 7 May 2026)
- Delhi High Court Division Bench appeal on service charge
- Supreme Court challenge to the DPDP Act, W.P.(C) 177/2026 (no stay)

## Open questions

### For the owner (each with a recommendation)

1. **Aadhaar (A1).** Your D21-17 keeps the full number; the Aadhaar Act forbids it. *Recommended:* last four digits only, from now, and scrub what is stored, before Fidato's own first real day too.
2. **Marketing consent (C5).** Your D21-22 sends offers unless a guest opts out; the DPDP law asks for opt-in from 13 May 2027. *Recommended:* switch to opt-in before selling, so no buyer's list has to be rebuilt later.
3. **Fidato's own copy.** Stay on Fidato's accounts, or move to Influvate's hosting with the same agreement and DPA as any buyer? *Recommended:* move it and sign the same papers; it becomes the reference customer.
4. **Whose accounts** are the Oracle server, the Firebase project `poms-fad05`, the GitHub repository and `fidatohotels.com` today? *Recommended:* Fidato's stay Fidato's; Influvate opens its own for buyers.
5. **Influvate's own use of buyers' data** (the CRS, marketing, analytics). *Recommended:* never. Any own use makes Influvate a data fiduciary with its own duties, and buyers' lawyers will refuse it.
6. **Support**: hours, who answers, how fast (it goes into the SLA). *Recommended:* 9:00 to 21:00 IST, seven days, with an emergency number for "cannot check in or bill".
7. **Cash of ₹2 lakh or more (A6)**: refuse, or warn? *Recommended:* refuse; the penalty equals the amount.
8. **The price per property per year**, for the CA's registration, TDS and e-invoice answers.

### For the CA

1. Influvate: SAC 998315 (or 998439) for the subscription; whether Influvate's PAN-wide turnover makes its own invoices e-invoices; Udyam status; which TDS rate buyers will deduct (2% or 10% under s.393) and whether to seek a lower-deduction certificate (s.395).
2. The invoice number format within 16 characters (A4), and whether numbers already issued anywhere need a note.
3. Restaurant sales (A2): a tax invoice per bill, or a daily consolidated invoice for bills under ₹200.
4. A SAC per line on a stay's invoice (A5), and the legal name to print per GSTIN.
5. Advances (C2): GST at receipt, receipt and refund vouchers.
6. UP and Himachal liquor (B2): is any VAT charged on the bar bill?
7. Form 98: which hotels file it (Rule 160 names "section 58", Rule 237 "section 63").
8. Whether regular corporate room bookings are "rent" for TDS under the new Act (C8).
9. The 49 questions already on the [CA question page](https://claude.ai/artifact/U3czHHj4zrdURCzpGNkwVz).

### For the lawyer

1. Aadhaar: confirm s.8A(4)(b) forbids keeping the full number, and what to do with numbers already stored (A1).
2. The subscription agreement, SLA, data processing agreement, privacy policy, guest-page notice and terms (A11, A12).
3. Fidato Hotels' written confirmation that Influvate owns the code and may sell it.
4. Is a hosted hotel system an "intermediary" under IT Act s.2(1)(w), bringing the IT Rules 2021's basic duties?
5. Children: does registering a minor need verifiable parental consent (DPDP s.9), and what for a minor checking in alone?
6. The legal basis for Indian guests' ID: "voluntarily provided" (s.7(a)) or a legal duty to the State (s.7(d))?
7. Retention periods per kind of data (C4), including the ID-photo rule D21-11.
8. Trade mark search and filing for the new name (classes 9, 42; 35 optional).
9. Stamp duty: which article of the Maharashtra Stamp Act (5(h)(A)(iv) or 5(h)(B)) and of other buyers' states.
10. May Influvate host a hotel's Aadhaar-verification callback, given reg 16A(2)?
11. Staff sign-in records held by Google outside India against CERT-In FAQs Q35 and Q36.

---

The five research notes behind this report (GST, income tax and Form III, data protection and Aadhaar, CERT-In and payments, selling software) are in `docs/selling-in-india/`, with every source and a confidence level per rule.
