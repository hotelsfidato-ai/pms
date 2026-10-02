# Online check-in: the owner's steps (D27-207 to D27-212)

**Who does this:** the owner. Nothing here changes what is live until the
settings are put on the server on a release day, with the master guiding.
Parts 1 and 2 hold no secret. Part 3 has two kinds (a workflow's secret, and
one password per hotel): they go from your password manager to the server
and nowhere else.

Three ways a guest proves who they are on their page: a code on WhatsApp, a
code by email, or Continue with Google. The first two need only the sending
workflow (`deploy/n8n/IMPORT.md`). The third needs the steps in part 2.
Guests' ID photos, encrypted and kept in Google Drive, are part 3.

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
9. Under **Authorised redirect URIs**, press **+ Add URI** and type exactly:
   `https://pms.fidatohotels.com/g-return` (OCI-10: Google sends the guest
   back to this address, so no script of Google's runs on the guest's page).
   Press **Create**.

   > **Already made the client before 2 October?** Open it (**Credentials**
   > → `PMS guest page`), add that same redirect URI, and **Save**. Until it
   > is there, Google refuses the sign-in with "redirect_uri_mismatch" and
   > the guest uses a code instead.
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

---

## Part 3 · ID photos: encrypted, in Google Drive (D27-207 to D27-212)

**What this is.** A guest may add a photo of their ID on their page, and the
desk may add one at check-in. The photo is **never kept on the PMS server**:
the server encrypts it with **that hotel's own password** and stores it in
Google Drive, and fetches it back only when somebody at the desk opens it.
In Drive it is a file with a name like `3f2c9a1e-….zip` that nobody can open
without the password.

**Until all of this is done, the upload is simply not offered**, and Online
check-in says "ID photos are off for this hotel".

### 3a · Install 7-Zip on your own PC (once)

You open a bundle by hand with **7-Zip** (free, from **7-zip.org**).
Windows' own "Extract" cannot open a password-protected file of this kind.
You install it yourself.

### 3b · The folders in Drive

In the Google Drive **the CRS's n8n saves vouchers to** (the account behind
its "Google Drive" login):

1. **New → Folder**, name it `ID photos`.
2. Open it, and inside make one folder per hotel, named by the PMS's code:
   `5EL`, `AMR` and `GLM` (5 Elements takes ID photos too, D27-235).
3. Open `5EL`. In the browser's address, the folder's **id** is the last
   part, after `/folders/`. Copy it. Do the same for `AMR` and `GLM`.
4. **Do not share these folders** with anybody. They need no sharing: the
   workflow reaches them through the CRS's own Drive login.

The folder ids are not secrets; they go into the workflow
(`deploy/n8n/IMPORT.md`, part D, step 4).

### 3c · One password per hotel

In your password manager, make one password for each hotel:

- **Letters and digits only, 24 or more.** Switch symbols off in the
  generator. (The PMS treats a password shorter than 20, or with any other
  character in it, as not set. The file format's own protection is weak for
  a short password.)
- Save each under a clear name, such as `ID photos AMR`.
- **Never** type one into a chat, an email or a document.

> ⚠ **If a password is lost, that hotel's photos cannot be opened by
> anybody, ever.** There is no master password and no way round it.
>
> ⚠ **Do not change a password once photos exist.** The PMS can no longer
> open the earlier ones (you still can, by hand, with the old password). If
> one must change, tell the master first.

### 3d · The workflow

`deploy/n8n/IMPORT.md`, **part D**: import `pms-id-photos-crs.json` into the
CRS's n8n, give it its own new secret and the Drive login, paste the three
folder ids, switch it Active.

### 3e · On the release day

The master gives you the exact commands, each labelled with where it runs.
You type the values yourself; they are never pasted into a chat.

| Setting | What goes in it |
|---|---|
| `ID_PHOTO_N8N_URL` | the ID photos workflow's Production URL |
| `ID_PHOTO_N8N_SECRET` | that workflow's secret |
| `ID_PHOTO_PASSWORD_5EL` | 5 Elements' password from 3c |
| `ID_PHOTO_PASSWORD_AMR` | Amrapali's password from 3c |
| `ID_PHOTO_PASSWORD_GLM` | Grand Lucent's password from 3c |

### 3f · The check that switches it on - before any guest's photo

This is the first time the Drive steps run, and the first time a bundle is
opened in 7-Zip. **Do all five with a made-up photo** (photograph a blank
card or a piece of paper, not anybody's ID):

1. **Add it.** On a test booking at the hotel, in the check-in, add the photo
   ("A photo of the ID", tick the box, **Add the photo**). It should say
   "Added".
2. **See it in the PMS.** Front desk → **Online check-in** → **ID photos
   kept** → **Show the photo**. Your made-up photo appears.
3. **See it in Drive.** Open the hotel's folder inside `ID photos`. There is
   one new file, named with letters, digits and dashes and ending `.zip`.
   Download it.
4. **Open it in 7-Zip.** Right-click the downloaded file → **7-Zip → Open
   archive**. It lists `about.txt` and `front.jpg`. Double-click
   `front.jpg`: 7-Zip asks for a password. Type the hotel's. The photo
   opens. Close it, try again with a **wrong** password: it must be refused.
   `about.txt` (same password) says the hotel, the booking and the guest.
5. **Delete it.** Back in **ID photos kept** → **Delete the photo**, with a
   reason. The file disappears from the Drive folder, and it is not in
   Drive's bin. Delete the downloaded copy from your PC too.

**All five pass: leave it on.** If any one does not, remove the two
passwords from the server's settings (the upload switches itself off) and
tell the master exactly which step and what it said.

### Opening a bundle by hand, later

Download the file from the hotel's folder → right-click → **7-Zip → Open
archive** → open a file inside → the hotel's password. `about.txt` inside
says whose it is. The file's own name says nothing about the guest, on
purpose: to find one guest's file without opening several, ask the master
for that booking's record id, which is the file's name.

### Who sees a photo in the PMS

- **While the guest's details wait to be checked:** reception and the
  managers, on Online check-in, beside what the guest typed. They remove one
  that is not masked (an Aadhaar must have its first 8 digits hidden), not
  readable or not an ID; the guest's page then asks for another.
- **Once kept** (the desk has confirmed the details, or added the photo at
  check-in): only you, an administrator and the general manager, in **ID
  photos kept**. Only you three delete one, with a reason.
- **Every time anybody opens a photo, who and when is recorded.**
- A removed photo whose file Drive did not delete shows "not yet deleted
  from Drive" with **Try again**.
