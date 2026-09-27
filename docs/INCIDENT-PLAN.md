# If something goes wrong: the incident plan

**What to do when someone may have broken into the hotel system, or guests'
data may have leaked: who reports it, to whom, and inside six hours.**

Written 27 September 2026 from the CERT-In Directions and their FAQs, read
that day at the source. CERT-In's Directions page (updated 27 September 2026)
lists no change since the 27 June 2022 extension. Not legal advice: take it to
the lawyer with `docs/SELLING-IN-INDIA.md` (A8).

## The rule in one paragraph

Every company in India must tell CERT-In about a cyber incident **within 6
hours of noticing it, or of being told about it** (Directions of 28 April 2022,
direction (ii)). A first report may be partial; the rest follows "within
reasonable time" (FAQ Q30). The duty belongs to whoever notices, and a contract
cannot move it to someone else: *"The obligation… is neither transferrable nor
indemnified"* (FAQ Q13). Not reporting can cost up to ₹1 crore (IT Act
s.70B(7), as raised by the Jan Vishwas Act 2023).

## Who reports

**The owner, for both companies** (the owner, 27 September):

- **Fidato Hotels**, for its own hotels' copy of the system, which runs on
  Fidato's own accounts (D26-1, D26-4).
- **Influvate**, for every buyer's copy it hosts (the owner, 25 September), and for anything it
  notices in Fidato's copy while looking after it.

When an incident touches a buyer's copy, Influvate reports it **and tells the
buyer at once**, so the buyer can report what it knows too: each company
reports what it notices.

Until the owner has filed the two forms at the end, CERT-In has no name for
either company. **Filing them is the first thing to do.**

## What counts

Anything on CERT-In's list of 20 (Directions, Annexure I). The ones this
system could meet:

| In plain words | CERT-In's words |
|---|---|
| Someone got into the server, the database or a staff account who should not have | unauthorised access to IT systems or data; compromise of systems |
| Guests' details copied out, sent to the wrong person, or left open | data breach; data leak |
| The server's files locked for ransom, or strange programs running on it | malicious code (ransomware, cryptominers, trojans) |
| The system flooded so staff cannot use it | denial of service |
| Staff tricked into giving their password; a fake "PMS" sign-in page | identity theft, spoofing and phishing |
| Someone scanning or probing the server over and over | targeted scanning or probing of critical systems |
| The Oracle account, Firebase or n8n tampered with | attacks on cloud systems; attacks on servers |
| The WhatsApp or email account used to send guests messages taken over | unauthorised access to social media accounts |

**Must be reported inside 6 hours** (FAQ Q30): data breaches and data leaks;
severe incidents such as intrusion, ransomware or denial of service;
large-scale or frequent intrusions. **When in doubt, report**: a partial report
that turns out to be nothing costs an email.

## The six hours, step by step

Write down **the time you noticed** (or were told). The clock starts there.

**Hour 0 to 1: stop it spreading, and keep the evidence**

1. **Do not wipe, reinstall or "clean up" the server.** The logs on it are
   the evidence CERT-In will ask for.
2. If someone is inside now: in the Oracle console, **stop the instance**
   (Compute → Instances → Stop), or remove its public door (the VCN security
   list's rules for ports 80 and 443). The hotels work from paper until it is
   back.
3. Take a copy of the disk as it is: Oracle console → the instance → Boot
   volume → **Create backup**.
4. A staff account used by someone else: in Firebase, **disable the user**
   (Authentication → Users → the user → Disable account).
5. A leaked key or password: **change it now** (the Firebase service account,
   the database password, the n8n secret, the bucket link).

**Hour 1 to 5: report what you know**

Email **incident@cert-in.org.in** (24 hours a day), or call **1800-11-4949**
(fax 1800-11-6969). Use CERT-In's form if it helps:
https://www.cert-in.org.in/PDF/certinirform.pdf (it says itself that filling
it is not required and the information may be given in the email). Say:

