# Selling hotel PMS software in India: the legal position on 25 September 2026

Research only. This is not legal or tax advice. A chartered accountant or advocate should confirm every point before it is relied on.

- **Scope:** an Indian company sells a hotel PMS to other Indian hotel groups, either
  - **(A) SaaS:** the vendor hosts it, with one server per buyer; or
  - **(B) Licence plus yearly support:** the buyer runs it.
- **How it was checked:** primary texts were read directly wherever they could be reached. Downloaded texts were searched with `pdftotext`/`grep`. Secondary sources were used only to find the primary text, and each is flagged where it is the only source.
- **Bullet format:** rule — source — link — status — confidence.

---

## 1. GST on the vendor's own sales

### 1.1 Classification (SAC)

The explanatory notes say that where two descriptions could apply, the most specific one wins. Every candidate code below attracts **18%**, so the choice of code does not change the tax.

- **SaaS (hosted, per-buyer instance): SAC 998315** "Hosting and IT infrastructure provisioning services".
  - Item (ii) of the note: *"provision of leased software applications from a centralized, hosted, and managed computing environment … where the leased application is not customized"*. It adds that consulting, customisation and integration are frequently bundled with it.
  - The note to 998314 sends "design and development … bundled with the hosting and management of the application on an ongoing basis" to 998315 as well.
  - **Alternative: 998439** ("software that is intended to be executed on-line"). Either is defensible; 998315 describes a managed, per-client instance more precisely.
  - Source: Explanatory Notes to the Scheme of Classification of Services, pp. 53–54 and 70–71 — https://www.gstcouncil.gov.in/sites/default/files/2024-02/explanatory_notes_01oct19.pdf — in force — **high** (text read).
- **Licence where the buyer runs the software: not a clean fit for 997331.**
  - 997331 "Licensing services for the right to use computer software and databases" covers rights to *reproduce, distribute or incorporate* software.
  - Its note expressly **excludes** "packaged (non-customized) software" and a "limited end-user licence as part of packaged software".
  - For a standard end-user licence, the fitting codes are:
    - **998434** "Software downloads", when delivered by download;
    - **HSN 8523** (goods), when delivered on physical media; canned software is goods, per *Tata Consultancy Services v State of AP* (SC 2004);
    - **998314** item (vi) "software originals", or (ii) customisation, when bespoke.
  - The rate entry for IP licensing is Notification 11/2017-CT(Rate) Sl. 17(ii), heading 9973: "Temporary or permanent transfer or permitting the use or enjoyment of Intellectual Property (IP) right", CGST 9% (substituted by Notif. 06/2021-CT(R)).
  - CGST Act Sch. II para 5(d) treats development, customisation, upgradation, enhancement and implementation of IT software as a supply of **services**.
  - Sources: the Explanatory Notes above; Notif. 11/2017-CT(R) — https://gstcouncil.gov.in/node/4432 (original PDF: https://cbic-gst.gov.in/hindi/pdf/central-tax-rate/Notification11-CGST.pdf) — in force.
  - Confidence: **medium** on the code, **high** that it is 18% whichever code applies.
- **Implementation, configuration and installation: 998314** item (ii): "customization and integration, adapting (modifying, configuring, etc.) and installing an existing application". Source: Explanatory Notes p. 53 — in force — **high**.
- **Support, AMC, patches and updates: 998313** item (ii): "customer support in using or troubleshooting the software, upgrade services and the provision of patches and updates". Source: Explanatory Notes p. 52 — in force — **high**.
- **Managing the buyer's own servers** (licence model): 998316, "IT infrastructure and network management". Project management is 998319. Source: Explanatory Notes p. 54 — **high**.
- **Hosting on its own:** 998315 item (i). Source: same — **high**.
- **Training:** 999293 (commercial training and coaching) or 999294 (which lists "computer training services"), heading 9992, which is taxable at 18% when not exempt.
  - If training is naturally bundled with the subscription, it is a **composite supply** taxed at the principal supply's rate (CGST Act s.8(a)). That is 18% either way.
  - Source: Explanatory Notes p. 107 — **medium** (the 9992 rate entry was not re-read).

### 1.2 Rate after the September 2025 rationalisation

- **The rate stays 18% for all of the codes above.**
  - Notif. **15/2025-Central Tax (Rate)** dated 17 Sep 2025, effective **22 Sep 2025**, amended Sl. 21 (heading 9983) only by omitting item (ia) and re-wording item (ii) to "Other professional, technical and business services other than (i) above and serial number 38 below". The CGST rate of 9% was left unchanged.
  - Sl. 17 (9973) and Sl. 22 (9984) were not touched.
  - Sources:
    - CBIC viewer (JavaScript-only): https://taxinformation.cbic.gov.in/view-pdf/1010466/ENG/Notifications
    - Text read from a republished gazette copy: https://taxo.online/wp-content/uploads/2025/09/15-2025-CTR-eng.pdf
  - Status: in force. Confidence: **high**.
