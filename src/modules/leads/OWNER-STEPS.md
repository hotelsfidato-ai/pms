# The read-only Google login for the leads app (D27-103)

**Who does this:** the owner. **Where:** a web browser on the owner's PC,
signed in with the Google account that owns the market-to-revenue app's
Firebase project. **Time:** about 10 minutes. Nothing here changes the leads
app, its rules or its data.

**What it makes:** a "service account", a login for a program rather than a
person, with one permission only: **Cloud Datastore Viewer**. Google itself
refuses every write from it, so the PMS can read the leads, the conversations
and the ad spend, and can never change or delete anything in the app.

> ⚠ **Not the Firebase console's "Generate new private key" button**
> (Project settings, Service accounts). That key is a full administrator of
> the whole project. Use the steps below instead.

---

## Part 1 · Make the login

1. Open **https://console.cloud.google.com/**.
2. At the top left, click the **project picker** (it shows a project name
   and a small arrow).
3. In the list, click the market-to-revenue project. Its **ID** column reads
   **live-inventory1**. Check the top bar now shows that project.
4. Click the **menu** (three lines, top left) → **IAM & Admin** →
   **Service Accounts**.
5. Click **+ Create service account** (near the top).
6. Fill in:
   - **Service account name:** `pms-reader`
   - **Service account ID:** leave what it fills in (`pms-reader`)
   - **Description:** `The PMS reads leads, read only`
7. Click **Create and continue**.
8. Under **Grant this service account access to project**, click the
   **Select a role** box, type `Cloud Datastore Viewer`, and click
   **Cloud Datastore Viewer** in the list.
   - Add **no other role**. Not Editor, not Owner, not Firebase Admin, not
     Cloud Datastore User.
9. Click **Continue**, then **Done**. (Skip "Grant users access".)

## Part 2 · Make its key

10. In the list of service accounts, click **pms-reader@live-inventory1.iam.gserviceaccount.com**.
11. Click the **Keys** tab.
12. Click **Add key** → **Create new key**.
13. Choose **JSON**, click **Create**. A file downloads to your Downloads
    folder, named like `live-inventory1-1a2b3c4d5e6f.json`.

> ⚠ **This file is a key.** Do not email it, paste it into a chat, put it in
> Google Drive or OneDrive, or send it to anybody, including the master chat.
> It goes into the PMS server's settings on the release day, and nowhere else.

**If step 12 says "Service account key creation is disabled"**: stop, and
tell the master. Your Google account has a rule that blocks keys, and there
is another way that needs a different set of steps.

## Part 3 · Check it (still in the browser)

14. **Menu → IAM & Admin → IAM.** Find `pms-reader` in the list. Its **Role**
    column must say **Cloud Datastore Viewer** and nothing else.

## Part 4 · On the release day

The master gives you the exact commands, each labelled with where it runs,
to put these four settings on the PMS server, in the same place as the PMS's
own Firebase key:

| Setting | What goes in it |
|---|---|
| `M2R_SERVICE_ACCOUNT` | the whole content of the JSON file from step 13, as one line |
| `M2R_HOTELS` | which PMS hotel is which hotel in the app; for 5 Elements: `5EL=five-elements-akkalkot` |
| `M2R_APP_URL` | the app's address, so the PMS can link to a lead: `https://live-inventory1.web.app` |
| `M2R_DAILY_READS` | the most the PMS may read in a day: `5000`, your decision of 29 September (D27-170), a tenth of the free 50,000 |

Until they are set, the Leads and WhatsApp screen says it is not connected
yet and the PMS reads nothing. Once they are, the PMS reads the app only when
somebody opens Leads and WhatsApp or Marketing, and keeps no copy (D27-170);
System health shows how much it read each day.

After the settings are in and the server has restarted, **delete the JSON
file from Downloads** and empty the Recycle Bin.

## If the key is ever lost or seen by somebody else

Menu → IAM & Admin → Service Accounts → `pms-reader` → Keys → the key's
**bin icon** → Delete. The PMS stops reading at once. Make a new key
(Part 2) and ask the master to put it on the server.
