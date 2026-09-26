# Indian GST and hotel-billing law: research for the PMS audit

As of **25 September 2026**. This is web research only: no legal opinion, and nothing here replaces a CA's sign-off.

## How to read this

- **Format of each point:** the rule — its source (number and date) — a link — its status — confidence, with the reason.
- **Where the notification and circular texts came from:** the CBIC tax portal (taxinformation.cbic.gov.in). I checked the notification and circular numbers against the portal's own index.
  - `view-pdf/<id>/ENG/Notifications` links open the portal's PDF viewer.
  - Act and Rules links point to CBIC's consolidated HTML. Those pages carry amendment footnotes up to the Finance Act 2026.
- **Where the GSTN advisories came from:** the live GST portal news feed, read on 25 Sep 2026. The feed's last entry is dated 19 Sep 2026.
- **Recent-change check:** CBIC's lists show no GST-related Central Tax (Rate) notification after 01/2026-CT(Rate) (30 Apr 2026). The only 2026 GST circulars are 255/01/2026 and 256/02/2026, and neither is about hotels. So the hotel rates below are the 22 Sep 2025 position.
- **The GST Council:** it has not met since the 56th meeting (3 Sep 2025). The 57th meeting is due on **7 Oct 2026** (see §10).

---

## 1. Hotel accommodation after the 56th GST Council (effective 22 Sep 2025)

- **Rate for rooms at or below ₹7,500:** hotel accommodation with a *value of supply* of **₹7,500 or less per unit per day, or equivalent**, is taxed at **2.5% CGST + 2.5% SGST (5%), without ITC**.
  - This is Notification 11/2017-CT(Rate), Sl. 7(i), as amended by **Notification 15/2025-Central Tax (Rate), 17 Sep 2025**. The companion notifications are 15/2025-Integrated Tax (Rate) and 15/2025-Union Territory Tax (Rate).
  - Link: https://taxinformation.cbic.gov.in/view-pdf/1010453/ENG/Notifications
  - Status: in force since **22 Sep 2025**. Before that date the rate was 12% with ITC.
  - Confidence: **high**. I read the notification text.
- **The 5% rate cannot be declined.** 15/2025-CT(Rate) inserts "(i)" into Explanation (a) of Sl. 7(vi). That makes the item (i) rate a "mandatory rate", so a hotel cannot choose 18% with ITC for these rooms.
  - Same source. Confidence: **high**.