- who you are, and which company is reporting (and the affected company if
  it is a buyer's copy)
- what happened, as far as you know
- when it happened and **when you noticed it** (dd/mm/yyyy hh:mm, and the
  time zone)
- the system: `pms.fidatohotels.com` / `api.fidatohotels.com`, Oracle Cloud
  Mumbai, Oracle Linux, the hotel system and its database
- what you have done so far

Keep a copy of what you sent and the time you sent it.

**After the first report**

- Send CERT-In the rest as you learn it (FAQ Q30).
- Save the logs from the time of the incident (below) before anything rotates
  them away, and give them to CERT-In if it asks. A request must come from a
  CERT-In officer of Deputy Secretary rank or above (FAQ Q38).
- **Tell the hotels** affected, and a buyer at once if it is their copy.
- **From 13 May 2027** a data breach must also be told to the guests
  affected and to the Data Protection Board without delay, with a full report
  to the Board within 72 hours (DPDP Rules 2025, rule 7). Not yet in force:
  ask the lawyer then.
- Afterwards: write down what happened and what was changed, and add it to
  this plan.

## Where the evidence is, and how long it stays

Kept **a year** (the owner, 27 September; CERT-In asks 180 days, direction
(iv)), on the server in Oracle's Mumbai region, which is inside India. How
`deploy/launch.sh` sets it up: `deploy/README.md`, "Logs, and the clock".

| What | Where | Save it (*the server, over ssh as `opc`*) |
|---|---|---|
| The API: sign-ins it refused, errors | the journal | `sudo journalctl -u fidato-api --since "2026-09-27 00:00" > api.log` |
| Who logged in to the server over ssh, and sudo | the journal | `sudo journalctl _COMM=sshd _COMM=sudo --since "…" > ssh.log` |
| Every request to the API, with its address | `/var/log/nginx/access.log*` | `sudo tar czf nginx-logs.tgz /var/log/nginx` |
| The database: every sign-in and refusal, errors | Postgres's `log/` directory, a file a day | `sudo tar czf pg-logs.tgz /var/lib/pgsql/data/log` |
| n8n | the journal, if it logs there (see `deploy/README.md`) | `sudo journalctl CONTAINER_NAME=n8n --since "…" > n8n.log` |
| Changes to hotel data: who changed what | the database's own audit log | ask the master chat for the query |
| Staff sign-ins to the app | **Firebase Authentication, at Google** | not on the server; see "Still open" |

Every one of these records its time with the time zone (FAQ Q40 asks for the
zone to be kept).

**The clock.** The server keeps time from Oracle's own time service, which
CERT-In's FAQ Q42 allows for machines in the cloud (*"The entities relying on
the native time services offered as part of Cloud may continue to use the
same"*); `deploy/launch.sh` checks it is running. CERT-In's own time servers,
if ever needed: samay1.nic.in, samay2.nic.in, time.nplindia.org (FAQ Q43).

## Contacts

| Who | How |
|---|---|
| CERT-In, incidents | incident@cert-in.org.in · 1800-11-4949 · fax 1800-11-6969 |
| CERT-In, Point of Contact filing | info@cert-in.org.in |
| Oracle Cloud (server, bucket) | the Oracle console → Help → Support |
| Google Firebase (staff sign-in) | the Firebase console → Support |
| The owner (both companies' Point of Contact) | *as on the forms below* |

## Point of Contact forms (to file now)

Each company names one person to CERT-In, by email to **info@cert-in.org.in**,
in this format, and keeps it up to date (Directions, direction (iii) and
Annexure II; FAQ Q29). Two emails, one per company. The owner fills in and
sends them; nothing here is sent by the system.

**Fidato Hotels**

```
Name:
Designation:
Organisation Name:     Fidato Hotels (its registered legal name)
Office Address:
Email ID:
Mobile No.:
Office Phone:
Office Fax:            (none, if none)
```

**Influvate**

```
Name:
Designation:
Organisation Name:     Influvate (its registered legal name)
Office Address:
Email ID:
Mobile No.:
Office Phone:
Office Fax:            (none, if none)
```

## Still open

- **Staff sign-in logs** sit with Google (Firebase Authentication). Whether
  they can be kept for 180 days, and whether logs held outside India satisfy
  CERT-In, is not settled: FAQ Q35 allows logs abroad if they can be produced
  in reasonable time, and Q36 keeps records of financial transactions in India.
  A question for the lawyer (`docs/selling-in-india/cert-in-and-payments.md`,
  Unresolved 3).
- **CERT-In's guidance of 10 June 2026 to software vendors** (CISG-2026-03):
  tell customers and CERT-In of critical flaws at once, patch high ones in 7
  days, name a security liaison. Guidance, not a direction; for Influvate
  before the first buyer.
- **Review this plan** once a year, after any incident, and when anyone named
  in it changes.

## Sources

- CERT-In Directions under s.70B(6), No. 20(3)/2022-CERT-In, 28 April 2022:
  https://www.cert-in.org.in/PDF/CERT-In_Directions_70B_28.04.2022.pdf
- CERT-In, FAQs on the Directions, May 2022:
  https://www.cert-in.org.in/PDF/FAQs_on_CyberSecurityDirections_May2022.pdf
- CERT-In, extension for MSMEs, 27 June 2022 (ended 25 September 2022):
  https://www.cert-in.org.in/PDF/CERT-In_directions_extension_MSMEs_and_validation_27.06.2022.pdf
- CERT-In's Directions page, listing all three, checked 27 September 2026:
  https://www.cert-in.org.in/Directions70B.jsp
- CERT-In incident reporting form, fetched 27 September 2026:
  https://www.cert-in.org.in/PDF/certinirform.pdf
- Jan Vishwas (Amendment of Provisions) Act 2023, the ₹1 crore fine:
  https://egazette.gov.in/WriteReadData/2023/248047.pdf
- DPDP Rules 2025, G.S.R. 846(E), 13 November 2025, rule 7:
  https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf
