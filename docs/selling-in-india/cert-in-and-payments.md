# Cyber security and payments rules for a hosted hotel PMS sold in India

Research as of 25 September 2026. The research is web-only. Primary sources were read in full where the text could be extracted: PDFs were downloaded and converted to text, and image PDFs were rendered and read.
Each bullet follows this format: **rule** — source (number, date) — link — status — applies to whom — confidence.
This is not legal advice. Anything marked medium or low should go to a lawyer before anyone relies on it.

---

## 1. CERT-In Directions under s.70B(6), IT Act 2000

**Who is covered.** The Directions name "service providers, intermediaries, data centres, body corporate and Government organisations". FAQ Q25 defines "body corporate" using s.43A of the IT Act: *"any company and includes a firm, sole proprietorship or other association of individuals engaged in commercial or professional activities."* A small software vendor falls inside that definition, and so does a hotel company. Both are covered, whatever their size. FAQ Q26/Q28/Q31 say the Directions apply to "all entities in so far as reporting of a cyber incident is concerned". Individuals are not covered (FAQ Q7). — confidence: **high**

- **The Directions themselves.** — No. 20(3)/2022-CERT-In, 28 Apr 2022 — https://www.cert-in.org.in/PDF/CERT-In_Directions_70B_28.04.2022.pdf — **in force** from 27 Jun 2022 (60 days after issue). For MSMEs they took effect on 25 Sep 2022 (see the extension below). — all of the above entities — high
- **Clock synchronisation.** All ICT system clocks must sync to the NTP servers of NIC or NPL, or to servers traceable to them. Entities spanning several countries may use another accurate source, provided it "shall not deviate from NPL and NIC" (Direction (i)). FAQ Q40–Q43 add three points. IST is not required: keep UTC and record the time zone. Cloud customers may keep using the cloud's native time service. The servers are samay1.nic.in, samay2.nic.in and time.nplindia.org. — same source + FAQs — in force — all — high
- **Report incidents within 6 hours** of noticing them or being told of them (Direction (ii)). Report by email to incident@cert-in.org.in, phone 1800-11-4949 or fax 1800-11-6969. FAQ Q30 allows a partial first report, completed later, and lists the kinds of incident that must meet the 6-hour limit: severe incidents such as DoS, DDoS, intrusion and ransomware; **data breaches and data leaks**; large-scale or frequent intrusions into systems or websites; and incidents affecting human safety. — Directions + FAQs — in force — all — high
- **The reporting duty cannot be handed to someone else.** FAQ Q13: *"Any entity which notices the cyber security incident, shall report… The obligation… is neither transferrable nor indemnified."* In practice both the vendor and the hotel must report whatever each of them notices. A contract cannot move the duty to one party. FAQ Q22 adds that the duty overrides confidentiality clauses (s.81 of the IT Act). — FAQs — in force — vendor and hotel — high
- **Annexure I lists 20 incident types** that must be reported:
  1. targeted scanning or probing of critical systems;
  2. compromise of critical systems or information;
  3. unauthorised access to IT systems or data;
  4. website defacement or intrusion;
  5. malicious code (virus, worm, trojan, bots, spyware, ransomware, cryptominers);
  6. attacks on servers (database, mail, DNS) and network devices;
  7. identity theft, spoofing and phishing;
  8. DoS and DDoS;
  9. attacks on critical infrastructure, SCADA, OT and wireless networks;
  10. attacks on applications such as e-governance and e-commerce;
  11. data breach;
  12. data leak;
  13. attacks on IoT devices;
  14. attacks affecting digital payment systems;
  15. malicious mobile apps;
  16. fake mobile apps;
  17. unauthorised access to social media accounts;
  18. attacks or suspicious activity affecting cloud systems;
  19. attacks on Big Data, blockchain, virtual assets, robotics, 3D/4D printing and drones;
  20. attacks on AI/ML systems.

  — Directions, Annex I — in force — all — high