- **What "without ITC" means:**
  - ITC on inputs used only for these rooms may not be taken.
  - ITC on common inputs must be reversed as if these rooms were an exempt supply, under s.17(2) and Rules 42/43.
  - Source: 11/2017-CT(Rate), para 4, Explanation (iv) (principal notification: https://taxinformation.cbic.gov.in/view-pdf/1000997/ENG/Notifications).
  - Confidence: **high**.
  - For a hotel that has both room slabs, the software or the CA needs a split of input costs by slab.
- **Rooms above ₹7,500:** these fall under Sl. 7(vi), "Accommodation, food and beverage services other than (i) to (v)". The rate is **9% CGST + 9% SGST (18%), with ITC**.
  - Explanation (c) to Sl. 7(vi) names hotel accommodation above ₹7,500 per unit per day as covered.
  - Source: Notification 20/2019-CT(Rate), 30 Sep 2019 (https://taxinformation.cbic.gov.in/view-pdf/1000907/ENG/Notifications). The 56th Council did not change this.
  - Confidence: **high**.
- **There is no longer a ₹1,000 floor.** 03/2022-CT(Rate), 13 Jul 2022, removed the words "above one thousand rupees but" from Sl. 7(i). So every room from ₹0 to ₹7,500 is now at 5%.
  - Link: https://taxinformation.cbic.gov.in/view-pdf/1009433/ENG/Notifications
  - Confidence: **high**.
- **The ₹7,500 test uses the actual value, not the published tariff.** The test is "value of supply of a unit of accommodation … per unit per day or equivalent", which is the transaction value.
  - "Declared tariff" stopped being the test from 1 Oct 2019 (20/2019-CT(Rate)).
  - The definition of declared tariff itself, clause (xxxv), was omitted from **1 Apr 2025** by 05/2025-CT(Rate) (https://taxinformation.cbic.gov.in/view-pdf/1010273/ENG/Notifications).
  - Under CGST Act s.15(3)(a), a discount shown on the invoice at or before supply reduces the value.
  - Confidence: **high**.
- **Extra bed:** Circular 27/01/2018-GST (4 Jan 2018), FAQ 1, says the rate follows the room and GST applies to the whole amount including the extra bed. Its example: a ₹7,000 declared tariff plus an extra bed making ₹8,000 was taxed at 18% on ₹8,000.
  - That circular was written for the old *declared-tariff* test. Under today's value-of-supply test, the extra-bed charge billed for the unit is part of that unit's value. So a unit that crosses ₹7,500 with the extra bed moves to 18%.
  - Link: https://taxinformation.cbic.gov.in/view-pdf/1003039/ENG/Circulars
  - Confidence: **medium**. This is my reading of how the circular applies under the new test; CBIC has not re-clarified it.
- **Packages (room with meals, etc.):** a composite supply is taxed at the rate of its principal supply (CGST Act s.2(30) and s.8(a)). A room-plus-breakfast package is taxed as accommodation.
  - Link: https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter2/section8_v1.00.html
  - Confidence: **high** on the principle. It is **unresolved** whether the ₹7,500 test uses the whole package price or only the room element (see Unresolved list).
- **Cancellation, no-show and retention charges:** these are consideration for the principal supply. Forfeited or retained amounts on a hotel booking are taxed "at the same rate as applicable to the service contract".
  - Source: **Circular 178/10/2022-GST, 3 Aug 2022**, paras 7.1.6 and 11 to 11.4.
  - Link: https://taxinformation.cbic.gov.in/view-pdf/1003115/ENG/Circulars
  - Confidence: **high**.
  - Practical consequence: the rate follows the booked unit's slab, 5% or 18%.
- **Complimentary items:**
  - If nothing is charged, there is no supply (s.7), unless the parties are related (Schedule I).
  - Complimentary breakfast inside a room rate is part of the composite supply.
  - ITC on goods given away as gifts is blocked by s.17(5)(h).
  - Confidence: **medium**. This is reasoned from the Act; I found no hotel-specific circular.
- **Place of supply is always the hotel's location**, so hotel lodging is always CGST+SGST (intra-state), even for guests from other states.
  - Source: IGST Act s.12(3)(b), and s.12(3)(c) for function venues.
  - Link: https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_IGST_Act/active/chapterv/section12_v1.00.html
  - Confidence: **high**.
- **Bookings that straddle the 22 Sep 2025 rate change** are governed by CGST Act s.14, which ties the time of supply to supply date, invoice date and payment date. There is a 4-working-day bank-credit proviso.
  - Link: https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter4/section14_v1.00.html
  - Confidence: **high**.
- **GST Council FAQ, 56th meeting (3 Sep 2025), Q.71:** accommodation at or below ₹7,500 "will attract GST rate of 5% without ITC".
  - Link: https://gstcouncil.gov.in/sites/default/files/2025-09/faq_0.pdf
  - Confidence: **high**.

## 2. Restaurants, specified premises, banquets and catering

- **Restaurant service rates:**
  - Outside "specified premises": **2.5%+2.5% (5%), without ITC** (Sl. 7(ii)).
  - At specified premises: **18% with ITC** (Sl. 7(vi), Explanation (b)).
  - Source: 11/2017-CT(Rate) as amended by 20/2019-CT(Rate). "Restaurant service" is defined in para 4(xxxii).
  - Confidence: **high**.
- **Definition of "specified premises" from 1 Apr 2025** (para 4(xxxvi), substituted by **05/2025-CT(Rate), 16 Jan 2025**). For a financial year, a premises is specified if any one of these applies:
  - (a) in the **preceding FY** it supplied hotel accommodation with a value of supply of **any unit above ₹7,500 per unit per day**; or
  - (b) a registered person filed an **opt-in declaration (Annexure VII) between 1 Jan and 31 Mar of the preceding FY**; or
  - (c) a person applying for registration filed an opt-in (**Annexure VIII**) **within 15 days of the registration-application acknowledgement**.
  - **Opt-out is Annexure IX**, filed 1 Jan to 31 Mar of the preceding FY. Declarations are made **per premises**.
  - Link: https://taxinformation.cbic.gov.in/view-pdf/1010273/ENG/Notifications
  - Status: in force since 1 Apr 2025. Confidence: **high**.
- **What the September 2025 rationalisation changed here:** it did **not** change the restaurant rates. 15/2025-CT(Rate), para (2), inserted two Explanations into para 4(xxxvi) with **retrospective effect from 1 Apr 2025**:
  - "premises" means the place from which hotel accommodation is or will be supplied;
  - "a person applying for registration" includes someone applying to *amend* a registration to add a place of business.
  - Link: https://taxinformation.cbic.gov.in/view-pdf/1010453/ENG/Notifications
  - Confidence: **high**.
- **The 55th Council press release** (21 Dec 2024) gave the intent: 18% with ITC if the value of any unit exceeded ₹7,500 in the preceding FY, otherwise 5% without ITC; plus an optional 18% declaration.
  - Link: https://cbic-gst.gov.in/pdf/Press-Release%20-55-GST-Council.pdf
  - Confidence: **high**.
- **Filing the declarations online:** Annexures VII and VIII became available on the GST portal (Services > Registration > Declaration for Specified Premises).
  - For FY 2026-27 the Annexure VII window was **1 Jan to 31 Mar 2026**.
  - Taxpayers who filed on paper for FY 2025-26 were asked to re-file online for FY 2026-27.
  - **Annexure IX (opt-out) was "to be made available in due course"**, and no later advisory about it appears in the portal feed.
  - Composition taxpayers, TDS/TCS registrants, SEZ units and casual taxpayers are excluded.
  - Source: GSTN advisory, **4 Jan 2026**. Link: https://www.gst.gov.in/newsandupdates/read/645
  - Confidence: **high**.
- **What the software must do (derived from the rules above):** the restaurant rate for FY N+1 depends on whether *any* unit at that premises was sold above ₹7,500 on *any* day in FY N. The PMS therefore needs a per-premises flag with an audit trail, set from the actual values in the previous year plus any declarations filed.
  - Confidence: **high**.
- **Outdoor catering and banquets (hall plus food):**
  - Outdoor catering at premises other than specified premises: **5% without ITC** (Sl. 7(iv)).
  - A composite supply of outdoor catering *together with renting of premises* (hotel, convention centre, club, pandal, shamiana, etc.) by a supplier not at specified premises: **5% without ITC** (Sl. 7(v)).
  - The same supplies by a supplier providing accommodation at specified premises, or located in specified premises: **18% with ITC** (Sl. 7(vi), Explanations (d) and (e)).
  - "Outdoor catering" is defined in para 4(xxxiii).
  - Source: 20/2019-CT(Rate). Confidence: **high**.
- **Hall rental without food** is not a Sl. 7 supply. It is rental of non-residential property (SAC 997212), taxed at **18%**.
  - Confidence: **medium**. This follows the residual entry; I found no hotel-specific clarification.
- **Room service** is restaurant service. SAC 996331 and 996332 expressly include "room services", so the rate follows the specified-premises status.
  - Source: Scheme of Classification of Services (https://www.gstcouncil.gov.in/sites/default/files/2024-02/scheme_of_classification_of_services_amended.pdf).
  - Confidence: **high**.
- **Minibar:** there is no specific clarification.
  - If minibar items are treated as goods, they take their own goods rates. Aerated, sugared, caffeinated and carbonated-fruit beverages (heading 2202) are at **40%** (Schedule III of 9/2025-CT(Rate), from 22 Sep 2025; 01/2026-CT(Rate) retuned the tariff codes from 1 May 2026). Tobacco is at 40% with valuation on the printed retail price (RSP) from **1 Feb 2026** (19/2025-CT(Rate) and new Rule 31D, 20/2025-CT).
  - If they are treated as part of restaurant or accommodation service, the service rate applies.
  - Confidence: **low**. This is in the Unresolved list.
- **Spa, salon and fitness** (Group 99972): **5% without ITC, mandatory**. Laundry, dry-cleaning and other items under Sl. 35(ii): **18%**.
  - Source: 15/2025-CT(Rate), Sl. 35 substituted. Status: from 22 Sep 2025. Confidence: **high**.
- **Liquor is outside GST.** Alcoholic liquor for human consumption is outside GST, so a bar bill for liquor carries state VAT, while food on the same bill carries GST.
  - Confidence: **high** on the principle (see §7). The split on a single composite bill is not clarified by CBIC: **medium**.

## 3. Tax invoice and document rules

All Rules links below are CBIC's consolidated text. **No CGST amendment rules in 2025 or 2026 touched Rules 46 to 57.** I checked 07/2025, 11/2025, 13/2025, 18/2025 and 20/2025-CT.

- **Rule 46, what a tax invoice must contain:**
  - (a) supplier name, address and GSTIN;
  - (b) a **consecutive serial number, at most 16 characters**, in one or more series, using letters, numbers, "-" and "/" only, **unique for the financial year**;
  - (c) date of issue;
  - (d) recipient name, address and GSTIN/UIN, if registered;
  - (e) for an **unregistered recipient with taxable value ₹50,000 or more**: name, address, delivery address, **state name and code**;
  - (f) below ₹50,000, the same details if the recipient asks for them;
  - (g) HSN/SAC;
  - (h) description;
  - (i) quantity and unit/UQC (goods only);
  - (j) total value;
  - (k) taxable value after discount;
  - (l) tax rate for each of CGST, SGST, IGST, UTGST and cess;
  - (m) tax amount for each;
  - (n) place of supply with state name, for inter-state supplies;
  - (o) delivery address if different from the place of supply;
  - (p) whether tax is payable on reverse charge;
  - (q) signature or digital signature, which is **not required on an electronic invoice** under the IT Act (proviso);
  - (r) the **QR code with the IRN**, if e-invoicing applies;
  - (s) a declaration of e-invoice non-applicability, for taxpayers whose turnover ever crossed the threshold but who are exempt.
  - Link: https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter6/rule46_v1.00.html
  - Confidence: **high**.
  - **OTA bookings:** where a service is supplied **through an e-commerce operator to an unregistered recipient**, the invoice must show the **recipient's state name**, whatever the value (first proviso to clause (f), per 26/2022 and 38/2023-CT). This applies to OTA bookings.
  - **Small B2C bills:** under the proviso to Rule 46 read with s.31(3)(b), for B2C supplies **under ₹200** where the customer does not want an invoice, one **consolidated tax invoice at the close of each day** is allowed.
- **Invoice numbers are treated as case-insensitive on the e-invoice portal (IRP)** from **1 Jun 2025**, because the IRP converts numbers to upper case. Series must therefore not collide ignoring case.
  - Source: GSTN advisory, 4 Apr 2025. Link: https://www.gst.gov.in/newsandupdates/read/592
  - Confidence: **high**.
- **Rule 47:** the invoice for a service must be issued **within 30 days of the date of supply** (45 days for banks and insurers).
  - Link: https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter6/rule47_v1.00.html
  - Confidence: **high**.
- **Rule 48:** a service invoice is made in duplicate, marked "ORIGINAL FOR RECIPIENT" and "DUPLICATE FOR SUPPLIER". An e-invoice issued under Rule 48(4) is exempt from this, and an invoice that should have been an e-invoice but was issued otherwise is **not a valid invoice** (48(5)).
  - Link: https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter6/rule48_v1.00.html
  - Confidence: **high**.
- **Advances (Rule 50 and s.31(3)(d)):** a **receipt voucher** is required when an advance is received. It needs the same kind of fields: 16-character unique serial, advance amount, rate, tax and place of supply. If the rate cannot be determined at receipt, use **18%**; if the nature of supply cannot be determined, treat it as inter-state.
  - **GST is due on advances for services.** Under s.13(2), time of supply is the earlier of invoice and payment, with an option to use the invoice date for up to ₹1,000 of excess.
  - The goods-only relief (Notification 66/2017-CT) does not cover services.
  - Links: Rule 50 https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter6/rule50_v1.00.html · s.13 https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter4/section13_v1.00.html
  - Confidence: **high**.
- **Rule 51, refund voucher:** used when an advance was taken but no supply follows. It must quote the receipt voucher's number and date, the refund amount, the rate and the tax.
  - Link: https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter6/rule51_v1.00.html
  - Confidence: **high**.
  - A retained cancellation fee is *not* refunded and is taxable (see §1).
- **Rule 53(1A), credit and debit notes:** supplier details; nature of document; 16-character unique serial; date; recipient details, or for an unregistered recipient name, address and state; **the serial number(s) and date(s) of the original invoice(s)**; value, rate and tax credited or debited; signature.
  - Link: https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter6/rule53_v1.00.html
  - Confidence: **high**.
- **Section 34, credit notes:**
  - A credit note must be declared in a return **no later than 30 November after the end of the FY of the supply, or the date the annual return is filed, whichever is earlier**. The words "30 November" came in with the Finance Act 2022, from 1 Oct 2022.
  - **New proviso from 1 Oct 2025** (Finance (No. 7) Act 2025, s.126; brought into force by 16/2025-CT): the supplier's output tax is **not reduced** unless the registered recipient has reversed the matching ITC. For an unregistered recipient, the tax must not have been passed on.
  - Link: https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter7/section34_v1.00.html
  - Confidence: **high**.
- **Records, s.36 and Rules 56/57:**
  - Keep records for **72 months from the due date of the annual return** for the year. GSTR-9 is due 31 Dec, so FY 2025-26 records must be kept until **31 Dec 2032**. Keep them longer while an appeal or investigation is open.
  - **Rule 56(8):** entries may not be erased or overwritten. In electronic records, **"a log of every entry edited or deleted shall be maintained"**. This is an audit-trail requirement the PMS itself must meet.
  - Rule 56(3): keep a separate account of advances.
  - Rule 57: keep backups that can be restored, produce records on demand, and hand over passwords and code explanations if asked.
  - Links: s.36 https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter8/section36_v1.00.html · Rule 56 https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter7/rule56_v1.00.html · Rule 57 https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter7/rule57_v1.00.html
  - Confidence: **high**.
- **HSN/SAC digits on invoices (78/2020-CT, 15 Oct 2020, from 1 Apr 2021):**
  - Previous-FY aggregate turnover **up to ₹5 crore: 4 digits**. The proviso lets these taxpayers **omit the code on invoices to unregistered persons**.
  - **Above ₹5 crore: 6 digits** on all invoices.
  - Link: https://taxinformation.cbic.gov.in/view-pdf/1000553/ENG/Notifications
  - Confidence: **high**.
- **SAC codes** (from the Scheme of Classification of Services, gstcouncil.gov.in PDF above). Confidence: **high** for the codes. The choice of code within a group, for example spa, is **medium**.

| Service | SAC |
|---|---|
| Hotel room | **996311** (room or unit accommodation by hotels, inns, guest houses, clubs) |
| Camp site | 996312 |
| Restaurant (incl. room service, takeaway) | **996331** (restaurants, cafes); **996332** (services by hotels, inns, guest houses, clubs incl. room service) |
| Outdoor or event catering | **996334** (catering at exhibition halls, events, marriage halls, other functions) |
| Hall rental only | 997212 (rental of non-residential property) |
| Event organisation | 998596 |
| Laundry | 999711 coin-op laundry · **999712 dry-cleaning** · 999713 other textile cleaning · 999714 pressing · 999719 other washing |
| Spa, salon, gym (Group 99972) | 999721 hairdressing and barbers · 999722 cosmetic treatment, manicure, pedicure · **999723 physical well-being incl. health club and fitness** · 999729 other beauty |
| OTA commission (inward supply to the hotel) | 998552 (reservation services for accommodation) |

## 4. E-invoicing (IRN and QR)

- **Threshold:** e-invoicing is mandatory for B2B invoices and credit/debit notes where **aggregate turnover exceeded ₹5 crore in any preceding FY from 2017-18 onwards**, from **1 Aug 2023**.
  - Source: **10/2023-CT, 10 May 2023**, amending 13/2020-CT.
  - Links: https://taxinformation.cbic.gov.in/view-pdf/1009732/ENG/Notifications · 13/2020: https://taxinformation.cbic.gov.in/view-pdf/1000623/ENG/Notifications
  - Confidence: **high**.
- **No lower threshold has been notified.** Nothing in CBIC's 2025-26 notification lists, and no GSTN advisory, lowers ₹5 crore. Secondary sources describe a ₹2 crore or ₹1 crore proposal, but it is not notified.
  - Confidence: **high** that no notification exists.
- **Hotels are not exempt.** The exempt classes are:
  - SEZ units (61/2020-CT);
  - government departments and local authorities (23/2021-CT);
  - Rule 54(2) insurers, banks and NBFCs; 54(3) goods transport agencies; 54(4) passenger transport; 54(4A) multiplex cinema admission.
  - Hotels and restaurants are not in the list.
  - Links: https://taxinformation.cbic.gov.in/view-pdf/1000573/ENG/Notifications · https://taxinformation.cbic.gov.in/view-pdf/1000510/ENG/Notifications
  - Confidence: **high**.
- **30-day reporting limit on the IRP:** from **1 Apr 2025**, taxpayers with aggregate turnover **of ₹10 crore or more** cannot report an invoice, credit note or debit note to the IRP **more than 30 days after its date**. Below ₹10 crore there is "no such reporting restriction … as of now".
  - Source: GSTN advisory, **5 Nov 2024**. Link: https://www.gst.gov.in/newsandupdates/read/543
  - Confidence: **high**.
  - I found **no advisory extending the limit below ₹10 crore** up to 19 Sep 2026.
- **B2C dynamic QR:** mandatory on B2C invoices for **aggregate turnover above ₹500 crore**. Exclusions are as for e-invoicing, plus OIDAR suppliers. A digitally displayed dynamic QR counts.
  - Source: 14/2020-CT, 21 Mar 2020, as amended. Link: https://taxinformation.cbic.gov.in/view-pdf/1000622/ENG/Notifications
  - Confidence: **high**.
- **Two-factor login (MFA) on the e-invoice and e-way bill portals** became mandatory for all users from **1 Apr 2025** (GSTN advisory, 17 Dec 2024).
  - Link: https://www.gst.gov.in/newsandupdates/read/561
  - Confidence: **high**.
  - This matters to any API or web integration.

## 5. Returns and what a CA needs from the software

- **GSTR-1 (Rule 59):**
  - Invoice-wise B2B (Table 4).
  - Inter-state B2C invoices **above ₹1 lakh** (Table 5). The threshold was cut from ₹2.5 lakh by 12/2024-CT. Hotel lodging is always intra-state, so this rarely applies.
  - Rate-wise consolidated intra-state B2C (Table 7).
  - Amendments (Table 9A/9B/9C).
  - Advances (Table 11).
  - HSN summary (Table 12).
  - Documents issued (Table 13).
  - Supplies through e-commerce operators (Tables 14 and 15).
  - Link: https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter8/rule59_v1.00.html
  - Confidence: **high** for Rule 59. **Medium** for the Table 14/15 labels, which come from the form rather than a text I opened.
- **Table 12 Phase-III (HSN summary):** from the **May 2025 return period**:
  - HSN is picked **from a dropdown only**;
  - Table 12 is split into **B2B and B2C tabs**;
  - value checks against other tables run **in warning mode**;
  - the **B2B tab cannot be empty** if B2B supplies are reported;
  - the B2C tab is **not mandatory**;
  - Phase-4 is "to be communicated".
  - **Table 13 (documents issued) became mandatory** from the May 2025 return period.
  - Source: GSTN advisory, 1 May 2025, and its PDF of 25 Apr 2025.
  - Links: https://www.gst.gov.in/newsandupdates/read/597 · https://tutorial.gst.gov.in/downloads/news/updated_advisory_hsn_table12_25042025.pdf
  - Confidence: **high**.
  - Note: an earlier advisory (22 Jan 2025) said "soon", and some secondary sources give Feb or Apr 2025. The primary source says May 2025.
- **GSTR-1A:** an optional form to amend or add current-period GSTR-1 details before GSTR-3B is filed. It can be filed once per period and has been available from the July 2024 period.
  - Sources: Rule 59(1) proviso (12/2024-CT); GSTN advisory 26 Jul 2024.
  - Link: https://www.gst.gov.in/newsandupdates/read/506
  - Confidence: **high**.
- **GSTR-3B hard-locking:**
  - Tax liability auto-filled from GSTR-1, 1A or IFF became **non-editable from the July 2025 tax period** (returns filed from August 2025). Corrections go only through GSTR-1A, or through later GSTR-1s.
  - Source: GSTN advisory, 7 Jun 2025. The earlier January 2025 start was postponed by the advisory of 27 Jan 2025.
  - Links: https://www.gst.gov.in/newsandupdates/read/606 · https://www.gst.gov.in/newsandupdates/read/578
  - **Table 3.2** (inter-state supplies to unregistered persons, composition taxpayers and UIN holders) became **non-editable from the Nov 2025 period** (advisory 5 Dec 2025): https://www.gst.gov.in/newsandupdates/read/640
  - Confidence: **high**.
- **GSTR-3B "Tax Liability Breakup":** from the **Feb 2026 period**, the portal auto-fills the breakup of liability by period from the **document dates** in GSTR-1. The taxpayer must confirm or edit it before filing, and interest under s.50 follows from it.
  - Source: GSTN advisory, 16 Mar 2026. Link: https://www.gst.gov.in/newsandupdates/read/653
  - A related interest-recomputation advisory: https://www.gst.gov.in/newsandupdates/read/657
  - Confidence: **high**.
  - Consequence for the software: invoice dates must be correct. A late-reported invoice now automatically carries interest.
- **Invoice Management System (IMS)** — the portal where buyers accept, reject or hold suppliers' invoices:
  - Live from **1 Oct 2024** (advisory 3 Sep 2024). It is **optional**, not mandatory: records not acted on are treated as accepted, and ITC still auto-fills from GSTR-2B (advisory 8 Oct 2025).
  - From the **Oct 2025 period**, recipients can hold credit notes as "Pending" for one tax period and can declare how much ITC to reverse (advisories 23 Sep and 17 Oct 2025; GSTN FAQ PDF).
  - **When a guest's company *rejects* a hotel's credit note, the hotel's GSTR-3B liability goes back up.** This works with the s.34(2) proviso described in §3.
  - An IMS offline tool was added on 21 Apr 2026.
  - Links: https://www.gst.gov.in/newsandupdates/read/517 · https://www.gst.gov.in/newsandupdates/read/624 · https://www.gst.gov.in/newsandupdates/read/628 · https://www.gst.gov.in/newsandupdates/read/631 · FAQ: https://tutorial.gst.gov.in/downloads/news/creative_faq_on_gstr9_for_24_25_dt_15_oct_25_v6_final.pdf · https://www.gst.gov.in/newsandupdates/read/658
  - Confidence: **high**.
- **Three-year time bar on returns:** GSTR-1, 1A, 3B, 4, 5, 6, 7, 8, 9 and 9C cannot be filed more than **3 years after their due date**.
  - Law: ss.37(5), 39(11), 44(2) and 52(15), inserted by the Finance Act 2023 and in force from **1 Oct 2023** (28/2023-CT).
  - Portal enforcement was announced "from the July 2025 tax period" (advisory 7 Jun 2025). A later advisory (29 Oct 2025) says it is implemented **from the Nov 2025 tax period**, with returns barred from **1 Dec 2025** (for example, the Oct 2022 GSTR-1 and 3B, and GSTR-9 for FY 2020-21).
  - Links: s.39 https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter9/section39_v1.00.html · https://www.gst.gov.in/newsandupdates/read/607 · https://www.gst.gov.in/newsandupdates/read/633
  - Confidence: **high** for the law. The rollout date differs between the two advisories (see Unresolved).
- **GSTR-9 and 9C for FY 2025-26:**
  - **GSTR-9 is not required for aggregate turnover up to ₹2 crore**, for FY 2024-25 onwards.
    - Source: **15/2025-CT, 17 Sep 2025**. Link: https://taxinformation.cbic.gov.in/view-pdf/1010465/ENG/Notifications
  - **GSTR-9C** (self-certified reconciliation) is required when aggregate turnover is **above ₹5 crore**.
    - Source: Rule 80(3), as substituted by 30/2021-CT.
  - Both are due **31 Dec 2026** for FY 2025-26.
  - Link: https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter8/rule80_v1.00.html
  - Confidence: **high**.
  - GSTR-9/9C form changes were made for FY 2024-25 by 13/2025-CT. No 2026 notification changes them for FY 2025-26.
- **Annual-turnover (AATO) amendment window for FY 2025-26:** **1 to 31 Jul 2026**, with officer review 1 to 15 Aug 2026. The portal now updates AATO automatically as later returns are filed.
  - Source: advisory 1 Jul 2026. Link: https://www.gst.gov.in/newsandupdates/read/666
  - Confidence: **high**.
  - AATO drives the HSN-digit, e-invoice and 30-day-limit thresholds.

## 6. Online travel agents and other e-commerce operators

- **Section 9(5) for hotels:** the e-commerce operator pays GST on hotel, guest-house and similar accommodation supplied through it, **except where the supplier is *liable* to register under s.22(1)**.
  - Source: 17/2017-CT(Rate), clause (ii).
  - The exception turns on the supplier being *liable* to register. So a hotel below the threshold that registered voluntarily still falls under 9(5).
  - Link: https://taxinformation.cbic.gov.in/view-pdf/1000990/ENG/Notifications
  - Confidence: **high** for the text. **Medium** for the voluntary-registration reading.
- **Restaurants through e-commerce operators:** since 1 Jan 2022 the operator pays GST on restaurant services, *except* for restaurants at specified premises (17/2021-CT(Rate)). From **1 Apr 2025**, "specified premises" in 17/2017 takes the new definition (**08/2025-CT(Rate)**).
  - Link: https://taxinformation.cbic.gov.in/view-pdf/1010276/ENG/Notifications
  - Confidence: **high**.
- **Local delivery through e-commerce operators:** from **22 Sep 2025** the operator pays GST on local delivery, unless the delivery provider is liable to register. The rate is 18%.
  - Source: **17/2025-CT(Rate)** and 15/2025-CT(Rate), Sl. 12. This is not hotel billing.
  - Link: https://taxinformation.cbic.gov.in/view-pdf/1010455/ENG/Notifications
  - Confidence: **high**.
- **Tax collected at source by the operator (s.52):**
  - **0.25% CGST (plus 0.25% SGST, so 0.5% intra-state)** on the net value of taxable supplies where the operator collects the payment, from **10 Jul 2024**.
  - Source: **15/2024-CT**, amending 52/2018-CT. Link: https://taxinformation.cbic.gov.in/view-pdf/1010100/ENG/Notifications
  - Status: unchanged in 2025-26. Confidence: **high**.
  - This does not apply to "pay at hotel" bookings, where the operator collects nothing, or to 9(5) supplies. That follows from s.52(1): "where the consideration … is to be collected by the operator".

## 7. Liquor (outside GST; state VAT)

- **Principle:** GST does not cover alcoholic liquor for human consumption (Constitution, Art. 366(12A); CGST Act s.9(1)). State VAT or sales tax applies instead. Confidence: **high**.
- **Maharashtra:**
  - The underlying Schedule rate on foreign liquor is **65% of sale price** from 1 Apr 2021, and 40% on wine (MVAT Schedule B, entries 1 to 3A).
  - A s.41(5) exemption notification brings the tax at the bar/restaurant stage down to a percentage of the **sale price** (the bill amount, not the printed retail price, MRP):
    - Sl. 4: hotels and restaurants of **4-star and above** holding an FL-III or E licence pay **20% of sale price**.
    - Sl. 5: restaurants and hotels of **3-star and below**, and clubs (FL-III, FL-IV or E licence), pay **10% of sale price**. This was **raised from 5% w.e.f. 1 Nov 2023** by **VAT-1523/C.R.47/Taxation-1, 19 Oct 2023**.
    - Liquor brought in from outside the state carries an extra MRP-based component.
  - The base notification is **VAT-1511/C.R.57/Taxation-1, 30 Apr 2011**.
  - Links:
    - 2023 amendment: https://www.mahagst.gov.in/public/uploads/mvatservices/1760429297LIQUOR%20NOTIFICATION.pdf
    - 2011 base: https://www.mahagst.gov.in/public/uploads/mvatservices/KNOW_NOTIFI_MVAT_05_02_11_7_12_57PM.pdf
    - Schedule: https://www.mahagst.gov.in/public/uploads/menufiles/MVAT%20Schedule%20Rate%20English%20upto%2031.03.2025_0.pdf
  - Status: the MahaGST notification list shows **no later liquor-VAT notification up to 25 Sep 2026**.
  - Confidence: **high** for the 10% (primary text read) and for 65%. **Medium** for the 20% at 4-star and above: I read the 2011 Schedule I entries through a secondary transcription, because the MahaGST PDF of the base notification and its 2015-17 amendments are scanned images.
  - The July 2025 bar strike was about the 2023 VAT rise plus the 2025 **excise duty and licence-fee** rises. Those are not charged on the guest's bill.
- **Uttar Pradesh:**
  - Under the UP VAT Act 2008, Schedule IV entry 1, "spirits and spirituous liquors … excluding country liquors" are taxed at the **first point, the manufacturer or importer ("M or I"), at 32.5%**. On that reading, a bar's resale is made from VAT-paid stock and no VAT is added to the bar bill.
  - Link: https://comtax.up.nic.in/Vat_Act/UPVAT%20SCHEDULE%20Updated%20upto%20dt%2012-03-2015.pdf
  - Status: the department's consolidated schedule only runs to **12 Mar 2015**. Its online VAT-notification index stops at 2016-17, so I could **not verify the current rate** or whether a bar-stage levy was added later.
  - Confidence: **low to medium**. A UP CA or the department must confirm.
- **Himachal Pradesh:**
  - The HP VAT Act 2005, Schedule D, "Liquor", has been at **12.5%** from 1 Apr 2008 (EXN-F(5)-13/2005, 29 Mar 2008), collected at the **first purchase point in the state**.
  - HP Excise Policy 2026-27 says liquor is served "from the excise duty and VAT paid stock". That implies **no separate VAT on the bar bill**.
  - Links: https://www.hptax.gov.in/ckfinder/userfiles/files/schedule.pdf · https://www.hptax.gov.in/public/setpdf/Excise%20Policy%202026_27.pdf
  - Status: the schedule PDF appears to date from about 2013-14. I found no later liquor-VAT notification in hptax's online list (which shows only maintenance notices).
  - Confidence: **low to medium** on whether 12.5% is still the rate.
- **Excise-linked charges on bar sales:** in all three states these fall on the licensee — licence fees, assessed fees per bulk litre, and excise duty on lifting stock. None of them is a separate line on the guest's bill.
  - Sources: HP Excise Policy 2026-27, paras on L-3/L-4/L-5 assessed fees; Maharashtra excise licence notifications.
  - Confidence: **medium**.

## 8. Local levies on hotels after GST (Maharashtra, UP, HP)

- **Luxury tax on hotels has been subsumed into GST.** The 101st Constitutional Amendment (2016) replaced List II Entry 62, "taxes on luxuries, including … entertainments", with a narrower entry: "taxes on entertainments and amusements to the extent levied and collected by a Panchayat or a Municipality…".
  - HP's "Luxuries Act & Rules 1979" is still listed on hptax.gov.in, but only as a legacy Act.
  - Link: https://legislative.gov.in/constitution-of-india/
  - Confidence: **high**.
- **None found.** I found no current per-room or per-bill municipal, tourism or lodging tax in Maharashtra, UP or HP primary sources.
  - The only surviving hook is a local-body entertainment tax under the new Entry 62, which could apply to ticketed events.
  - Confidence: **medium**. Municipal bye-laws were not searched exhaustively.

## 9. FSSAI requirements

- **FSSAI number on bills:** all food businesses must print their **14-digit FSSAI licence or registration number on cash receipts, invoices, cash memos and bills**.
  - The original FSSAI orders are dated **8 Jun 2021**, effective 1 Oct 2021, and **30 Sep 2021**, which extended the date to **1 Jan 2022**.
  - FSSAI reiterated the requirement to hotels and restaurants on **13 Sep 2022** (File RCD-02001/10/2021), after a letter from the consumer-protection regulator (CCPA).
  - Link: https://www.fssai.gov.in/docs/food-law/advisory/6320614d91afaOrder_License_Food_13_09_2022.pdf
  - Confidence: **high**. I read the 2022 order; the 2021 orders are cited inside it.
  - The 2022 order misdates the first order as "8th June 2022". The attached CCPA letter says 08.06.2021.
- **Menus: FSS (Labelling and Display) Regulations 2020, Regulation 9:**
  - Food service establishments with a **Central licence, or outlets at 10 or more locations**, must show **calories (kcal per serving and serving size)** against menu items. They must also show the line "An average active adult requires 2,000 kcal energy per day, however, calorie needs may vary".
  - **All** food service establishments must show **allergen information** (symbols allowed) and the **veg or non-veg logo** against menu items.
  - Nutritional information must be available **on request**.
  - Exempt: event caterers, premises that operate under 60 days a year, free self-serve condiments, and special-order items.
  - The display chapter applied from 1 Jan 2022 (direction of 28 Dec 2021), and the regulations as a whole from 1 Jul 2022.
  - Links: https://www.fssai.gov.in/docs/food-law/regulations/Comp_Labelling%20Display_Version%20VIII_09_09_2025.pdf · https://www.fssai.gov.in/docs/food-law/advisory/61cab16ee9be0Direction_Display_Label_28_12_2021.pdf
  - Confidence: **high**.
  - Whether a hotel holds a Central licence depends on its FSSAI category. The CA or hotel must confirm this per property.
- **Food Safety Connect app:** display of the app's QR code or download link at food premises (FSSAI, 30 Jul 2025).
  - Link: https://www.fssai.gov.in/docs/food-law/advisory/688a154f0130020250730181327470.pdf
  - Confidence: **medium**. The PDF is a scanned image and I only read its title.
- **Service charge on bills (related consumer rule):** the CCPA's guidelines of **4 Jul 2022** bar adding a service charge automatically or by default. The source is the CCPA letter of 7 Sep 2022 attached to the FSSAI order above.
  - Confidence: **medium** that the guidelines exist. I did **not verify** the current Delhi High Court status (see Unresolved).
  - If a service charge is collected, it is part of the GST value.

## 10. GST items announced but not yet in force (as of 25 Sep 2026)

- **Finance Act 2026, s.153:** substitutes CGST s.15(3)(b), the rules for excluding post-sale discounts from value. Status: **"w.e.f. yet to be notified"**.
- **Finance Act 2026, s.154:** adds to s.34(1) "or where a discount referred to in s.15(3)(b) is given" as a ground for a credit note. Status: **yet to be notified**.
  - Source for both: CBIC's CGST Act footnotes (Finance Act 2026, No. 4 of 2026, 30 Mar 2026).
  - Links: https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter4/section15_v1.00.html and the s.34 link above.
  - Confidence: **high** that these are un-notified. **Medium** on the substance, because only the footnotes are visible and the new s.15(3)(b) text is not yet shown.
  - Relevant to corporate or OTA volume discounts given by credit note.
- **57th GST Council meeting, 7 Oct 2026:** rescheduled from 12 Sep 2026. Reported agenda: ITC and s.17(5), registration, inverted-duty refunds. Nothing decided. Source: secondary reports of a Council Secretariat office memorandum; I did not reach the memorandum itself.
- **Annexure IX (specified-premises opt-out) on the portal:** "will be made available in due course" (GSTN, 4 Jan 2026). No later advisory.
- **Table 12 HSN Phase-4:** "to be communicated in due course" (GSTN, 25 Apr 2025).
- **GSTR-3B Table 4 (ITC) hard-locking:** reported by one secondary source as "targeted around July 2026". **No GSTN advisory found.** Treat it as unannounced.
- **E-invoice threshold below ₹5 crore, and the 30-day IRP limit below ₹10 crore:** nothing announced by CBIC or GSTN.

| Date | What | Source |
|---|---|---|
| 7 Oct 2026 | 57th GST Council meeting (agenda only; no decisions) | Council Secretariat memorandum, per secondary reports |
| Not notified | FA 2026 s.153: new s.15(3)(b) post-sale discount valuation | CBIC CGST Act, s.15 footnote |
| Not notified | FA 2026 s.154: s.34(1) credit note for s.15(3)(b) discounts | CBIC CGST Act, s.34 footnote |
| Not notified | FA 2026 s.155: s.54 change (refunds) | CBIC CGST Act, s.54 footnote |
| "In due course" | Annexure IX opt-out filing on the GST portal | GSTN advisory, 4 Jan 2026 |
| "In due course" | HSN Table 12 Phase-4 | GSTN advisory, 25 Apr 2025 |
| Rumoured (Jul 2026) | GSTR-3B Table 4 ITC hard-lock | secondary only; no GSTN advisory |
| — (already live, for context) | 1 Oct 2025 s.34(2) proviso; Oct 2025 IMS credit-note changes; Nov 2025 Table 3.2 lock; 1 Dec 2025 three-year bar; 1 Feb 2026 tobacco RSP valuation; Feb 2026 GSTR-3B liability breakup | see §§3 and 5 |

## Unresolved, or sources disagree

1. **Package pricing (room with meals):** does the ₹7,500 test use the whole composite price or only the accommodation element? I found no CBIC clarification.
2. **Opt-out for premises that crossed ₹7,500 objectively:** the definition's limbs (a), (b) and (c) are joined by "or". The CBIC FAQs of March 2025, which I read only through a secondary copy (Mondaq), say that premises crossing ₹7,500 are *automatically* specified for the next FY. Annexure IX's wording could be read as letting any hotel opt out. My view is that opt-out can only undo an opt-in, but this is **not settled**.
3. **Minibar and in-room retail:** is it goods (at its own HSN rate, which could be 40% for aerated drinks) or part of restaurant or accommodation service? Not clarified.
4. **Extra bed under the value-of-supply test:** Circular 27/01/2018 predates the switch from declared tariff to transaction value.
5. **Three-year return bar:** portal enforcement was announced for the July 2025 period (advisory 7 Jun 2025), then described as implemented from the Nov 2025 period, barring from 1 Dec 2025 (advisory 29 Oct 2025).
6. **HSN Phase-III start:** secondary sources give Feb or Apr 2025. GSTN's primary advisory says the May 2025 return period.
7. **UP and HP liquor VAT:** the current rates could not be confirmed. The only primary schedules are from 2015 (UP) and about 2013-14 (HP). Both indicate first-point collection, meaning no VAT line on a bar bill.
8. **Maharashtra 20% for 4-star and above:** read only through a secondary transcription of the 2011 notification, because the primary PDF is a scanned image. Later amendments from 2015-17 are also scanned and were not read.
9. **CCPA service-charge guidelines (4 Jul 2022):** current litigation status in the Delhi High Court not verified.
10. **CBIC hotel FAQ (28 Mar 2025):** the primary PDF was not reached. I used secondary copies (Mondaq, TaxO).
11. **Table 14/15 of GSTR-1 (e-commerce supplies):** the table numbers come from the form's structure. I did not open a primary GSTN advisory for them.

---
*Research method: the CBIC tax-portal API (notification, circular, Act and Rule texts); the GST portal news feed (GSTN advisories, IDs 500 to 672); MahaGST, hptax.gov.in and comtax.up.nic.in primary PDFs; the FSSAI advisory list and regulations compendium; the GST Council's 56th-meeting FAQ and 55th-meeting press release. I used secondary sources only to find primary ones, and say so wherever a primary was not reached.*
