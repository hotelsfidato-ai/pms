# Online check-in: the owner's steps (D27-207)

**Who does this:** the owner. Nothing here is a secret, and nothing here
changes what is live until the settings are put on the server on a release
day, with the master guiding.

Three ways a guest proves who they are on their page: a code on WhatsApp, a
code by email, or Continue with Google. The first two need only the sending
workflow (`deploy/n8n/IMPORT.md`). The third needs the steps in part 2.

---

## Part 1 · The code by email (nothing new to set)

The code goes through the same workflow as every other guest message
(`pms-send-crs.json`, `deploy/n8n/IMPORT.md` part B). Two things to know:

1. **Import the current file.** A copy imported before 30 September has no
   email for the check-in code. Import `pms-send-crs.json` again (switch the
   old one off and delete it once the new one works), or paste the
   `guest-link-code` entry into `EMAILS` in its **Read the message** node.
2. **`FROM` must be filled in**, as for every email.

The words of the email are the `guest-link-code` draft in `EMAILS`, yours to
change there: "Your check-in code for {hotel}" and, inside, the six digits
and "It works for 10 minutes. Do not share it with anyone."

---

## Part 2 · Continue with Google: a client ID

**Where:** a web browser, signed in with the Google account that owns the
PMS's project, **poms-fad05**. **Time:** about 10 minutes.

**What it makes:** a "client ID", a public name by which Google knows the
guest's page. It is not a password and unlocks nothing by itself. No Google
account is created for a guest, and no guest is added to the staff's sign-in.

### 2a · What the guest sees in Google's window (once)

1. Open **https://console.cloud.google.com/** and choose the project
   **poms-fad05** in the project picker (top left).
2. **Menu → APIs & Services → OAuth consent screen.** (Newer screens call
   this **Google Auth Platform**, with **Branding** and **Audience** pages.)
3. If it has never been set up, press **Get started** and fill in:
   - **App name:** the name a guest reads in Google's window, "Continue to
     …". Your choice; the group's name is the usual one.
   - **User support email:** an address a guest could write to.
   - **Audience:** **External** (guests are not in your organisation).
   - **Contact email:** yours.
4. On **Audience**, the **Publishing status** must read **In production**.
   If it reads **Testing**, press **Publish app**: in Testing only the
   people you list by hand can use it, and every guest would be refused.
   Nothing here needs Google's review: the page asks only for the account's
   name and email.

### 2b · The client ID

5. **Menu → APIs & Services → Credentials** (newer screens: **Google Auth
   Platform → Clients**).
6. **+ Create credentials → OAuth client ID** (or **Create client**).
7. **Application type:** **Web application**. **Name:** `PMS guest page`.
8. Under **Authorised JavaScript origins**, press **+ Add URI** and type
   exactly: `https://pms.fidatohotels.com` (no slash at the end, no path).
9. Leave **Authorised redirect URIs** empty. Press **Create**.
10. Copy the **Client ID**. It ends `.apps.googleusercontent.com`. You may
    tell it to the master: it is not a secret.

> The same box shows a **Client secret**. It is not used. Do not copy it
> anywhere.

### 2c · On the release day

The master gives you the exact command, labelled with where it runs, to put
one setting on the PMS server:

| Setting | What goes in it |
|---|---|
| `GOOGLE_CLIENT_ID` | the Client ID from step 10 |

Until it is set, the guest's page does not show "Continue with Google" and
the other two ways work as they are.

### 2d · Try it

Make a booking with **your own Gmail address** as the guest's email, send
yourself its check-in link, open it on your phone, press **Continue with
Google** and choose that account. The page should say "Verified on this
phone". Then try with a different Google account: it must say "That Google
account is not the one on this booking."

## What to expect

- **The address must be the booking's.** A guest who booked with one
  address and signs in with another is refused, and can use a code instead.
- **Bookings from booking sites** often carry the site's own relay address
  for the guest. Google will never match one; the email code still reaches
  the guest if the site forwards it.
- **Opened inside some apps** (Facebook, Instagram), Google refuses to sign
  in. Opened from WhatsApp, email or the phone's browser it works. A guest
  who meets this can use a code.
- **To switch it off:** remove `GOOGLE_CLIENT_ID` from the server's settings
  and restart. To end it for good, delete the client in step 5's list.