- **Point of contact.** Every entity must designate a Point of Contact and send its details to info@cert-in.org.in in the Annexure II format: name, designation, organisation, address, email, mobile, phone and fax. The details must be kept up to date (Direction (iii)). FAQ Q29 applies this to entities offering services to users in India even when they have no presence in India. — in force — all — high
- **Logs.** Logs of *all* ICT systems must be enabled and kept securely for a rolling **180 days** "within the Indian jurisdiction" (Direction (iv)). They must be handed to CERT-In with an incident report or on order.
  - **FAQ Q35 relaxes where logs are kept:** *"The logs may be stored outside India also as long as the obligation to produce logs to CERT-In is adhered to by the entities in a reasonable time."*
  - **FAQ Q36 tightens it again:** *"Any service provider offering services to the users in the country needs to enable and maintain logs and records of financial transactions in Indian jurisdiction."* So records of financial transactions stay in India.
  - FAQ Q37 gives examples of the logs expected: firewall, IPS, SIEM, web, database, mail, proxy, application, SSH and VPN logs, recording both successful and failed events.
  - FAQ Q38: a request for logs must come from a CERT-In officer of Deputy Secretary rank or above.

  — Directions + FAQs — in force — all — **high** for the text. Q35 and Q36 pull in different directions, so **medium** on how they apply to logs that sit outside India, such as those of a sign-in provider.
- **Subscriber records for data centres, VPS, cloud and VPN providers**, kept for **5 years** after the service ends (Direction (v)): validated names, dates of hire, IPs allotted, email, IP and timestamp at sign-up, purpose, validated address and phone, and ownership pattern. FAQ Q34 excludes enterprise/corporate VPNs. — Directions — in force. Items (a) validated name and (f) validated address took effect on 25 Sep 2022. — Oracle, as the cloud provider, is clearly covered. Whether a SaaS vendor counts as a "Cloud Service provider" is **not settled**: the term is not defined. — **low** for the SaaS-vendor question
- **Extension for MSMEs and subscriber validation** — No. 20(3)/2022-CERT-In, 27 Jun 2022 — https://www.cert-in.org.in/PDF/CERT-In_directions_extension_MSMEs_and_validation_27.06.2022.pdf — the extension ended on **25 Sep 2022**, so the Directions have fully applied to MSMEs since then. — high
- **FAQs** — "FAQs on Cyber Security Directions of 28.04.2022". The PDF is dated only "May 2022". Press reports put its release at 18 May 2022, and I could not confirm a 19 May date. — https://www.cert-in.org.in/PDF/FAQs_on_CyberSecurityDirections_May2022.pdf — the FAQs call themselves "not a legal document" and say they may change. — medium for the date, high for the content
- **Penalty.** Under s.70B(7), failing to give information or to comply is punishable with up to 1 year in prison, a fine **now up to ₹1 crore** (previously ₹1 lakh), or both. The CERT-In FAQ still says ₹1 lakh; it predates the change. — Jan Vishwas (Amendment of Provisions) Act, 2023 (No. 18 of 2023), Schedule entry 32(I): "for the words 'one lakh', the words 'one crore' shall be substituted" — https://egazette.gov.in/WriteReadData/2023/248047.pdf — **in force 30 Nov 2023**. That date comes from MeitY's commencement notification as secondary sources report it; I did not read the notification itself. — all — high for the text, medium for the date. FAQ Q23 says the power will be used "on occasions when the non-compliance is deliberate".
- **Later amendments to the Directions:** none. CERT-In's Directions page (https://www.cert-in.org.in/Directions70B.jsp) still lists only the Directions, the FAQs and the 27 Jun 2022 extension. The Jan Vishwas (Amendment of Provisions) Act, 2026 received assent on 7 Apr 2026 (https://prsindia.org/files/bills_acts/bills_parliament/2026/Jan_Vishwas_Act_2026.pdf). I searched its text and it does not amend the IT Act, the PSS Act or the Telecommunications Act. — high

## 2. CERT-In guidance issued since, and what buyers ask for

- **Comprehensive Cyber Security Audit Policy Guidelines**, v1.0 — CISG-2025-02, 25 Jul 2025 — https://www.cert-in.org.in/PDF/Comprehensive_Cyber_Security_Audit_Policy_Guidelines.pdf — in force.
  - The guidelines say they are *"binding on all CERT-In empanelled auditing organizations and auditee entities covered under the relevant provisions"*. They are for organisations *"required to or are seeking to"* have an audit (§4).
  - Auditees are *"expected to ensure a comprehensive audit covering all aspects of their ICT systems at least once a year"* (§6).
  - My reading is that they govern *how* audits by empanelled auditors are done. They do **not** on their own require a private hotel or SaaS company to have an audit. The duty to audit comes from a sector regulator or a contract.
  - Points that matter to the vendor:
    - §9.6: the owner of the information infrastructure runs the audit itself and "must not be delegated".
    - §8(vii)–(viii): an application built without secure design and development practice "should not be considered for assessment". Auditors are pointed to CERT-In's *Guidelines for Secure Application Design, Development, Implementation & Operations* (CISG-2024-01, 25 Jan 2024).
    - §13.1.5: when an application is hosted on someone else's server, the server owner audits the server and OS. The owner of the application and its data must have the application and database audited by a CERT-In empanelled auditor.
    - SBOM, QBOM and AIBOM auditing, cloud (CSA CCM) testing and vendor-risk audits are all within scope.

  — applies to empanelled auditors and entities that must have an audit — **medium** on whether it binds private companies
- **15 Elemental Cyber Defense Controls for MSMEs**, v1.0 — CISG-2025-03, 1 Sep 2025 — https://www.cert-in.org.in/PDF/Elemental_Cyber_Defense_Controls_for_MSME.pdf — in force as guidance.
  - It sets out 15 controls with 45 recommendations.
  - The text is *voluntary*: "MSMEs **may** conduct Baseline Audits through CERT-In Empaneled Auditing Organizations… at least once in a year" (§2). Several secondary sources say this is "mandatory". **They are wrong.**
  - Control VAA.1 recommends an independent third-party vulnerability assessment of business-critical assets at least once a year.

  — MSMEs, which probably includes the vendor — high