- **Software on media (HSN 8523): 18%.**
  - It is S.No. 495 in **Schedule II (9% CGST)** of Notif. **9/2025-Central Tax (Rate)** dated 17 Sep 2025, effective 22 Sep 2025.
  - Source: text read from the gazette copy https://taxo.online/wp-content/uploads/2025/09/09_2025-CTR.pdf
  - Status: in force. Confidence: **high**.

### 1.3 Place of supply and which tax applies

- **B2B services: IGST Act s.12(2)(a).** The place of supply for a registered recipient is "the location of such person". So:
  - a buyer's GSTIN in another state → **IGST**;
  - a buyer's GSTIN in the vendor's own state → **CGST + SGST**.
  - For an unregistered recipient (s.12(2)(b)), it is the recipient's address on record, or the supplier's location if there is none.
  - Training for a registered person (s.12(5)(a)) gives the same result.
  - Source: IGST Act s.12 — https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_IGST_Act/active/chapterv/section12_v1.00.html — in force — **high**.
- **Invoicing a multi-state hotel group.**
  - Since **1 Apr 2025**, an office that receives *common* input services for distinct GSTINs (the same PAN in other states) must register as an **Input Service Distributor** and pass on the credit.
  - Changes: CGST s.2(61) and s.20 were substituted by the Finance Act 2024, with the date fixed by Notif. 16/2024-CT; the Rule 39 changes were dated by Notif. 09/2025-CT.
  - Practical consequence: offer **one invoice per state GSTIN**, so buyers do not need ISD.
  - Source: secondary (e.g. https://www.bdo.in/en-gb/insights/alerts-updates/indirect-tax-alert-the-effective-date-of-amendments-made-vide-finance-act-2024); the section text was not re-read — **medium**.

### 1.4 Registration

- **Threshold (CGST Act s.22(1)).** Registration is required once aggregate turnover in a financial year exceeds **₹20 lakh**, or **₹10 lakh** in a special category state.
  - Explanation (iii) takes the Art. 279A(4)(g) list and removes J&K, Arunachal Pradesh, Assam, Himachal Pradesh, Meghalaya, Sikkim and Uttarakhand.
  - That leaves **Manipur, Mizoram, Nagaland and Tripura** at ₹10 lakh.
  - Registration is in the state "**from where**" the supply is made, not the buyer's state.
  - Source: https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter6/section22_v1.00.html — in force — **high**.
- **Inter-state services below the threshold.**
  - CGST s.24(i) requires registration for anyone making inter-state taxable supplies.
  - **Notif. 10/2017-Integrated Tax (13 Oct 2017)**, issued under s.23(2) CGST, exempts "persons making inter-State supplies of taxable **services**" with all-India aggregate turnover ≤ ₹20 lakh (≤ ₹10 lakh in special category states other than J&K).
  - Sources:
    - https://cbic-gst.gov.in/hindi/pdf/integrated-tax/10_2017_IT.pdf (English text; read)
    - s.24: https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter6/section24_v1.00.html
  - Status: in force. Confidence: **high**.
- **Register anyway.**
  - B2B buyers can only take input tax credit against a GST invoice from a registered supplier, and voluntary registration is allowed (s.25(3)).
  - If the selling company already runs hotels, it is already registered and the point is moot. It only needs to add the new services to its registration (a non-core amendment).
  - **High** (on the law).

### 1.5 Aggregate turnover is counted across the whole PAN

- **CGST s.2(6)** "aggregate turnover" covers all taxable and exempt supplies, exports and inter-state supplies "of persons having the same Permanent Account Number, to be computed on all India basis".
  - If the software is sold by **the same company that runs the hotels**, the hotel room, F&B and banquet turnover **counts**.
  - A separate company (a separate PAN) counts only its own turnover.
  - Source: https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter1/section2_v1.00.html — in force — **high**.

### 1.6 E-invoicing of the vendor's own invoices

- **The rule.** CGST Rule 48(4) with Notif. 13/2020-CT, as amended by **Notif. 10/2023-CT (10 May 2023)**: from **1 Aug 2023**, e-invoicing is mandatory once aggregate turnover **in any preceding financial year from 2017-18 onwards** exceeded **₹5 crore**.
  - It applies to B2B invoices, credit notes and debit notes.
  - Hotels and software are not in the exempt classes, which are banks, insurers, GTA, passenger transport, cinema admission, SEZ units and government departments.
  - The hotel company has almost certainly crossed ₹5 crore in some year, so **its software invoices must be e-invoices from the first sale**.
  - Source: https://www.gstcouncil.gov.in/node/4365 — in force — **high**.
- **30-day reporting limit.** Taxpayers with annual aggregate turnover **≥ ₹10 crore** cannot report an invoice to the IRP more than **30 days** after its date. This has applied since **1 Apr 2025**.
  - Source: GSTN advisory — https://einvoice6.gst.gov.in/content/revised-time-limit-for-e-invoice-reporting-for-businesses-with-aato-of-%E2%82%B910-crores-above/ — in force — **high**.
- **Lower threshold.** No reduction below ₹5 crore has been notified. Talk of ₹2 crore is speculation only.
  - Source: secondary search only — **medium**.

### 1.7 Can a hotel on 5% "no-ITC" room tariffs claim ITC on the software?

- **The rate entry.** Accommodation of **≤ ₹7,500 per unit per day** is taxed at 2.5% + 2.5%, on the condition that "credit of input tax charged on goods and services used in supplying the service has **not been taken** [Please refer to Explanation No. (iv)]".
  - This comes from Sl. 7 item (i) of 11/2017-CT(R), as amended by **15/2025-CT(R)** with effect from 22 Sep 2025.
  - Rooms above ₹7,500 remain at 18% **with** ITC.
  - Source: the 15/2025 text above — in force — **high**.
- **Explanation (iv), para 4 of 11/2017-CT(R)** gives the condition its meaning:
  - (a) credit on inputs or services used **exclusively** for that 5% service is not taken;
  - (b) credit on inputs or services used **partly** for it and partly for ITC-eligible supplies "is reversed as if supply of such service is an **exempt supply**", under CGST s.17(2) and **Rules 42/43**.
  - Source: the consolidated 11/2017 text (read), plus Rule 42 at https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter5/rule42_v1.00.html — in force — **high**.
- **In practice.** A PMS subscription is a **common input service**.
  - The hotel may take ITC on it, then reverse the share attributable to its ≤ ₹7,500 room turnover under Rule 42.
  - It keeps the share for its 18% supplies: rooms above ₹7,500, restaurants in "specified premises", banquets and the like.
  - A hotel whose supplies are **all** 5%-no-ITC keeps effectively **none**, so the 18% GST is a real cost to it. This is a pricing point for budget hotels.
  - Software is not a blocked credit under s.17(5).
  - **High** on the law, **medium** on how it plays out hotel by hotel.

### 1.8 GST TDS (CGST s.51)

- **GST TDS applies only to government buyers.** Only the following deduct **2%** (1% + 1%, or 2% IGST), and only where the contract value exceeds **₹2.5 lakh**:
  - government departments;
  - local authorities;
  - government agencies;
  - persons notified under Notif. 50/2018-CT (bodies with ≥51% government equity or control, societies, PSUs).
- Private hotel groups do not deduct GST TDS.
- Source: https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter10/section51_v1.00.html — in force — **high** (the section's scope was confirmed; Notif. 50/2018 was not re-read).

---

## 2. Income-tax TDS the buyer deducts (Income-tax Act 2025, in force 1 Apr 2026)

- **The new Act.** The **Income-tax Act, 2025 (No. 30 of 2025)** replaced the 1961 Act from **1 Apr 2026**. The **Income-tax Rules, 2026** were notified as G.S.R. 198(E) on 20 Mar 2026, also effective 1 Apr 2026.
  - The Act's text was read from the e-Gazette of 21 Aug 2025: https://egazette.gov.in/WriteReadData/2025/265620.pdf
  - The official "as amended by Finance Act 2026" PDF (https://www.incometaxindia.gov.in/documents/d/guest/income_tax_act_2025_as_amended_by_fa_act_2026-pdf) **returned 403 and could not be reached**.
  - The Rules were confirmed through secondary reports only.
  - Confidence: **high** on the text as enacted; **medium** that the Finance Act 2026 left the items below unchanged.
- **The successor to s.194J: s.393(1), Table Sl. No. 6(iii).**
  - It covers "any sum by way of (a) fees for professional services; (b) fees for technical services; (c) director remuneration …; (d) **royalty**; (e) any sum referred to in s.26(2)(h)".
  - It is paid by a "**specified person**", defined in s.402(37): any person other than an individual or HUF, or an individual or HUF whose business turnover exceeds ₹1 crore or professional receipts exceed ₹50 lakh.
  - **Rate:**
    - **2%** for fees for technical services (not professional services), film royalty, and call-centre payees;
    - **10%** in all other cases, which means professional fees and **software royalty are at 10%**.
  - **Threshold: ₹50,000** "for (a), (b), (d) and (e)"; nil for director remuneration.
  - The Act's text was read. The Finance Act 2026 changed only the "manpower supply = work" point and TCS rates, not these (per https://blog.tdsman.com/2026/02/key-tds-tcs-proposed-changes-in-budget-2026-27/).
  - Status: in force. Confidence: **high**.
- **The successor to s.194C: s.393(1), Table Sl. No. 6(i).**
  - "Any sum for carrying out any work" under a contract with a "designated person".
  - **1%** if the contractor is an individual or HUF, **2%** otherwise.
  - Threshold **₹30,000** for a single sum, **₹1,00,000** in aggregate.
  - "Work" (s.402(47)) is advertising, broadcasting, carriage, catering, manufacturing to the customer's specification, and, since 1 Apr 2026, manpower supply. **Software services are normally not "work"**, so they fall under Sl. 6(iii).
  - Source: e-Gazette PDF — in force — **medium-high**.
- **A licence to use software is "royalty".**
  - s.9(6)(b)(vi) together with **s.9(6)(c)(i)**: royalty "includes transfer or grant of all or any right for use or right to use a computer software (**including granting of a licence**) irrespective of the medium".
  - This definition applies to TDS through s.402(30).
  - So a buyer paying the developer for a licence deducts **10%** (Sl. 6(iii)).
  - Source: e-Gazette PDF — in force — **high**.
- ***Engineering Analysis Centre of Excellence v CIT*** (Supreme Court, 2 Mar 2021, CA 8733-8734/2018).
  - EULA and distribution payments to **non-residents** are not "royalty" under the tax treaties because no copyright is transferred, so there is no s.195 TDS.
  - The case turned on **treaty** definitions. For payments between two residents there is no treaty, so the Act's broad definition above governs.
  - Source: judgment copy at https://indiankanoon.org/doc/170521216/ (secondary host; sci.gov.in not fetched) — **high** on the holding, **medium** on applying it to domestic payments.
- **CBDT Notification 21/2012 (13 Jun 2012).**
  - It removes TDS on software bought in a **subsequent** transfer, **without modification**, where tax was already deducted on the earlier transfer and the buyer has a declaration and the transferor's PAN.
  - It **does not help the vendor's own direct sale**, because that is the first transfer by the developer.
  - Under the 2025 Act it is deemed continued by **s.536(2)(j)** as if issued under the corresponding provision, **s.400(1)**, "so far as it is not inconsistent".
  - No re-notification under the 2025 Act was found.
  - Link: https://incometaxindia.gov.in/Communications/Notification/920110000000000195.htm (**403 from here**). s.536 was read in the e-Gazette PDF.
  - Confidence: **medium**.
- **A SaaS subscription is unsettled.**
  - No statute, CBDT circular or Supreme Court ruling classifies a SaaS subscription paid by one resident to another.
  - Arguments available:
    - **royalty** (the "use or right to use" software limb, or the industrial or commercial equipment limb in s.9(6)(b)(v)) — **10%**;
    - **fees for technical services** — **2%**;
    - **neither**, because it is a standardised automated service with no human technical service. Some tribunal rulings in non-resident cases take this view.
  - Common practice among buyers is to deduct 2% or 10%.
  - The deduction is **credited to the vendor** against its own tax, so the effect is on cash flow, not on cost. The vendor can apply for a lower-deduction certificate (**s.395**).
  - **Low** confidence; see Unresolved.
- **Implementation and support.** These are usually treated as fees for technical services (**2%**). However, "professional services" (s.402(28)) includes "**technical consultancy**", so a consulting-heavy contract could be deducted at 10%. **Medium-low**.
- **The vendor's own TDS and TCS: nothing specific to software.**
  - It has the ordinary payer duties: salaries (s.392), and contractors, consultants and rent (s.393).
  - TCS on the sale of goods (old s.206C(1H)) was omitted from 1 Apr 2025 (**medium**, not re-read).
  - If it pays non-resident cloud providers, s.393(2) TDS and GST reverse charge on imported services apply (**medium**).
- **GST TDS applies only to government buyers** (see §1.8).

---

## 3. MSME / Udyam

- **Udyam registration.** It is free, online and based on self-declaration, at https://udyamregistration.gov.in, under S.O. 2119(E) of 26 Jun 2020.
  - **Revised limits from 1 Apr 2025** (S.O. **1364(E)** of 21 Mar 2025). Each band is an investment cap and a turnover cap, and both must be met:

    | Band | Investment in plant, machinery or equipment | Turnover |
    |---|---|---|
    | Micro | ≤ ₹2.5 crore | ≤ ₹10 crore |
    | Small | ≤ ₹25 crore | ≤ ₹100 crore |
    | Medium | ≤ ₹125 crore | ≤ ₹500 crore |

  - Sources: https://www.dcmsme.gov.in/Notification-S.O-no-1364-E-dated-21.03.2025-Revised-Definition.pdf (reached) and the e-Gazette copy https://egazette.gov.in/writeReadData/2025/261838.pdf (reached).
  - Status: in force. Confidence: **high**.
  - **Caution:** classification is per enterprise (PAN). If the **hotel company itself** sells the software, its hotel plant, equipment and turnover count, and it may be **medium or above**. Medium enterprises get **none** of the protections below. **Medium**.
- **Who is protected.** MSMED Act s.2(n): a "supplier" is a micro or small enterprise "which has filed a memorandum", now Udyam.
  - Source: government copy of the Act, read at https://www.msmediagra.gov.in/writereaddata/msmedact.pdf (ministry copy, scanned: https://samadhaan.msme.gov.in/WriteReadData/DocumentFile/MSMED2006act.pdf) — **high**.
- **s.15, payment period.**
  - The buyer pays by the agreed date. The agreed period "in no case" exceeds **45 days** from acceptance or deemed acceptance.
  - Where nothing is agreed, payment is due before the "appointed day", which is 15 days after acceptance (s.2(b)).
  - **High**.
- **s.16, interest.**
  - Interest is **compound with monthly rests at three times the RBI bank rate**.
  - It applies "notwithstanding anything contained in any agreement".
  - s.23 makes that interest **non-deductible** for the buyer.
  - **High**.
- **Other supplier protections.**
  - s.18: disputes can be referred to the **MSE Facilitation Council**. This overrides a private arbitration clause (*Gujarat State Civil Supplies v Mahakali Foods*, SC 2022).
  - s.22: the buyer's audited accounts must disclose unpaid MSE dues.
  - **High**.
- **Income-tax Act 2025 s.37(2)(g), the successor to s.43B(h).**
  - An "amount payable by the assessee to a **micro or small enterprise** beyond the time limit specified in section 15" is deductible **only in the year it is actually paid**.
  - s.37(3) allows payment by the return due date for other items but **excludes clause (g)**.
  - So a buyer that has not paid a micro or small vendor within 45 days by 31 March **loses the deduction for that year**. This is the strongest reason buyers pay Udyam-registered small vendors on time.
  - Source: e-Gazette PDF, s.37 — in force — **high**.
- **Register before the first contract.**
  - *Silpi Industries v KSRTC* (SC 2021): a registration obtained after the contract works only prospectively.
  - *NBCC (India) v State of WB* (2025 INSC 54, 10 Jan 2025) doubted this for s.18 and **referred the question to a larger bench**, which is **pending**. Judgment: https://api.sci.gov.in/supremecourt/2022/24558/24558_2022_12_1501_58501_Judgement_10-Jan-2025.pdf
  - Registering **before the first contract** avoids the question.
  - **Medium**.

---

## 4. Contracts

- **Governing law and courts.**
  - Choose Indian law and a named seat or court.
  - An exclusive-jurisdiction clause is valid only if the chosen court already has jurisdiction (*A.B.C. Laminart*, SC 1989).
  - Indian Contract Act 1872: https://www.indiacode.nic.in/handle/123456789/2187 (India Code **timed out** from here).
  - **Medium-high**.
- **Limitation of liability.**
  - Caps and exclusions of indirect loss are generally enforced between commercial parties.
  - Limits: s.23 (public policy); unconscionable standard terms imposed under unequal bargaining power (*Central Inland Water Transport v Brojo Nath Ganguly*, SC 1986); and fraud or wilful misconduct cannot be excluded.
  - **Medium**.
- **Contract Act s.28 (as amended in 1997).**
  - A clause that **limits the time** within which a party may enforce its rights, or **extinguishes rights or discharges liability on expiry of a specified period**, is **void**. Arbitration clauses are an exception.
  - So "claims must be brought within 6 months" is unenforceable. Use a liability cap instead.
  - **High**.
- **s.73/74 and liquidated damages.**
  - A named sum is a ceiling. The court awards "reasonable compensation".
  - Proof of loss is needed unless loss is hard to prove (*Kailash Nath Associates v DDA*, SC 2015; *ONGC v Saw Pipes*, SC 2003).
  - Draft SLA service credits as a genuine pre-estimate or price adjustment.
  - **Medium-high**.
- **Arbitration: Arbitration and Conciliation Act 1996 (amended 2015, 2019, 2021).**
  - **Name the "seat".** A venue with no contrary indication is taken as the seat (*BGS SGS Soma v NHPC*, SC 2019).
  - **Unilateral appointment** by an interested party is invalid under s.12(5) and the Seventh Schedule (*Perkins Eastman*, SC 2019; Constitution Bench in *CORE v ECI-SPIC-SMO-MCML (JV)*, 8 Nov 2024).
  - s.29A: award in 12 months, extendable by 6.
  - An MSME supplier can still use MSMED s.18 (above).
  - The **draft Amendment Bill 2024** is not law (see §8).
  - **Medium-high**.
- **Stamp duty is a state subject.**
  - An unstamped agreement is **not void**. It is inadmissible in evidence until the duty and penalty are paid, and its arbitration clause is still enforced (*In re Interplay between Arbitration Agreements and the Stamp Act*, 7-judge bench, SC, 13 Dec 2023).
  - **Maharashtra:** Schedule I, **Article 5(h)(A)(iv)** covers agreements "relating to … creation of any obligation, right or interest and having monetary value, but not covered under any other article":
    - **0.1%** of the amount agreed, up to ₹10 lakh (minimum ₹100);
    - **0.2%** above ₹10 lakh.
  - The residual **Article 5(h)(B)** is **₹500**, raised from ₹100 by the Maharashtra Stamp (Amendment) Ordinance of **14 Oct 2024**.
  - Which article applies to a subscription or licence agreement is **fact-dependent and not settled**; confirm with a Maharashtra stamp adviser.
  - Pay by e-stamp (SHCIL) or GRAS. Where the agreement is executed outside the state, differential duty is payable when it is brought in.
  - Sources: IGR Schedule I (text before 2024) https://igrmaharashtra.gov.in/pdf/documents/The_Maharashtra_Act_Schedule_1_and_2.pdf (read); the Ordinance change via https://taxguru.in/corporate-law/stamp-duty-rate-changes-maharashtra-14-10-2024.html (secondary; the India Code consolidated PDF returned 504).
  - Confidence: **medium** on the rates, **low** on which article applies.
- **E-signing.**
  - IT Act 2000 s.5: legal recognition of electronic signatures.
  - s.10A: contracts formed electronically are valid.
  - s.3A and the **Second Schedule**: Aadhaar and other e-KYC eSign, and trusted-third-party e-authentication. The Second Schedule lists signature techniques; it is **not** the exclusions.
  - The **exclusions are the First Schedule** (s.1(4)): negotiable instruments other than cheques (and some RBI-regulated instruments), powers of attorney, trusts, wills, and contracts for the sale or conveyance of immovable property.
  - **A software agreement is not excluded.**
  - For electronic evidence, use the certificate under Bharatiya Sakshya Adhiniyam 2023 s.63.
  - Second Schedule text: https://upload.indiacode.nic.in/schedulefile?aid=AC_CEN_45_76_00001_200021_1517807324077&rid=394
  - **High**.
- **DPDP Act 2023 s.8(2).**
  - A Data Fiduciary may engage a Data Processor "**only under a valid contract**".
  - s.8(5): the fiduciary stays responsible for security safeguards.
  - DPDP Rules 2025, Rule 6: security safeguards, including a contractual clause.
  - The hotel is the fiduciary and the SaaS vendor is the processor.
  - **Not in force yet:** it commences **13/14 May 2027** (G.S.R. 843(E), 13 Nov 2025).
  - Until then, **IT Act s.43A and the SPDI Rules 2011** apply. Rule 7 of those rules allows transfer only to a body corporate that ensures the same level of protection.
  - Put a data-processing schedule in the contract now.
  - Act text: https://egazette.gov.in/WriteReadData/2023/248045.pdf (read). Commencement dates: https://dpdpa.in/notification_timeline_act.pdf (secondary copy of G.S.R. 843(E)).
  - **High**.
- **Consumer Protection Act 2019.**
  - s.2(7)(i)/(ii): a "consumer" **does not include** a person who buys goods or "avails of such service for any **commercial purpose**".
  - A hotel group buying a PMS is buying for a commercial purpose, so it is **not a consumer**. Tests: dominant purpose (*Lilavati Kirtilal Mehta Medical Trust*, SC 2019); B2B relationships excluded (*Shrikant G. Mantri v PNB*, SC 2022).
  - Remedies are contractual, civil or arbitral.
  - Text: https://indiankanoon.org/doc/26796719/ (secondary host).
  - **High**.

---

## 5. Trade mark (Trade Marks Act 1999; Trade Marks Rules 2017)

- **Classes (Nice classification):**
  - **Class 9:** recorded or downloadable software, for the licence model.
  - **Class 42:** SaaS, software design and development, hosting.
  - **Class 43:** hotel services, only if the same mark will also brand hotels.
  - **Class 35:** optional; covers business management, including "hotel management for others".
  - **High** for 9 and 42; **medium** for 35.
- **Official e-filing fees (TM-A, per class):**

  | Applicant | E-filing | Paper |
  |---|---|---|
  | Individual, startup or small enterprise | ₹4,500 | ₹5,000 |
  | Everyone else | ₹9,000 | ₹10,000 |

  - Expedited examination: ₹20,000 or ₹40,000.
  - Opposition or counter-statement (TM-O): ₹2,700.
  - Renewal (TM-R): ₹9,000 by e-filing.
  - "Small enterprise" follows the MSMED definition and needs a certificate. A medium or large hotel company pays **₹9,000**.
  - Source: IP India, forms and fees — https://ipindia.gov.in/pages/trade-marks/learn/forms-and-official-fees (fetched 25 Sep 2026) — in force — **high**.
- **Public search:** https://tmrsearch.ipindia.gov.in/tmrpublicsearch (reached). Search wordmarks, phonetic matches and device (Vienna) codes in classes 9, 42 and 35 before choosing a name. **High**.
- **Process.** File, then examination report, then reply, then advertisement in the Trade Marks Journal. The **opposition window is 4 months** from advertisement (s.21 with the Rules). Registration then follows.
  - Protection runs from the **application date** (s.23(1)) for **10 years**, renewable (s.25).
  - A typical unopposed timeline is about **12–18 months**. This is a practitioner estimate, not official — **low**.
- **™ and ®.**
  - ™ has no statutory status; it is a notice of a claim.
  - ® may be used **only after registration**.
  - Falsely representing a mark as registered is an offence under **s.107**: up to 3 years' imprisonment, a fine, or both.
  - **High**.

---

## 6. Open-source licences: distributing versus hosting

- **What triggers the obligations.** Most licence obligations apply on **distribution or conveyance**.
  - **Licence model (B):** the whole application, server and client, is distributed, so every notice duty and every copyleft applies.
  - **SaaS (A):** the server code is **not** distributed, except under AGPL and EUPL.
  - **But** JavaScript, CSS and fonts sent to the browser **are** distributed in both models, so their notices must travel with the web bundle.
- **MIT:** "the above copyright notice and this permission notice shall be included in all copies or substantial portions". https://opensource.org/license/mit — **high**.
- **ISC:** the same notice duty. https://spdx.org/licenses/ISC.html — **high**.
- **BSD-2 and BSD-3:** binary redistribution must reproduce the notice, conditions and disclaimer "in the documentation and/or other materials". BSD-3 adds that contributors' names may not be used to endorse the product. https://spdx.org/licenses/BSD-3-Clause.html — **high**.
- **Apache-2.0, s.4:**
  - give recipients a copy of the licence;
  - mark modified files;
  - keep copyright, patent, trademark and attribution notices;
  - carry forward the **NOTICE** file's attributions.
  - s.3: the patent licence ends if you sue for patent infringement over the Work.
  - https://spdx.org/licenses/Apache-2.0.html — **high**.
  - **What to ship:** a THIRD-PARTY-NOTICES file and the licence texts in the on-prem package, plus an "Open-source notices" page in the web app.
- **GPL-2.0 and GPL-3.0:**
  - Distributing a work based on GPL code requires the **whole** work to be under the GPL, with source provided.
  - GPLv3 s.0: "mere interaction with a user through a computer network, with no transfer of a copy, is not conveying".
  - So GPL **server** code is acceptable for SaaS but **blocks a proprietary on-prem licence**.
  - https://www.gnu.org/licenses/gpl-3.0.en.html — **high**.
- **LGPL-2.1 and LGPL-3.0:**
  - Proprietary code may link to them if the recipient can **replace or relink** the library.
  - Duties: notices, a copy of the licence, and a shared-library mechanism or relinkable object code. LGPL-3 s.4 also requires allowing reverse engineering to debug such modifications.
  - These apply only when distributing.
  - https://www.gnu.org/licenses/lgpl-3.0.en.html — **medium-high**.
- **MPL-2.0:**
  - **File-level** copyleft: distributing in executable form means making the source of the MPL-covered files available (s.3.2).
  - Larger works are allowed (s.3.3).
  - Applies only when distributing.
  - https://www.mozilla.org/en-US/MPL/2.0/ — **high**.
- **AGPL-3.0, s.13 (the network clause):**
  - "if you modify the Program, your modified version must prominently offer **all users interacting with it remotely through a computer network** … an opportunity to receive the Corresponding Source".
  - For SaaS, a modified AGPL component, and arguably the combined program, must be offered as source.
  - **Treat AGPL as not allowed without legal review.**
  - https://www.gnu.org/licenses/agpl-3.0.en.html (read) — **high**.
- **EUPL-1.2:**
  - "Distribution or Communication" includes "**providing access to its essential functionalities**", so hosting triggers its copyleft (Art. 5), with a compatible-licence escape.
  - https://spdx.org/licenses/EUPL-1.2.html (read) — **high**.
- **CC-BY-SA-4.0:**
  - Not meant for software. Creative Commons: "We recommend against using Creative Commons licenses for software" (https://creativecommons.org/faq/).
  - "Share" includes "public display", so **hosting counts**.
  - ShareAlike (s.3(b)(1)) binds **adapted** material, such as modified icons or data.
  - Keep such assets unmodified and attributed, or replace them.
  - https://creativecommons.org/licenses/by-sa/4.0/legalcode.en — **high**.

---

## 7. Other registrations and filings (brief)

- **Company objects clause.**
  - If the **hotel company** itself sells software, check that its memorandum's objects (Companies Act 2013 s.4(1)(c)) cover it.
  - Alter by special resolution if not (s.13).
  - A separate subsidiary is optional. It ring-fences liability and may keep MSME status, and it is **a decision for the owner**.
  - **Medium**; primary not fetched.
- **GST.** Add the new SACs and business activity to the existing registration, a non-core amendment. Register in any new state **from which** it supplies. **Medium**.
- **Professional tax (state law).**
  - For example, the Maharashtra State Tax on Professions, Trades, Callings and Employments Act 1975: enrolment (PTEC) for the company and registration (PTRC) as employer.
  - Capped at ₹2,500 per year per person (Constitution Art. 276(2)).
  - **Medium**; primary not fetched.
- **Shops and establishments (state law).** Maharashtra's 2017 Act requires registration at 10 or more workers and an intimation below that. Other states differ. **Medium**; primary not fetched.
- **Labour codes.**
  - The four codes (Wages 2019; IR, Social Security and OSH 2020) have been **in force since 21 Nov 2025**. Central and state rules are being phased in.
  - EPF and ESI now sit under the Social Security Code.
  - Source: secondary, e.g. https://ddnews.gov.in/en/centre-implements-four-labour-codes-overhauling-29-existing-laws/ — **medium**.
- **CERT-In Directions** of 28 Apr 2022, issued under IT Act s.70B(6), effective 27 Jun 2022.
  - They bind service providers, data centres and **body corporates**, so a SaaS vendor is covered.
  - Report listed cyber incidents **within 6 hours**.
  - Keep ICT logs for **180 days within India**.
  - Synchronise clocks to NTP.
  - Non-compliance is punishable under s.70B(7).
  - Contracts should allocate who reports.
  - https://www.cert-in.org.in/PDF/CERT-In_Directions_70B_28.04.2022.pdf (reached) — **high**.
- **Card data (RBI).**
  - Since **1 Oct 2022**, only card issuers and card networks may store card-on-file data (card-on-file tokenisation); merchants and aggregators must not.
  - A PMS must not keep full card numbers for card-not-present charges; use gateway tokens.
  - Source: secondary (e.g. https://www.india-briefing.com/news/what-is-card-tokenization-why-opportunity-fintech-disruptors-2022-india-23911.html/); the RBI circular of 7 Sep 2021 was not fetched — **medium**.
- **Not needed for domestic B2B software:**
  - IEC (only for import and export);
  - STPI or SEZ (optional export schemes);
  - GeM (only for government buyers);
  - DPIIT startup recognition (optional; an entity formed by splitting or reconstructing an existing business is ineligible).
  - **Medium**.

---

## 8. Announced but not in force on 25 Sep 2026

| Item | What | Date / status | Source | Confidence |
|---|---|---|---|---|
| DPDP Act, core obligations (ss. 3–17, including **s.8(2)** processor contract; most of s.27; ss. 28–34, 36, 37) and **s.44(2)**, which omits IT Act s.43A | Main compliance phase | **13/14 May 2027** (18 months from G.S.R. 843(E) of 13 Nov 2025) | https://dpdpa.in/notification_timeline_act.pdf | high |
| DPDP consent managers (s.6(9), s.27(1)(d)) | Consent-manager framework | **13/14 Nov 2026** | same | high |
| MeitY proposal to cut the timeline to 12 months for Significant Data Fiduciaries | Stakeholder consultation, 22–23 Jan 2026 | **Proposal only**; no amending notification found | https://www.business-standard.com/technology/tech-news/meity-may-cut-compliance-timeline-for-key-dpdp-rules-to-12-months-126012201293_1.html | medium |
| Arbitration and Conciliation (Amendment) Bill 2024 | Institutional arbitration, appellate tribunals, statutory seat | **Draft** of 18 Oct 2024; not introduced | https://www.scobserver.in/wp-content/uploads/2025/02/2024-Draft-Arbitration-Amendment-Bill.pdf | medium |
| E-invoice threshold below ₹5 crore | Talk of ₹2 crore | **Not notified** | secondary only | medium |
| Labour-code rules (central and state) | Operational rules | Codes in force 21 Nov 2025; **rules rolling out** | secondary | medium |
| Supreme Court larger bench on MSME registration timing (*NBCC v WB*, reference of 10 Jan 2025) | Whether an unregistered MSE can use s.18 | **Pending** | sci.gov.in PDF above | medium |

Nothing pending was found that changes the 18% GST rate on software or IT services, the ₹20 lakh registration threshold, the Sl. 6(iii) TDS rates, or the trade mark fees.

---

## Unresolved

1. **TDS on a SaaS subscription:** royalty (10%), technical services (2%), or neither. There is no binding domestic authority. Only cash flow is at stake for the vendor; the buyer bears the short-deduction risk.
2. **The ₹50,000 threshold in s.393 Sl. 6(iii):** it is not clear whether it applies per category (as under old s.194J) or to (a), (b), (d) and (e) combined. The text says "for (a), (b), (d) and (e) of Col. B: ₹50,000".
3. **Notification 21/2012:** whether it was re-notified under s.400(1) or the Rules 2026, or simply continues through s.536(2)(j).
4. **Which Maharashtra stamp article applies to a SaaS or licence agreement:** 5(h)(A)(iv) at 0.1% / 0.2%, or 5(h)(B) at ₹500. Other states were not checked.
5. **Whether the Finance Act 2026 changed anything else relevant:** the official as-amended Income-tax Act 2025 PDF returned 403. Only the 21 Aug 2025 gazette text as enacted, plus secondary summaries of the Finance Act 2026, were checked.
6. **MSME status if the seller is the hotel company:** its hotel investment and turnover probably make it medium or larger, which loses the s.15/16 and s.37(2)(g) leverage and the reduced trade mark fee. Whether to sell through a separate entity is **the owner's decision**.
7. **Primary texts not freshly reached:** India Code timed out, so the Contract Act, A&C Act, CPA 2019, Trade Marks Act, IT Act and Maharashtra Stamp Act (consolidated) were not re-read. incometaxindia.gov.in and the RBI circular were not reached either. Points resting on them are marked medium above.
8. **Not re-read at source:**
   - the rate entry for heading 9992 (training);
   - Notification 50/2018-CT;
   - the ISD provisions (CGST s.2(61)/s.20);
   - the omission of old s.206C(1H).
