# The read-only Google login for the leads app, without a key (D27-103, D27-186)

**Who does this:** the owner. **Where:** a web browser on the owner's PC,
signed in with the Google account that owns the project each part names (the
PMS's is `poms-fad05`, the leads app's is `live-inventory1`; switch account
at the top right if they are owned by different ones). **Time:** about
15 minutes. Nothing here changes the leads app, its rules or its data.

**What it makes:** the PMS can read the leads, the conversations and the ad
spend, and can never change or delete anything in the app.

**Why there is no key (30 September).** Your Google organisation forbids keys
for service accounts (the rule `iam.disableServiceAccountKeyCreation`), so
"Create new key" was refused. That is the safer way round anyway: there is no
file to lose. Instead:

```
the PMS server's own Google login        (it already has one: the login it
        │                                 checks staff sign-ins with)
        │  asks Google: "a token as pms-reader, for one hour"
        ▼
pms-reader@live-inventory1               (read only: Cloud Datastore Viewer)
        │
        ▼
the leads app's data, read only
```

Google gives the token only because you allow it in Part 3, and only for
`pms-reader`. The token lasts one hour at most, stays in the server's memory,
and is never written to a file or a log.

---

## Part 1 · The read-only login (`pms-reader`) - done if it is already in the list

1. Open **https://console.cloud.google.com/**.
2. At the top left, click the **project picker** and choose the project whose
   **ID** reads **live-inventory1**. Check the top bar now shows it.
3. **Menu** (three lines, top left) → **IAM & Admin** → **Service Accounts**.
4. If **pms-reader@live-inventory1.iam.gserviceaccount.com** is in the list,
   go to Part 2. If not: **+ Create service account**, name `pms-reader`,
   description `The PMS reads leads, read only`, **Create and continue**,
   role **Cloud Datastore Viewer** and **no other role**, **Continue**,
   **Done**.

## Part 2 · Find the PMS server's own Google login (an email, not a secret)

5. Open **https://console.firebase.google.com/** and click the project
   **poms-fad05** (the PMS).
6. Click the **gear** (top left, beside "Project Overview") → **Project
   settings**.
7. Click the **Service accounts** tab.
8. Under **Firebase Admin SDK** the page shows **Firebase service account**
   and an email like
   `firebase-adminsdk-xxxxx@poms-fad05.iam.gserviceaccount.com`. **Copy that
   email.** It is the `client_email` of the login the PMS server uses.

> ⚠ **Do not click "Generate new private key"** on that page. You only need
> the email. It is not a secret; you may tell it to the master.

## Part 3 · Let the PMS's login borrow `pms-reader`, and nothing else

9. Back in **https://console.cloud.google.com/**, project **live-inventory1**
   → **Menu → IAM & Admin → Service Accounts**.
10. Click **pms-reader@live-inventory1.iam.gserviceaccount.com** (the email
    itself, to open it).
11. Click the **Principals with access** tab (older screens call it
    **Permissions**).
12. Click **Grant access**.
13. In **New principals**, paste the email from step 8.
14. In **Select a role**, type `Service Account Token Creator` and click
    **Service Account Token Creator**.
15. Click **Save**.

> ⚠ **Only here, on `pms-reader` itself.** Do **not** give this role on the
> project's main **IAM** page: there it would let the PMS borrow every login
> in the leads app's project, the administrator ones included. And give it to
> **nobody else**: only the one email from step 8.

## Part 4 · Switch on the service that hands out the token

Google's rule: the service must be on in the project of the login that ASKS,
which is the PMS's project, **poms-fad05**.

16. In **https://console.cloud.google.com/**, click the **project picker**
    and choose **poms-fad05**. Check the top bar shows it.
17. **Menu → APIs & Services → Library**.
18. In the search box type `IAM Service Account Credentials API` and click
    the result with exactly that name.
19. Click **Enable**. (If the button reads **Manage**, it is already on.)

## Part 5 · Check it (still in the browser)

20. Project **live-inventory1** → **Menu → IAM & Admin → IAM**. Find
    `pms-reader`. Its **Role** must say **Cloud Datastore Viewer** and
    nothing else. The PMS's email from step 8 must **not** be in this list.
21. **IAM & Admin → Service Accounts → pms-reader → Principals with access.**
    The email from step 8 is there with **Service Account Token Creator**,
    and nothing else was added.

## Part 6 · On the release day

The master gives you the exact commands, each labelled with where it runs,
to put these four settings on the PMS server, in the same place as the PMS's
other settings. None of the four is a secret.

| Setting | What goes in it |
|---|---|
| `M2R_IMPERSONATE` | `pms-reader@live-inventory1.iam.gserviceaccount.com` |
| `M2R_HOTELS` | `AMR=amrapali-kolhapur,GLM=grand-lucent-mathura` (Amrapali Kolhapur and Hotel Grand Lucent Mathura: the PMS's code, `=`, the app's id) |
| `M2R_APP_URL` | the app's address, so the PMS can link to a lead: `https://live-inventory1.web.app` |
| `M2R_DAILY_READS` | the most the PMS may read in a day: `5000`, your decision of 29 September (D27-170), a tenth of the free 50,000 |

`M2R_SERVICE_ACCOUNT` (a key) stays **empty**. It still works if Google ever
allows a key and one is put there.

Until the four are set, the Leads and WhatsApp screen says it is not
connected yet and the PMS reads nothing. Once they are, the PMS reads the app
only when somebody opens Leads and WhatsApp or Marketing, and keeps no copy
(D27-170); System health shows how much it read each day.

A hotel that is not in `M2R_HOTELS` shows "this property is not one of the
leads app's hotels". Hotel Grand Lucent has no campaign list in the app yet:
Marketing shows it as "No campaigns this month", not as an error.

## If a screen says something is wrong

| The screen says | What it means | What to do |
|---|---|---|
| "not connected yet" | a setting is missing, or `M2R_IMPERSONATE` is not typed exactly | check the four settings with the master |
| "The leads app did not answer (403)" | Google refused: Part 3 was given to a different email than the server's, or Part 4 is not switched on, or `pms-reader` lost its role | redo the checks in Part 5; if they are right, tell the master. The master then gives you one labelled command that shows only the server login's email, never its key |
| "The leads app did not answer (404)" | the project or the login's name is wrong | check `M2R_IMPERSONATE` letter by letter |
| "The leads app could not be reached" | no answer from Google in 15 seconds, or the server has no Google login of its own | try again in a few minutes; then tell the master |

## To stop the PMS reading, at any time

**IAM & Admin → Service Accounts → pms-reader → Principals with access** →
the PMS's email → the **bin** (or the pencil, then remove the role) →
**Save**. The PMS stops reading within the hour: a token already handed out
lasts until its hour ends. There is no key to delete.