- **SBOM technical guidelines.** v1.0 was CISG-2024-02, 3 Oct 2024, and covered SBOM only. **v2.0, dated 9 Jul 2025**, now covers SBOM, QBOM & CBOM, AIBOM and HBOM. — https://www.cert-in.org.in/PDF/TechnicalGuidelines-on-SBOM,QBOM&CBOM,AIBOM_and_HBOM_ver2.0.pdf — guidance, not mandatory. It is aimed "especially" at government, the public sector, essential services and software exporters. Organisations are "encouraged" to require SBOMs when they buy software. — software developers and consumers — high. The v1.0 date comes from CERT-In's guideline index; the index now serves the v2.0 file under the same code.
- **NEW, 10 Jun 2026: Guidelines on AI-accelerated vulnerability protection and response requirements for OEMs and technology providers**, CISG-2026-03, V1.0. — index: https://www.cert-in.org.in/s2cMainServlet?pageid=GUIDLNVIEW02&refcode=CISG-2026-03 (the PDF CIGU-2026-0003.pdf downloads only with a session cookie from that page) — in force as guidance. It is written as "advised / should" and is not issued under s.70B(6), but section 8 asserts rights for customers and CERT-In to verify.
  - **Who it covers:** "all global/domestic OEMs and technology providers (including **software vendors**, cloud service providers, managed service providers, system integrators, … digital service providers supplying … software, platforms, cloud services, applications, APIs…) operating in India". **That describes the vendor.**
  - Continuous vulnerability assessment.
  - Critical (CVSS 9–10) and high (CVSS 7–8.9) vulnerabilities, zero-days and active exploitation are to be told to affected customers **and CERT-In immediately**.
  - Indicative patch timelines for IT systems:

    | Severity | Could likely be exploited using AI | Found through responsible disclosure |
    |---|---|---|
    | Critical | emergency release | 5 days |
    | High | 7 days | 15 days |
    | Medium | 14 days | 30 days |

  - Secure development lifecycle; no hard-coded credentials; MFA, RBAC and privileged-access management; automatic patch notices to CERT-In and customers.
  - BOMs covering hardware, software, cryptography, AI and quantum are to be **given to Indian customers and to CERT-In** and kept up to date.
  - Five deliverables: a security posture assessment, a remediation plan, a signed security commitment from senior management, continuous VAPT and BAS reports with SBOM, and SDL certification.
  - A cyber-security liaison officer is to be named. Contact: oem.security@cert-in.org.in.

  — the vendor — **high** for the text, **medium** on how far it is enforced
  - Two related documents: *Blueprint for Reducing Exposure and Defending against AI-Assisted Vulnerabilities Exploitation*, CISG-2026-02, 25 May 2026 (https://www.cert-in.org.in/PDF/Blueprint_for_Defending_against_AI_Assisted_Exploitataion.pdf), and the advisory CIAD-2026-0020, 26 Apr 2026. I did not read either in full.
- **CERT-In's list of empanelled IT security auditing organisations** — https://www.cert-in.org.in/PDF/Empanel_org.pdf — current: the PDF was regenerated on 25 Sep 2026 and lists about 236 firms. CERT-In calls it an "up-to-date valid list". — high
- **Legal requirement or market expectation?** How each thing a buyer asks for stands for a hotel-SaaS sale:

  | Item | Status | Detail | Confidence |
  |---|---|---|---|
  | VAPT by a CERT-In empanelled auditor | **Market expectation** for hotels | It is **legal** only where a regulator requires it: RBI-regulated entities and PAs (PA MD §9(d), an annual audit by CERT-In empanelled auditors), and government bodies. Government hotel buyers, such as ITDC or state tourism corporations, will normally ask for a CERT-In empanelled audit certificate. | medium |
  | ISO/IEC 27001:2022 certification | **Not mandatory**, but it has a legal hook | Under the SPDI Rules 2011, rule 8, IS/ISO/IEC 27001 is named as a "reasonable security practice" for s.43A of the IT Act, with an audit at least once a year by an auditor approved by the Central Government. | high |
  | Transition from ISO/IEC 27001:2013 | Complete | Every 2013 certificate expired or was withdrawn by **31 Oct 2025** (IAF MD 26, issue 2, https://iaf.nu/iaf_system/uploads/documents/IAF_MD26_Issue_2_15012023.pdf). Only 27001:2022 certificates are valid now. | high |
  | Future of the ISO hook | Ends 13 May 2027 | s.43A, and with it the SPDI Rules, is repealed by s.44(2) of the DPDP Act when that section commences, **13 May 2027** (see §5). | medium |
  | SOC 2 (AICPA) | **Market expectation only** | Asked for mostly by international chains. No Indian law requires it. | high |
  | PCI DSS | **Contractual** | Required by card-network and acquirer contracts, and by RBI through PAs (PA MD §9(a) and Annex 1). It is not a statute. | high |

## 3. Telecom and IT rules that could reach the vendor

- **Digital India Act** — proposed as the replacement for the IT Act. **No bill has been introduced, and I found no published draft text.** — not in force — medium
- **IT (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021.**
  - Under s.2(1)(w) of the IT Act, an "intermediary" is anyone who, "on behalf of another person receives, stores or transmits" an electronic record, or provides any service for it. The definition expressly includes web-hosting providers.
  - Read literally, a hosted PMS that stores each hotel's records **could** be an intermediary. It is plainly **not** a social media intermediary or a significant one, so the extra duties of Part II rule 4 do not apply.
  - If it is an intermediary, the general due diligence of rule 3(1) would apply: terms and a privacy policy, a grievance officer, keeping records for 180 days after an account is removed, assisting government agencies, and rule 3(1)(l), reporting cyber incidents to CERT-In. Most of that is already covered by the CERT-In duties above.
  - Amended by G.S.R. 120(E), 10 Feb 2026, **in force 20 Feb 2026**. That amendment concerns synthetically generated or AI content and takedown timelines, and is irrelevant to a PMS. I confirmed it through secondary sources, not the Gazette.
  - **Draft Second Amendment 2026** (30 Mar 2026; comments closed 7 May 2026) would make MeitY advisories binding through a new rule 3(4). It had **not been notified** as far as I could find.
  - Whether a B2B SaaS is an intermediary: **unresolved, low**. It is safer to assume the rule 3(1) basics apply.
- **Telecommunications (Telecom Cyber Security) Rules, 2024** — G.S.R. 720(E), 21 Nov 2024, under the Telecommunications Act 2023 — https://eservices.dot.gov.in/sites/default/files/circular-notifications/cybersecurity-rules-2024.pdf — in force. The main duties (rule 4(4): policy, CISO, reporting within 6 hours) fall on *telecommunication entities* only. **Rule 4(1)–(2), however, applies to "any person"**: no one may endanger telecom cyber security or misuse telecom identifiers, for example through fraud or personation. — high
- **Amendment Rules 2025** — G.S.R. 771(E), 22 Oct 2025, **in force** the same day — https://eservices.dot.gov.in/sites/default/files/circular-notifications/telecom-cyber-security-amendment-rules-2025.pdf
  - Creates the **TIUE** (telecommunication identifier user entity): *"a person, other than a licensee or authorised entity, which uses telecommunication identifiers for the identification of its customers or users, or for provisioning, or delivery of services"*.
  - A PMS or hotel that identifies guests or staff by mobile number, or sends them OTPs or SMS, fits that wording.
  - The duties are triggered by direction:
    - the government may ask for identifier data "in the form and manner specified on the portal" (rule 3(1)(aa));
    - TIUEs must follow directions and standards (rule 4(3));
    - they must suspend or stop using a specified number on order (rules 5(6) and 5(8));
    - they must report through the portal (rule 10).
  - They *may* validate numbers on the government's paid Mobile Number Validation platform, or be directed to (rule 7A).
  - I found no evidence that the MNV platform is running yet.

  — vendor and hotel, only once a direction is issued — **medium**
- **TRAI TCCCPR 2018**, as amended by the Second Amendment Regulations of 12 Feb 2025 (https://trai.gov.in/sites/default/files/2025-02/Regulation_12022025.pdf). If the PMS sends guests SMS such as booking confirmations or OTPs, the hotel or vendor, as the principal entity, must be registered on the operators' DLT with registered headers and templates. A draft Third Amendment 2026 has been consulted on (a TRAI draft dated 13 Mar 2026), and I did not read it. — in force, draft pending — medium

## 4. Payments, if the PMS ever takes card or UPI payments online

- **RBI (Regulation of Payment Aggregators) Directions, 2025** — Master Direction RBI/DPSS/2025-26/141, CO.DPSS.POLC.No.S-633/02-14-008/2025-26, **15 Sep 2025** — https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=12896 — **in force** on issue.
  - It **repeals** the 17 Mar 2020 PA-PG guidelines (DPSS.CO.PD.No.1810), the 31 Mar 2021 clarifications and the PA-Cross Border circular of 31 Oct 2023.
  - Some deadlines have already passed: PA-P applications by 31 Dec 2025 (wind-up by 28 Feb 2026); escrow changes by 31 Dec 2025; re-doing due diligence on merchants onboarded up to 31 Dec 2025 within one year of the MD, i.e. by about 15 Sep 2026.

  — PAs, not merchants — high. What it means for the parties:
  - **Anyone who collects money from guests and settles it to hotels is running a PA business.** A non-bank then needs RBI authorisation, a company incorporated in India and a net worth of ₹15 crore, rising to ₹25 crore (§§5–6). **The vendor should never sit in the flow of funds.** Each hotel should use its own merchant account with an authorised PA. A **Payment Gateway**, which routes transactions "without any involvement in handling of funds", is outside the MD but "encouraged" to follow Annex 1 (§4(j), §10(g)). — high
  - **What the hotel faces as a merchant** is imposed through the PA. It must pass due diligence (KYC and a CKYCR lookup) and be given an MCC. Refunds go to the original payment method. The PA must *"ensure that infrastructure of the merchants is compliant with security standards like PCI-DSS and PA-DSS, as may be applicable"* (§9(a)) and must assess security when onboarding a merchant (Annex 1 §1.4). **Annex 1 §2.1: "The customer card credentials shall not be stored within the database or the server accessed by the merchant."** — high
- **Card data may not be stored (CoF / CoFT).**
  - *Tokenisation – Card Transactions: Permitting CoFT Services* — RBI/2021-22/96, CO.DPSS.POLC.No.S-516/02-14-003/2021-22, 7 Sep 2021 — https://rbi.org.in/Scripts/NotificationUser.aspx?Id=12159&Mode=0 — *"no entity in the card transaction / payment chain, other than the card issuers and / or card networks, shall store the actual card data"*. Entities may keep *"last four digits of actual card number and card issuer's name"* for tracking and reconciliation. The original deadline was 1 Jan 2022, pushed to 30 Jun 2022 and then to 30 Sep 2022 (circular of 24 Jun 2022).
  - *Restriction on Storage of Actual Card Data* — RBI/2022-2023/95, CO.DPSS.POLC.No.S-760/02-14-003/2022-23, 28 Jul 2022 — https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12363&Mode=0 — CoF data to be purged **from 1 Oct 2022**. For guest checkout, the merchant or its PA may hold card data for a maximum of T+4 days or until settlement, whichever is earlier, only to settle the transaction.
  - **In force.** — every merchant and PA in the card chain — high
  - **What a PMS may store:** the last 4 digits, the issuer's name, a network or issuer token (held through the PA), and a PA or vault reference. **What it may not store:** the full card number, and never the CVV. Expiry dates are also covered by CoF data. — high for domestic cards
- **PCI DSS v4.0.1** (PCI SSC, June 2024; v4.0 was retired on 31 Dec 2024) — https://blog.pcisecuritystandards.org/just-published-pci-dss-v4-0-1
  - All 51 future-dated requirements have been **mandatory since 31 Mar 2025**.
  - SAQ A eligibility changed in Jan 2025: requirements 6.4.3 and 11.6.1 were replaced by an eligibility criterion that the merchant's site is protected from script attacks (https://blog.pcisecuritystandards.org/important-updates-announced-for-merchants-validating-to-self-assessment-questionnaire-a).
  - It applies **only if** the PMS or website stores, processes or transmits card data, or can affect the security of the payment page. A hosted redirect or iframe run by the PA keeps the hotel at SAQ A.

  — in force under contract — high
- **RBI (Authentication mechanisms for digital payment transactions) Directions, 2025** — RBI/2025-26/79, **25 Sep 2025** — https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12898&Mode=0
  - Every digital payment needs at least two distinct factors of authentication, and for anything other than card-present transactions one factor must be dynamic. Risk-based extra checks are allowed.
  - Exemptions include small contactless payments, e-mandates after the first payment, some PPIs, NETC and offline small-value payments.
  - The issuer must fully compensate customers for losses caused by non-compliance.
  - **Domestic transactions: in force 1 Apr 2026.** **Cross-border card-not-present transactions: 1 Oct 2026, not yet in force.**

  — payment system providers and participants (issuers, PAs), not merchants directly — high. For hotels, a no-show or MOTO charge on a guest's domestic card without an additional factor of authentication is risky (see Unresolved).
- **RBI localisation of payment data** — *Storage of Payment System Data*, RBI/2017-18/153, DPSS.CO.OD No.2785/06.08.005/2017-2018, 6 Apr 2018 — https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=11244&Mode=0 — in force. It applies to **payment system operators authorised by RBI**, and through them to their "service providers, intermediaries, payment gateways, third party vendors". The FAQ of 26 Jun 2019 (https://www.rbi.org.in/commonman/english/Scripts/FAQs.aspx?Id=2995) allows processing abroad if the data is deleted there and brought back within one business day or 24 hours. **It does not bind a hotel merchant or a PMS vendor directly**, only as a PSO's third-party vendor. PAs are bound through PA MD §9(c). — high
- **UPI: a hotel showing its own QR on a bill.** The hotel needs no licence of its own. It must be onboarded as a **merchant (P2M)** by an acquiring bank, PSP or PA, which carries out KYC. NPCI's circulars bind *member banks, PSPs and apps*; they reach merchants only through the acquirer agreement.
  - A business collecting into a personal VPA falls under the **P2PM** small-merchant category, limited to ₹1 lakh a month (moved to P2M after 3 consecutive months above that), which does not fit a hotel company.
  - An amount-specific dynamic QR on a bill is normally generated through the PA or acquirer's API.
  - Confidence: **medium**. I did not read the NPCI operating circulars on QR onboarding.
- **UPI changes in 2025–26 that matter to merchants:**
  - **Higher P2M limits for some categories** — NPCI/UPI/2025-26/OC/185B, 28 Aug 2025, effective 15 Sep 2025 — https://www.npci.org.in/uploads/UPI_OC_No185_B_FY_2025_26_Addendum_to_OC_185_A_Implementation_of_higher_per_transaction_limit_for_specific_categories_in_UPI_ba517a0902.pdf
    - "Travel" here is **MCC 4722** (travel agencies), **not MCC 7011** (hotels), with ₹5 lakh per transaction and ₹10 lakh a day.
    - The "Business/Merchant (including pre-approved payments)" category, payer MCC not 0000 and purpose code 20 or 15, gets ₹5 lakh.
    - Limits apply only to "Verified Merchants".

    — high
  - **Limits on API use (effective 31 Jul / 1 Aug 2025)** — NPCI/UPI/OC/215 and 215A/2025-26 — https://www.npci.org.in/PDF/npci/upi/circular/2025/UPI-OC-No-215-A-FY-2025-26-Guidelines-on-usage-of-UPI-APIs.pdf (**I could not reach it**; the figures are from secondary sources).
    - Balance enquiries: 50 per app per day.
    - Transaction status checks: the first only after 90 seconds, and at most 3 in 2 hours.
    - List-account calls: 25 a day.
    - These bind banks and PSPs. A PMS that polls the PA for status should expect the PA to enforce limits like these.

    — medium
  - **P2P "collect" requests discontinued from 1 Oct 2025** (NPCI circular of 29 Jul 2025; number not confirmed). Merchant collect requests are not affected. — medium
- **RBI Master Direction on Cyber Resilience and Digital Payment Security Controls for non-bank PSOs** — CO.DPSS.OVRST.No.S447/06-26-002/2024-25, 30 Jul 2024 (cited in PA MD §9(e)). It binds PAs, which pass its controls down to merchants through onboarding. — high

## Checklist: what a buyer will ask of a hosted hotel SaaS vendor in India

Each item is tagged **[L]** for a legal duty (of the vendor, or of the hotel that the vendor must make possible), **[C]** for something required contractually or through a regulated party, or **[M]** for a market expectation.

1. [L] A named CERT-In Point of Contact, with the Annexure II details filed, and an incident-response plan that meets the **6-hour** reporting limit. The contract should say **both** parties report what they notice (FAQ Q13); the duty cannot be moved to one of them.
2. [L] Logs of all ICT systems (application, database, web, sign-in and admin) kept for **180 days**, producible to the hotel or CERT-In on request. Records of financial transactions (folios, payments) kept in India. **From 13 May 2027 the DPDP Rules require 1 year** of logs of personal-data processing (rule 6).
3. [L] Clocks synced to NIC or NPL, or to the cloud's native time service; timestamps in UTC with the time zone recorded.
4. [L] No full card numbers or CVVs anywhere; only tokens and the last 4 digits. Card entry through the PA's hosted page or iframe. The vendor never holds guest money.
5. [C] A PCI DSS v4.0.1 attestation (SAQ A or D, or an AoC) for any component that touches card data, and the PA's assessment of the merchant at onboarding.
6. [M, and L for government buyers] An annual VAPT and application security audit by a **CERT-In empanelled** auditor, with remediation closed. A safe-to-host or security audit certificate for government or PSU hotels.
7. [M] An **ISO/IEC 27001:2022** certificate, whose scope covers the hosted service. Until 13 May 2027 it also serves as the evidence for SPDI rule 8. Optionally **SOC 2 Type II** for international chains.
8. [M, now CERT-In guidance] Deliverables following CISG-2026-03: an SBOM (and CBOM) for each release, patch timelines that meet CERT-In's indicative table, vulnerability disclosure to customers, a secure development lifecycle, MFA/RBAC for admin access, no hard-coded secrets, a senior-management security commitment and a named security liaison.
9. [L from May 2027] A **data processing agreement**. The hotel is the data fiduciary and the vendor the processor (s.8(2) of the DPDP Act). It should cover security safeguards, breach notice to the hotel quickly enough for its **72-hour** report to the Board (DPDP rule 7), and erasure or return when the contract ends.
10. [M] Data kept in India (Oracle Mumbai), a list of sub-processors (Google Firebase Authentication and Hosting, Oracle), where each one stores data, BCP/DR with backups, RPO and RTO, encryption at rest and in transit, a right to audit, cyber insurance, and exit and data-portability terms.
11. [L if directed] A way to comply with DoT orders under the Telecom Cyber Security Rules about guests' mobile numbers, if the PMS uses numbers to identify people or send SMS. DLT registration for any SMS.

## 5. Not yet in force, or pending, on 25 Sep 2026

| Item | Source | Date | Status | Confidence |
|---|---|---|---|---|
| RBI two-factor authentication for **cross-border CNP** card transactions | RBI/2025-26/79, 25 Sep 2025 | **1 Oct 2026** | issued, not yet in force | high |
| **UPI MDR**: 0.4% on P2M transactions over ₹2,000, capped at ₹300 from ₹75,000; flat ₹5 for railways, telecom, insurance, fuel, utilities and education; P2P and P2PM exempt; cannot be passed on to customers (FAQ Q34). Hotels are not in any concessional category listed. | NPCI FAQ, 15 Sep 2026 (https://www.npci.org.in/uploads/FA_Qs_Merchant_Discount_Rate_MDR_on_Select_UPI_P2_M_Transactions_58dba1d39e.pdf). Legal basis per secondary sources: Taxation and Other Laws (Amendment) Act 2026 amending s.10A of the PSS Act, and Gazette S.O. 5067(E) of 14 Sep 2026, which protects only RuPay debit and UPI up to ₹2,000 and **states no rate**. A Supreme Court petition is reported. | **15 Oct 2026** | announced | high on NPCI's text; medium on the legal basis |
| NPCI's small-merchant fund framework | NPCI MDR FAQ Q9/Q27 | "within three months" (by about Dec 2026) | pending | medium |
| DPDP Rules, rule 4 (consent managers) | G.S.R. 846(E), 13 Nov 2025 | about 13–14 Nov 2026 | not yet in force | high |
| **DPDP Rules, rules 3 and 5–16** (security safeguards including **1-year log retention**, breach notice to the Board within 72 hours) and DPDP Act s.44(2), which **omits IT Act s.43A** and so ends the SPDI Rules | G.S.R. 846(E); Act commencement notification of 13 Nov 2025 | **about 13 May 2027** | not yet in force | high for the rules; medium for the s.44(2) date (secondary source) |
| IT Rules draft Second Amendment 2026 (MeitY advisories made binding by rule 3(4)) | MeitY draft, 30 Mar 2026 | not set | draft; comments closed 7 May 2026 | medium |
| Digital India Act | MeitY proposal | not set | no bill | medium |
| TRAI TCCCPR draft Third Amendment 2026 | TRAI draft, 13 Mar 2026 | not set | consultation | low (not read) |
| DoT Mobile Number Validation platform (rule 7A) | G.S.R. 771(E), 22 Oct 2025 | the rule is in force; the platform's launch is not known | pending in practice | medium |
| Next version of PCI DSS (v5.0) | PCI SSC RFC on v4.0.1, 3 Jun – 20 Jul 2026 | no date announced | in development | high |

## Unresolved

1. **Is a B2B hotel SaaS an "intermediary"** under s.2(1)(w) of the IT Act, and so subject to rule 3(1) of the IT Rules? The literal wording probably covers it, and I know of no ruling. This needs a lawyer's view.
2. **Is a SaaS vendor a "Cloud Service provider"** under Direction (v), with the duty to keep validated customer records for 5 years? The term is undefined. Keeping those records is cheap, so doing it anyway is the conservative course.
3. **Do logs held outside India satisfy the Directions?** For example, sign-in records kept by Firebase Authentication. FAQ Q35 allows it if they can be produced in time. FAQ Q36 requires financial-transaction records and logs of service providers to Indian users to be in India. I did not research where Firebase Auth stores data, or whether its sign-in logs can be exported and kept for 180 days.
4. **Does the ban on storing card data reach foreign-issued cards and OTA virtual cards** received through channel managers for no-show guarantees? Secondary sources say CoFT tokenisation applies only to domestic transactions, and I did not find RBI's own FAQ on this. Separately, whether a no-show or MOTO charge to a *domestic* card without an additional factor of authentication is allowed needs confirming with an acquirer.
5. **UPI QR standards.** I did not read NPCI's operating circulars on merchant QR, "verified merchant" and signed-QR rules, or the circular numbers for the API-limit and P2P-collect changes. The NPCI PDFs refused scripted downloads.
6. **Legal basis of the UPI MDR.** The Gazette notification states no rate, and a Supreme Court petition is reported. The 15 Oct 2026 start date could still change.
7. **Commencement date of the Jan Vishwas 2023 changes to the IT Act.** Secondary sources give 30 Nov 2023 (S.O. of 31 Oct 2023). I did not read the notification itself.
8. **GST dynamic B2C QR.** CBIC Notification 14/2020-CT requires a dynamic payment QR on B2C invoices of registered persons with aggregate turnover above ₹500 crore, which is relevant to large hotel groups. This belongs to the GST research and I did not verify it here.
9. **MeitY cloud empanelment** of Oracle Cloud Mumbai and of Google Cloud/Firebase matters only for government buyers. I did not check it.
10. Whether MeitY has changed or proposes to change the DPDP 18-month timeline. That belongs to the privacy research.
