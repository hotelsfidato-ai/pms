# Income tax, Form C, guest registers and service charge: legal research for a hotel PMS sold in India

Researched 25 September 2026. Web research only; nothing about the software was entered anywhere.

**How the sources were reached.**
- **incometaxindia.gov.in (CBDT).** Blocks scripted downloads with HTTP 403, so its pages were read in a browser. This includes the section and rule pages, as amended by the Finance Act 2026, and the CBDT's own 1961-to-2025 comparison tool.
- **indiacode.nic.in.** Timed out every time (HTTP 504). The Acts were read instead from the Ministry of Home Affairs (MHA) and PRS copies of the Gazette text.
- **Delhi High Court.** The homepage loads, but the judgment PDF could not be found on the court's site. The judgment was read on indiankanoon.org, as the brief allows when the court's site cannot be used.
- **consumeraffairs.nic.in.** Unreachable. The CCPA's own site (ccpa.doca.gov.in) was used instead.

Confidence ratings:
- **high**: primary text read.
- **medium**: primary text partly read, or only an official summary or a reliable secondary source.
- **low**: secondary source only, or not verified.

---

## A. Income-tax Act, 2025 and Income-tax Rules, 2026

### A1. Commencement and the Rules

- **The Income-tax Act, 2025 (Act 30 of 2025) is in force from 1 April 2026.**
  - Source: s.1(3), "save as otherwise provided". The President assented on 21 August 2025. The CBDT text is marked "as amended by Finance Act, 2026".
  - Links: https://www.incometaxindia.gov.in/income-tax-act-2025 (section 1) and the PDF at https://www.incometaxindia.gov.in/documents/d/guest/income_tax_act_2025_as_amended_by_fa_act_2026-pdf
  - Status: in force.
  - Confidence: **high** (read s.1 on the CBDT site).
- **The Income-tax Rules, 2026 were notified on 20 March 2026 and apply from 1 April 2026.**
  - Source: Notification No. 22/2026, G.S.R. 198(E), F. No. 370142/41/2025-TPL, dated 20 March 2026.
  - Link: https://www.incometaxindia.gov.in/w/notification-no.-22/2026-f.-no.-370142/41/2025-tpl-/-g.s.r.-198-e-
  - Status: in force.
  - Confidence: **high** for the number and date, which were read on the CBDT page. **Medium** for the 1 April 2026 start date: it comes from secondary sources (taxmann, A2Z Taxcorp), because the notification PDF could not be downloaded.
- **Later amendments to the Rules.** The latest found is the Income-tax (Fourth Amendment) Rules, 2026: Notification No. 120/2026, G.S.R. 822(E), dated 17 September 2026.
  - What it does: a technical correction to rule 160 ("(i)" becomes "(a)"). It also extends two registration deadlines to 31 March 2027: for valuers, and for authorised income-tax practitioners under rule 256(4).
  - Nothing in it changes rules 159 or 237.
  - Source: SCC Online, 18 September 2026 (https://www.scconline.com/blog/post/2026/09/18/cbdt-notifies-income-tax-fourth-amendment-rules-2026/). The CBDT rule-160 page shows the "1[(a)]" footnote, so the CBDT text already includes this amendment.
  - Confidence: **medium**.
- **Official mapping between the two Acts.** The CBDT publishes a "Utility to check provisions of Income-tax Act, 1961 vis-a-vis Income-tax Act, 2025", covering Acts, Rules and Forms.
  - Links: https://www.incometaxindia.gov.in/utility-to-check-provisions-of-income-tax-act-1961-vis-a-vis-income-tax-act-2025. There is also a forms-only "Form Mapping Guide" on the e-filing portal: https://www.incometax.gov.in/iec/foportal/sites/default/files/2026-06/Navigator%201.pdf
  - Every mapping in the A2 table below was taken from that utility's data, 1,943 mapping rows in all.
  - Confidence: **high**.
- **Transition FAQs (not read).** The CBDT has published "FAQs on Interplay and Transition to the Income-tax Act, 2025": https://www.incometaxindia.gov.in/documents/81799/11848482/FAQs-on-Interplay-and-Transition.pdf/05f80c1a-073c-a5d7-fb6f-55509242be53?t=1774082865717
  - Could not be opened because of the 403 block. It should be read for which Act governs amounts credited before 1 April 2026 but paid after.

### A2. Table: 1961 Act section → 2025 Act section

Mappings come from the CBDT utility. The text and figures were read on the CBDT's section and rule pages; the 2026 version was used where one exists.

| 1961 Act / 1962 Rules | 2025 Act / 2026 Rules | What the 2025 text says (substance) | Change of substance? | Confidence |
|---|---|---|---|---|
| s.269ST (cash receipt of ₹2 lakh or more) | **s.186** (definitions in s.189) | A person may not receive **₹2,00,000 or more** (a) in total from one person in a day, (b) for a single transaction, or (c) for transactions relating to one event or occasion from one person, except by account-payee cheque, account-payee draft, bank ECS or another prescribed electronic mode. Exceptions in s.186(2): Government, banks and post-office savings banks, s.185-type transactions, and notified persons. | None found | high ([s.186](https://www.incometaxindia.gov.in/w/section-186-41)) |
| s.271DA (penalty for breaching 269ST) | **s.451**; relief for reasonable cause in **s.470** (formerly 273B) | Penalty **equal to the sum received** in breach of s.186, imposed by the Assessing Officer | None | high ([s.451](https://www.incometaxindia.gov.in/w/section-451-6)) |
| s.269SS (accepting cash loans, deposits or specified sums) | **s.185** | Only through the banking modes above if the amount (or the total, including any earlier amount still unpaid) is **₹20,000 or more**. A "specified sum" means an advance for immovable property. | None | high ([s.185](https://www.incometaxindia.gov.in/w/section-185-79)) |
| s.271D (penalty for 269SS) | **s.450** | Penalty equal to the amount | None | high (mapping) / medium (text not read) |
| s.269T (repaying loans or deposits in cash) | **s.188** | ₹20,000 limit on repayment, as under 269T | Not checked in detail | medium (mapping only) |
| s.271E (penalty for 269T) | **s.453** | — | — | medium (mapping only) |
| s.269SU (must offer prescribed electronic payment modes) | **s.187** | A business with turnover above **₹50 crore** in the preceding tax year must offer the prescribed electronic payment modes | None | high ([s.187](https://www.incometaxindia.gov.in/w/section-187-77)); the rule number for the modes was not verified |
| s.40A(3), (3A) (cash expenditure over ₹10,000) | **s.36(4)–(7)**; exceptions in **Rule 26** (formerly 6DD); electronic modes in **Rule 48** (formerly 6ABBA) | No deduction if payments to one person in a day **exceed ₹10,000** otherwise than by a "specified banking or online mode". The limit is **₹35,000** for goods-carriage hire. If a cash payment is made in a later year for an expense deducted earlier, it is deemed income of that later year. | None | high for the text, which was read on the "Year 2025" page ([s.36](https://www.incometaxindia.gov.in/w/section-36-171)); medium that the 2026 text is unchanged |
| s.43B(h) (paying micro and small enterprises on time) | **s.37(2)(g)** | An amount owed to a micro or small enterprise and paid **after the time limit in s.15 of the MSMED Act, 2006** is deductible only in the year it is actually paid. s.37(3), which lets a payment made before the return due date count for the earlier year, **expressly excludes clause (g)**. | None | high ([s.37](https://www.incometaxindia.gov.in/w/section-37-176)) |
| s.194C (contractors) | **s.393(1) Table Sl. 6(i)**; Sl. 6(ii) takes over old 194M | **1%** if the contractor is an individual or HUF, **2%** otherwise. Threshold: **₹30,000 for a single payment or ₹1,00,000 in total for the year**. Only a "designated person" deducts (s.402(11)). Sl. 6(ii): an individual or HUF not otherwise required to deduct pays 2% above ₹50 lakh. | None | high ([s.393](https://www.incometaxindia.gov.in/w/section-393-6), 2026 text) |
| s.194H (commission or brokerage) | **s.393(1) Sl. 1(ii)** | **2%**, threshold **₹20,000**. Deducted by a "specified person" (s.402(37)): anyone other than an individual or HUF, or an individual or HUF with business turnover above ₹1 crore (professional receipts above ₹50 lakh). | None (₹20,000 dates from FY 2025-26) | high |
| s.194-I (rent) | **s.393(1) Sl. 2(ii)**; old 194-IB is Sl. 2(i) | **2%** for plant, machinery or equipment; **10%** for land, buildings or furniture and fittings. Threshold **₹50,000 for a month or part of a month**. | None | high |
| s.194J (professional or technical fees, royalty, directors' fees, non-compete) | **s.393(1) Sl. 6(iii)** | **2%** for technical-service fees (not professional services), cinema-film royalty and call-centre operators. **10%** for everything else, including professional fees and other royalties (a software licence treated as royalty falls here). Threshold **₹50,000** for fees, royalty and non-compete sums; **nil** for directors' fees. | None (₹50,000 applied from FY 2025-26 and is carried over) | high |
| s.194-O (e-commerce operator, e.g. an online travel agent (OTA) paying a hotel) | **s.393(1) Sl. 8(v)**; exemption in **s.393(4) Table Sl. 11** | The operator deducts **0.1% of the gross amount of the sale or service**, with **nil threshold**. Under Note 3, a payment made directly by the guest to the hotel for an OTA-facilitated booking is treated as paid by the OTA and counts in the gross amount. If tax is deducted under Sl. 8(v), no other TDS applies to that transaction. **Exempt** if the participant is an individual or HUF with gross sales of **₹5,00,000 or less** in the year and has given PAN or Aadhaar. "E-commerce participant" means a resident (s.402(14)). | None | high |
| s.194Q (buyer's TDS on purchase of goods) | **s.393(1) Sl. 8(ii)** | **0.1%** on the amount **above ₹50 lakh**. The buyer must have turnover above **₹10 crore** in the preceding tax year (s.402(6)). Does not apply if another TDS or TCS provision applies. | None | high |
| s.206C(1H) (TCS on sale of goods) | **No equivalent.** s.206C maps to s.394, but s.394's table has no sale-of-goods item. | Nothing to collect under the 2025 Act | 206C(1H) was already omitted from 1 April 2025 by the Finance Act 2025 | high that s.394 has no such item ([s.394](https://www.incometaxindia.gov.in/w/section-394-6)); **medium** for the date it was omitted (not checked against the Finance Act 2025 text) |
| s.206C(1) (TCS on alcoholic liquor) | **s.394(1) Sl. 1** | TCS rate **2% from 1 April 2026** (was 1%; changed by the Finance Act 2026). The "buyer" excludes **a buyer in a retail sale for personal consumption** (s.402(6), Table Sl. 2, col. D(d)). So a bar or restaurant selling to guests does not collect it, but a hotel buying from a distributor pays it. | Rate raised | high ([s.394](https://www.incometaxindia.gov.in/w/section-394-6), [s.402](https://www.incometaxindia.gov.in/w/section-402-6)) |
| s.206AA (higher TDS where no PAN) | **s.397** (compliance and reporting) | — | not read | medium (mapping only) |
| s.200(3) / Form 26Q; 206C(3) / Form 27EQ | **s.397(3)(b)**; **Form 140** (was 26Q), **Form 143** (was 27EQ), **Form 144** (was 27Q) | Quarterly TDS and TCS statements | Renumbered | high (utility, forms entity) |
| Form 16A / Form 27D | **Form 131 / Form 133** (s.395(4)) | TDS and TCS certificates | Renumbered | high |
| Form 26AS | **Form 168** (Annual Information Statement) | — | — | high |
| s.139A (PAN) | **s.262** (rule-making powers in s.262(1)(f) and (10)) | — | — | high ([s.262](https://www.incometaxindia.gov.in/w/section-262-72)) |
| s.272B (PAN default penalty) | **s.467** | — | — | medium (mapping only) |
| **Rule 114B** (transactions needing PAN) | **Rule 159** | See A3: a hotel or restaurant cash bill needs PAN only above **₹1,00,000** | **Threshold raised from ₹50,000 to ₹1,00,000.** Convention centres, banquet halls and event managers are now named alongside hotels and restaurants. | high ([Rule 159](https://www.incometaxindia.gov.in/w/rule-159-1)) |
| **Form 60** (declaration where there is no PAN) | **Form 97** | — | Renumbered | high |
| Rule 114D / Form 61 (statement of Form 60s received) | **Rule 160 / Form 98** | See A3 | Renumbered | high ([Rule 160](https://www.incometaxindia.gov.in/w/rule-160-1)) |
| s.285BA (statement of financial transactions, SFT) | **s.508** | — | — | high (mapping) |
| s.271FA (SFT penalty) | **s.454** | — | — | medium (mapping only) |
| **Rule 114E / Form 61A** (SFT) | **Rule 237 / Form 165** | See A3 | Renumbered | high ([Rule 237](https://www.incometaxindia.gov.in/w/rule-237-1)) |
| s.44AB (tax audit) | **s.63** (tax audit); the utility also maps it to s.58 (presumptive income) | — | — | high (mapping) |
| s.234E (late-filing fee for TDS statements) | **s.427** | — | — | medium (mapping only) |

### A3. What changed from 1 April 2026 that a hotel billing system must know

- **PAN on large cash bills: the threshold is now ₹1,00,000, not ₹50,000.**
  - What the rule requires: under Rule 159(1) Table Sl. 15, PAN must be quoted for "payment to (i) a hotel or restaurant; (ii) a convention centre; (iii) a banquet hall; (iv) any person engaged in event management, against a bill or bills at any one time", where the amount is paid **in cash and exceeds ₹1,00,000**. The person who must see it is the person issuing the bill.
  - Under the 1962 Rules the equivalent rule was 114B, with a cash limit of ₹50,000.
  - Status: in force. Confidence: high.
  - Build note: the check must use **cash paid against the bill or bills at one time**, not the total of the bill.
- **Non-resident guests are exempt from the PAN requirement for Sl. 15 and 16** (Rule 159(6)(b)). Central and State Governments and consular offices are exempt too. Confidence: high.
- **What to do when there is no PAN.**
  - An individual or other non-company, non-firm without a PAN, for Sl. 11–16, gives a **Form 97** declaration (Rule 159(2)(b); Form 97 replaces Form 60).
  - The hotel must:
    - check that the PAN is valid, or that Form 97 is complete;
    - record the PAN, or the fact that Form 97 was given, **in its records for the transaction**;
    - link it in any information later sent to the tax department (Rule 159(5)).
  - The authentication format is left to the Director General of Income Tax (Systems) (Rule 159(8)). Confidence: high.
- **Filing a statement of Form 97s received.**
  - A hotel that receives Form 97 for Sl. 15 or 16 **and** is "required to get his accounts audited under section 58" must:
    - file **Form 98** online with the Directorate of Income-tax (Intelligence and Criminal Investigation): by **31 October** for declarations received up to 30 September, and by **30 April** for those received up to 31 March;
    - **keep each Form 97 for six years** from the end of the financial year (Rule 160).
  - Confidence: high on the text; see "Unresolved" about the reference to "section 58".
- **Other goods or services above ₹2 lakh.** Rule 159 Sl. 16 requires PAN for a sale or purchase of other goods or services of any kind (not listed at Sl. 1–15) above **₹2,00,000 per transaction**, in any payment mode. Whether a large hotel bill paid by card falls here is unresolved (see the end of this document). Confidence: high on the text.
- **The ₹2 lakh cash-receipt ban is unchanged.**
  - s.186 has the same three limbs as 269ST: per person per day, per transaction, and per event or occasion.
  - The penalty under s.451 equals the amount received.
  - Build note: a front desk must stop cash **of ₹2,00,000 or more**, not only amounts above it. The same limit applies to cash collected across several bills of one guest in one day, and across all bills for one event such as a wedding.
  - Confidence: high.
- **Hotels must report cash sales above ₹2 lakh.**
  - Rule 237(2) Table Sl. 12: "receipt of cash payment for sale … of goods or services of any nature" **exceeding ₹2,00,000** must be reported by "any person who is liable for audit under section 63".
  - How: **Form 165**, due **31 May** after the financial year (Rule 237).
  - A hotel under tax audit therefore has to report any such receipts, even though accepting them breaches s.186.
  - Confidence: high.
- **TDS and TCS: the rates are unchanged, but citations and form numbers have changed.** Invoices, TDS certificates, 26AS/Form 168 reconciliation and exported reports must use the new citations and form numbers:
  - "s.393(1) Table Sl. 8(v)" instead of 194-O;
  - Form 131 instead of Form 16A;
  - Form 140 instead of Form 26Q;
  - "tax year" instead of previous year / assessment year.

  The 194J ₹50,000 threshold, the 194H ₹20,000 threshold and the 194-I ₹50,000-a-month threshold started in FY 2025-26 and continue. Confidence: high.
- **TCS on liquor is now 2%** (was 1%) from 1 April 2026, on the hotel's **purchases**. A hotel's own retail sale for personal consumption is not a TCS sale. Confidence: high.
- **Online travel agents (OTAs).** The OTA deducts 0.1% under s.393(1) Sl. 8(v) on the gross booking value, including amounts the guest pays the hotel directly for an OTA booking. No other TDS applies to that transaction. Build note: the system should record the OTA's TDS and reconcile it with Form 168. Confidence: high.
- **Late payments to micro and small suppliers.** A payable to a micro or small supplier that is overdue under s.15 of the MSMED Act is deductible only when paid (s.37(2)(g)).
  - The MSMED Act time limit is 15 days, or up to 45 days if agreed in writing. That comes from the MSMED Act, which was not re-read here.
  - Build note: vendor ageing reports should flag MSE creditors. Confidence: high (medium for the 15/45-day detail).
- **Hotels with turnover above ₹50 crore must offer the prescribed electronic payment modes** (s.187). Confidence: high on the text; the list of modes was not re-verified.
- **Corporate guests may deduct TDS from room bills (not re-verified).** Under the 1961 Act, CBDT Circular 5/2002 treated hotel rooms taken on a regular basis as "rent" for 194-I. Whether the CBDT has carried that forward under s.393 Sl. 2 was not checked. Confidence: **low**. Build note: the system should be able to record TDS deducted by corporate payers.

---

## B. Foreign guests: Form III (formerly Form C)

- **The law in force: the Immigration and Foreigners Act, 2025 (Act 13 of 2025).**
  - Assent: 4 April 2025.
  - In force from **1 September 2025**, under S.O. 3981(E) of 31 August 2025 (F. No. 25022/55/2023-F.I).
  - Links:
    - Act (MHA copy): https://www.mha.gov.in/sites/default/files/2025-09/Immigration_and_Foreigners_Act_2025_16092025.pdf
    - Gazette copy read here: https://prsindia.org/files/bills_acts/bills_parliament/2025/The_Immigration_and_Foreigners_Act,_2025.pdf
    - Commencement notification: https://www.mha.gov.in/sites/default/files/2025-09/Notification_on_commencement_date_of_Immigration_and_Foreigners_Act_2025_16092025.pdf
  - Status: in force. Confidence: **high**.
- **What it replaced.**
  - s.36(1) repeals the Passport (Entry into India) Act 1920, the Registration of Foreigners Act 1939, the **Foreigners Act 1946** and the Immigration (Carriers' Liability) Act 2000. s.36(2) saves things already done under them.
  - The **Immigration and Foreigners Rules, 2025** (G.S.R. 596(E), 1 September 2025, in force from publication) supersede the Passport (Entry into India) Rules 1950, the **Registration of Foreigners Rules 1992 (including old rule 14 / Form C)** and the Immigration (Carriers' Liability) Rules 2007.
  - Rules link: https://www.mha.gov.in/sites/default/files/2025-09/Immigration_and_Foreigners_Rules_2025_16092025.pdf
  - Confidence: **high**.
- **Who must report.** Under **s.8(1)**, the "keeper of accommodation" must report foreigners it accommodates to the Registration Officer as prescribed.
  - "Keeper" means the person in charge of managing the accommodation, or anyone they authorise (s.2(j)).
  - "Accommodation" means temporary or permanent premises of any kind where a foreigner stays (s.2(a)).
  - The duty does not apply to non-commercial residential premises, unless a civil authority directs it for a specified area (s.8(3)).
  - Under **s.8(2)**, the foreigner must give the keeper the particulars asked for.
  - Confidence: **high**.
- **How and when, under Rule 17 of the 2025 Rules.** Confidence: **high**.
  - **17(1).** Every foreigner, **including an OCI cardholder**, must give their particulars and **sign on arrival**. At departure they give the **date and time of departure and the address they are going to**. The keeper must **keep these electronically for at least one year**.
  - **17(2).** The records must be available for inspection on demand by the Registration Officer, the District Magistrate, or police of rank **Head Constable or above**.
  - **17(3) and (4).** Records are kept in English, or otherwise in an Indian language. The keeper must explain the rule to a foreigner who asks.
  - **17(5).** A filled **Form III** must be sent electronically **as soon as possible and within 24 hours of arrival**, through the designated online portal or mobile app. Rule 12(1)(b) names the portal as **https://indianfrro.gov.in**; the hotel login is at https://indianfrro.gov.in/frro/FormC.
  - **17(6).** **Departure details within 24 hours after departure**, by the same channel.
  - **17(7).** "Accommodation" covers boarding houses, clubs, dak-bungalows, rest houses, hostels, PGs, sarais, rented accommodation, homestays, tents, hospitals, and premises of religious or charitable institutions, trusts and similar bodies. "Sign" includes a thumb impression.
- **The fields on Form III**, "[See rules 16, 17(5) and 18(5)] [Earlier FORM 'C']" (from the Gazette text of the Rules):
  - **Premises:** photograph of the guest; name and address of the premises; phone or mobile number of the place of stay.
  - **Foreigner:** full name as in the passport; nationality; passport number; visa number or OCI number, and visa type; contact phone in India; email; other details or remarks.
  - **Arrival (check-in):** arrived from; date of arrival; time of arrival; purpose of visit (Tourism / Business / Employment / Medical / Student / Conference / Others); previous place of stay.
  - **Departure (check-out):** date; time; next destination.
  - Confidence: **high**. The Gazette layout is terse; the portal may ask for more, such as date of birth, passport or visa dates, and arrival date in India. The portal screen was not inspected.
- **Penalties.**
  - **s.23(b)** (breach of the Act, rules or orders where no specific punishment is set): **up to 3 years' imprisonment, or a fine up to ₹3 lakh, or both**.
  - **s.25** allows compounding (settling the offence for a fixed sum). Under **S.O. 3999(E), 1 September 2025**, the FRRO compounds breach of s.8 or rule 17 by a keeper of accommodation for **₹50,000 "in each case"**.
  - Hospitals and educational institutions compound for ₹1 lakh each.
  - Compounding is not available for a repeat offence within 3 years (s.25(2)).
  - Link: https://www.mha.gov.in/sites/default/files/2025-09/NotificationregardingcompoundingofcertainoffencesundertheImmigrationandForeignersAct2025_16092025.pdf. MHA re-uploaded an identical file on 20 January 2026.
  - Confidence: **high**.
- **Exemptions.** The Immigration and Foreigners (Exemption) Order, 2025 (S.O. 3997(E), 1 September 2025) exempts some people, including Nepali and Bhutanese citizens, from the **passport and visa** requirements. **It does not exempt anyone from s.8 or rule 17.**
  - So Nepali, Bhutanese and OCI guests must still be reported.
  - Link: https://www.mha.gov.in/sites/default/files/2025-09/ImmigrationandForeignersExemptionOrder2025_16092025.pdf
  - Confidence: **high** that the Order does not touch s.8 or rule 17.
- **Later amendments do not touch hotels.** The Immigration and Foreigners (Amendment) Rules, 2026 (G.S.R. 424(E), 1 June 2026, in force immediately) change rule 12 registration timing, child-citizenship intimation and a digital appeals route. Rule 17 and Form III are not reported as changed.
  - Source: BDO alert (https://www.bdo.in/en-gb/insights/alerts-updates/immigration-alert-mha-notifies-immigration-and-foreigners-amendment-rules-2026) and All India Radio News. The Gazette was not read.
  - Confidence: **medium**.
- **Re-read 27 September 2026 (D27-25), at the MHA's own PDFs.** Rule 17(1),
  (5), (6), (7) and Form III as above, word for word; Act s.8(1)-(3) and
  Rule 12(1)(b) (the portal) likewise. Exemption Order cl. 3(1)(c): a citizen
  of Nepal or Bhutan needs no passport or visa to enter or stay - so no visa
  number can be demanded of them, but they are still reported. Confidence:
  **high**.
- **What the portal asks (27 September 2026).** Read from the public page
  code of https://indianfrro.gov.in/formIII/ (login needed for the screens;
  nothing was entered). Confidence: **medium** (the code, not a manual).
  - Arrival: surname and given name, gender (Female, Male, Transgender),
    date of birth, nationality, passport number, place, country, date of
    issue and expiry, visa number, place, country, date of issue, expiry,
    type and subtype, date and place of arrival in India, date and time of
    arrival at the hotel, arrived from, previous place of stay, purpose,
    length of stay, expected check-out, an address outside India (address,
    city, country), a reference address in India (address, state, city, PIN
    code), phones and mobiles abroad and in India, email, "employed in
    India", remarks. Required by the page: given name, gender, date of
    birth, nationality, date and time of arrival at the hotel, arrived from,
    previous place of stay, purpose, length of stay, both addresses,
    employment, phone in India, email.
  - Photo: a JPEG between 5 KB and 1 MB, cropped, uploaded or taken with a
    webcam on the page.
  - Check-out: date of departure, time, next destination (all required),
    remark; entered against the arrival's application number.
  - **No upload of guest data and no API**: the page has a "bulk print" of
    forms already filed, nothing that takes a file of guests.
- **No public API for Form III was found.** No public API or bulk-upload specification from the Bureau of Immigration exists in the sources reached. PMS vendors advertise "Form C modules", but their method is not documented publicly.
  - Build note: the system should hold every Form III field, the photograph, the arrival and departure signatures and the 24-hour clocks, and keep records for at least a year. It should not assume there is an API. Confidence: **medium**.

---

## C. State police guest-register rules (Indian and foreign guests)

**Overall finding.** No single central law requires a hotel to collect ID from **Indian** guests or report them to the police. Where the duty exists, it comes from four places:

1. state tourism-trade laws;
2. the Sarais Act, 1867, where a state still applies it;
3. state police Acts and commissioners' notifications;
4. time-limited orders under **s.163 BNSS** (formerly s.144 CrPC). No such order may run beyond **2 months**, unless the State Government extends it by notification for **up to 6 more months** (s.163(4); text read on indiankanoon.org/doc/147434038, confidence medium-high).

Taking photo ID from every adult is **commonly asked**, and many district orders demand it, but it is **not a nationwide statutory rule**. Foreign guests are different: section B applies everywhere. Confidence: **medium**. It is hard to prove a negative across 36 states and union territories.

- **Himachal Pradesh: statutory.**
  - Rule 13(2) of the HP Tourism Development and Registration of Tourism Trade Rules, 2012 (Notification TSM-A(3)-1/2008, 17 August 2012, under the HP Tourism Development and Registration Act 2002). Every registered hotel must keep a **guest register or guest registration card in the Annexure A format**, approved by the prescribed authority, plus numbered bill and receipt books. If billing is computerised, a soft copy must be kept.
  - **Rule 13(2)(b): no guest may be let into a room until their particulars are entered.**
  - Annexure A columns: name and full address; room number; date and time of arrival; date and time of departure; number of persons including children; nationality; arrived from. For foreigners also: passport number, date and place of issue and validity; visa number, date of issue and validity, and registration certificate details; date of arrival in India. Then: lodging rate per day; advance paid; guest's signature.
  - Link: https://himachaltourism.gov.in/wp-content/uploads/2018/09/58e76f88225c2_H.P.-Tourism-Trade-Rules-2012.pdf
  - Confidence: **high** on the 2012 text; later amendments were not checked.
  - The Home Stay Rules 2025 were a draft in February 2025 (https://himachaltourism.gov.in/wp-content/uploads/2025/02/Draft-HP-Home-Stay-Rules-2025.pdf); whether they were made final was not verified (**low**).
- **Gujarat: "Pathik" (Programme for Analysis of Traveller and Hotel Informatics), an Ahmedabad Police system.**
  - Hotels must upload guest details in **real time** from a computer at reception, under Police Commissioner and district notifications.
  - Ahmedabad police prosecuted a hotel manager under the Gujarat Police Act for not uploading (Gujarat Samachar, 27 February 2026). The article does not give the section.
  - Navsari district's notification of 7 April 2020 exists (https://navsari.nic.in/document/pathik-app-notification/), but it is a **scanned image and could not be read**.
  - Confidence: **medium** that it is compulsory in practice. **Primary legal basis not read.**
- **Goa.** Goa Police adopted Pathik (the Goa Police citizen portal has an event page dated 13 January 2023). News reports say uploading is mandatory. Goa Police advisories also push online C-Forms (https://citizen.goapolice.gov.in/documents/10184/15201/Advisory+to+register+Online+C-Form.PDF/c46dc37d-5c05-40f1-b38c-b094390aa481; this cites the pre-2025 law).
  - A search of the Goa Registration of Tourist Trade Act 1982 text found **no guest-register section**.
  - Confidence: **low to medium**. No primary order making Pathik compulsory was found.
- **Maharashtra.**
  - s.33 of the Maharashtra Police Act 1951 (read on indiankanoon, because India Code was unreachable) covers places of public amusement and **registration of eating houses** (s.33(1)(xa)). **No lodging-house guest-register clause was found** in it.
  - Guest-ID and register duties come from district and commissioner orders. Example: the Raigad Collector's 2026 order, reported by the Free Press Journal on 22 June 2026, requires:
    - guest ID, contact, address, purpose of visit and vehicle;
    - check-in and check-out times;
    - no unaccompanied minors;
    - CCTV footage kept 30 days;
    - guest records kept **2 years**;
    - Form C within 24 hours;
    - enforcement under **s.223 BNS**.
  - Primary order not read. Confidence: **low to medium**. No state-wide online portal was found.
- **Uttar Pradesh.** **No state-wide online hotel-guest portal ("e-Sarai" or similar) was found** on uppolice.gov.in or elsewhere. District orders under s.163 BNSS are the likely source.
  - The **Sarais Act 1867** (central Act, still used in some states such as Odisha and Assam) requires sarais to register. Its s.7 duties, as quoted by Bhubaneswar-Cuttack Police (https://bhubaneswarcuttackpolice.gov.in/wp-content/uploads/2020/01/sarais_act_1867-1.pdf), are: notify infectious illness or death, allow inspection, cleanliness, watchmen and displaying tariffs.
  - Whether s.7 also requires a daily report of guests when a Magistrate orders it is unresolved (see the end).
  - Confidence: **low** for UP specifically.
- **Rajasthan. No "Pathik" or state portal was found.** One secondary report mentions a Jaipur "E-Visitor" portal linked to the police control room (jaipurstuff.com, not opened). Another says guest details are still handed to police stations on paper.
  - Confidence: **low**. The brief's "Rajasthan Pathik" could not be confirmed. Pathik is a Gujarat system, also used by Goa.
- **Delhi.**
  - Delhi Police Licensing still lists a Hotel/Guest House service: https://licensing.delhipolice.gov.in/service/hotelguesthouse
  - Asian Hospitality reports that Delhi abolished police licences and NOCs for hotels and guest houses and moved licensing to local bodies. The article was not opened, so its date and legal instrument are unknown.
  - No current Delhi guest-register order was found.
  - Confidence: **low**.
- **Other examples of the pattern** (secondary sources only, low):
  - the Indore Police Commissioner's s.163 BNSS order of 4 November 2025, with FIRs against 13 operators (ANI, 12 November 2025);
  - the Bhopal Police Commissioner's s.163 order (visionmp.com);
  - Gurugram District Magistrate s.163 directions (DC Gurugram on X).

  All require guest registers and ID copies to be shared with the police station.

**Build notes for the system:**

- Make guest-register fields configurable by state or district, including ID type and number, ID image, purpose, arrived-from, going-to, vehicle and minor checks.
- Support a configurable **retention period**: 1 year minimum for foreigners (rule 17), 2 years under the Raigad order, and so on.
- Allow an **export or upload adapter** per police portal, such as Pathik.
- Do **not** hard-code "ID is legally mandatory for every Indian guest" as a nationwide rule.

---

## D. Service charge

- **The CCPA guidelines of 4 July 2022.**
  - Source: F.No. J-25/57/2022-CCPA, "Guidelines to prevent unfair trade practices and protection of consumer interest with regard to levy of service charge in hotels and restaurants", issued under **s.18(2)(l) of the Consumer Protection Act 2019**.
  - Link: https://ccpa.doca.gov.in/files/guidelines-to-prevent.pdf (listed at https://ccpa.doca.gov.in/guidelines.php)
  - Paragraph 7:
    - (i) no service charge added **automatically or by default** to the bill;
    - (ii) no collecting it **under any other name**;
    - (iii) no forcing guests to pay it; they must be told clearly that it is **voluntary, optional and at their discretion**;
    - (iv) no restricting entry or service on the basis of it;
    - (v) **not added to the food bill with GST levied on the total**.
  - Paragraph 8: the guidelines add to the Department of Consumer Affairs guidelines of 21 April 2017.
  - The reasoning (paras 4–5): service is already part of the menu price, and a tip is a separate, discretionary matter decided after the meal.
  - Status: in force. Confidence: **high**.
- **The Delhi High Court upheld them on 28 March 2025.**
  - Case: *National Restaurant Association of India v. Union of India* (W.P.(C) 10683/2022), with *FHRAI v. Union of India* (W.P.(C) 10867/2022). Neutral citation **2025:DHC:2084**. Justice Prathiba M. Singh.
  - Links: https://indiankanoon.org/doc/139015092/ and https://indiankanoon.org/doc/156339154/. The court's own copy was not found; the court site's homepage loads, but the judgment PDF was not located and the case-status site timed out.
  - Para 174 conclusions:
    - the CCPA had power to issue the guidelines, and they are **binding**;
    - there is no breach of Article 19(1)(g);
    - service charge or a tip is **voluntary** and cannot be compulsory;
    - the different names used for it are misleading, an **unfair trade practice** under s.2(47);
    - making it a condition of service is an unfair contract term under s.2(46);
    - a voluntary tip is not barred, but **"ought not to be added by default in the bill/invoice"** (para 174(viii));
    - the CCPA **may consider** allowing names such as "voluntary contribution", "staff contribution" or "staff welfare fund" (para 174(ix)).
  - Para 175: the guidelines are upheld. Para 176: all restaurant establishments must follow them.
  - **Para 177: the petitions were dismissed with costs of ₹1 lakh each, to be deposited with the CCPA for consumer welfare.**
  - Confidence: **high**.
- **The Division Bench appeals are still pending, and no stay has been reported.**
  - NRAI and FHRAI appealed to a Division Bench of Chief Justice D.K. Upadhyaya and Justice Tushar Rao Gedela.
  - Hearings: 9 May 2025 adjourned ("board very heavy", **no interim stay**; LiveLaw). 22 August 2025, when the bench questioned the associations and asked GST counsel to attend, with the next date 22 September 2025 (LawBeat, 23 August 2025).
  - **No report of a Division Bench judgment or stay was found up to 25 September 2026.** The CCPA was still passing service-charge orders in September 2026, which suggests no stay.
  - The appeal (LPA) numbers were not found.
  - Confidence: **medium**. The search budget ran out before 2026 cause lists could be checked.
- **CCPA enforcement in 2025–26.** The CCPA orders page (https://ccpa.doca.gov.in/ccpa-orders.php?page_no=1) lists service-charge orders against:
  - Cafe Blue Bottle, Patna (13 November 2025);
  - **China Gate Restaurant Pvt Ltd (Bora Bora), 29 December 2025**;
  - Barbeque Nation (4 February 2026);
  - FOO Ahmedabad (6 April 2026);
  - Chaayos (14 July 2026);
  - Ranisa (11 August 2026);
  - Amour Bistro (18 August 2026);
  - Cafe Delhi Heights (25 August 2026);
  - Zen Restaurant (9 September 2026).

  News of 20 July 2026 reports suo motu action (on its own initiative) against 41 restaurants.

  **The China Gate order is the one that matters for billing software** (Case No. CCPA-2/26/2025-CCPA; https://ccpa.doca.gov.in/checkuploaddocs.php?updocs=./uploads/1767008364-Final_Order.pdf&unique_id=):
  - The CCPA found that the charge came from a **command built into the billing software**, which added service charge to every bill.
  - It also noted that GST had been levied on the service charge.
  - It directed the restaurant **"to modify its software generated billing system by removing default addition of service charge or charge by any other name"**.
  - It imposed a **₹50,000 penalty** under ss.20–21 (up to ₹10 lakh is possible, and ₹50 lakh for repeat breaches).
  - Confidence: **high** for the China Gate order, which was read. The other orders were read only as titles and dates.
- **What a billing system therefore must not do.** Confidence: high for 1–5; medium for 6–7.
  1. Add a service charge (or any renamed equivalent) **automatically, by default, or pre-selected** on any F&B or room bill.
  2. Use another name ("staff charge", "SC", "hospitality fee") to get round rule 1.
  3. Build it into the taxable value of the bill and compute GST on food plus service charge.
  4. Make it a condition of entry or service, or make it impossible to remove.
  5. Hide that it is optional. If there is any tip or contribution line, it must be **empty or zero by default** and filled only on the guest's explicit choice, preferably after the service.
  6. Assume that "staff contribution" is now permitted. The court only said the CCPA **may consider** it, and no CCPA notification permitting it was found.
  7. The guidelines and the judgment are written about hotels **and** restaurants, but mostly about **food bills**. Applying them to room or banquet "service charges" follows from the same reasoning and the CCPA's powers, but is an **inference**.

---

## E. Announced but not yet in force (income tax and foreigner reporting)

Very little that is announced-but-not-in-force affects hotel billing or foreigner reporting. Everything in A, B and D above is already in force.

| Item | Source | Effective date | Relevant to hotels? | Confidence |
|---|---|---|---|---|
| s.393(6)(b): Form 15G/15H-type nil-TDS declarations can be filed electronically with a depository (units, securities interest, dividends) | Finance Act 2026 (Act 4 of 2026), shown in the CBDT text of s.393 | **1 April 2027** | Not for billing | high |
| Rule 12 registration deadline for valuers and authorised income-tax practitioners extended | Income-tax (Fourth Amendment) Rules 2026, 17 September 2026 | Deadline **31 March 2027** | No | medium |
| s.35 of the Immigration and Foreigners Act: the Centre may issue "removal of difficulties" orders | IFA 2025 s.35 | Possible until **31 August 2028** (3 years from commencement) | Could change Form III practice | high (text) |
| s.8(3) of the Immigration and Foreigners Act: a civil authority may extend reporting to **non-commercial residential premises** in a specified area | IFA 2025 s.8(3) | Whenever a direction is issued; none found | Homestays and hosts | high (text) |
| Outcome of the Delhi High Court Division Bench appeal on service charge | Appeals by NRAI and FHRAI | Pending; no date known | Yes (section D) | medium |
| CCPA permitting renamed voluntary tips ("staff contribution" etc.) | Delhi High Court para 174(ix) | Only a suggestion; no CCPA action found | Yes | medium |
| HP Home Stay Rules 2025 | Draft of February 2025 | Final status unknown | Homestays in HP | low |

---

## Unresolved, or where sources disagree

1. **Rule 160(2)(b) refers to "section 58" as the tax-audit section.** The CBDT utility maps old s.44AB to both s.58 and **s.63**, and titles s.63 "Tax audit". Rule 237 Sl. 12 says "section 63". So it is unclear which hotels must file **Form 98**; the obvious reading is those under tax audit. Ask a chartered accountant, or check the Gazette text of the Rules.
2. **Does a hotel bill above ₹2 lakh paid by card need PAN under Rule 159 Sl. 16?** Sl. 16 covers goods or services "other than those specified at Sl. Nos. 1 to 15". Sl. 15 names hotels and restaurants, but only for cash. This ambiguity is carried over from old rule 114B, items 11 and 18.
3. **The 1 April 2026 start date of the Rules** is from secondary sources; the notification PDF was blocked (403).
4. **The date 206C(1H) was omitted (1 April 2025, by the Finance Act 2025)** is from memory and was not checked against the Finance Act text. That no equivalent exists under the 2025 Act is verified.
5. **The CBDT pages for s.36 and s.393** used for some checks are marked "Year 2025". The s.393 "Year 2026" page was compared and its rates are unchanged. s.36 was not compared.
6. **Whether room nights booked regularly by corporates are still "rent" for TDS** under s.393 Sl. 2 (the 1961 position under Circular 5/2002) was not verified.
7. **GST on voluntary tips.** The CCPA says the charge must not be added to the food bill with GST on the total. The Division Bench asked GST counsel to appear (August 2025). How a genuinely voluntary tip is treated for GST is **not settled** in the sources reached.
8. **Whether s.7 of the Sarais Act requires daily guest reports.** A search-engine summary attributed to India Code says a keeper must report daily when a Magistrate orders it. The Bhubaneswar-Cuttack Police extract of s.7 lists only seven clauses and has no such duty. India Code could not be opened to settle it.
9. **Gujarat and Goa Pathik, Raigad, Delhi, UP and Rajasthan:** the primary orders were **not read**, because they were scanned images, could not be found, or the search budget had run out. The brief's "UP e-Sarai" and "Rajasthan Pathik" could **not be confirmed to exist**.
10. **Form III on the portal may ask for more than the Gazette form shows**, such as date of birth, passport and visa dates, and arrival date in India. The portal screens were not inspected, because login is required.
11. **The old Foreigners Order 1948**, in particular what happened to its hotel-reporting parts after the 1946 Act was repealed, was not checked. The 2025 Rules and Exemption Order supersede the 1992 Rules and the 1957 Exemption Order; the 1948 Order is not named in either.
12. **The Delhi High Court judgment was read on indiankanoon**, not the court's site; the case numbers and paragraph numbers come from there.
