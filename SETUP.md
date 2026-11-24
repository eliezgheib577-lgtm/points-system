# Setting up LeMSIC Points on GitHub Pages

About twenty minutes, once. You need a Google account, and access to this
GitHub repository. Nothing here costs money, and no card is asked for.

The site lives on GitHub Pages. The shared data and the sign-in live in a free
Firebase project. The rules in `firestore.rules` decide who sees what, and
Firebase enforces them.

## 1. Create the Firebase project

1. Go to <https://console.firebase.google.com> and choose **Create a project**.
2. Name it, for example `lemsic-points`. Google Analytics is not needed — switch it off.
3. Wait for it to finish, then **Continue**.

## 2. Turn on sign-in

1. In the left menu: **Security → Authentication → Get started**. (Older
   versions of the console list it under **Build**.)
2. Under **Sign-in method**, choose **Email/Password**, switch on the first toggle
   (leave "Email link" off), and **Save**.
3. Open the **Settings** tab → **User actions**. Untick **Enable create
   (sign-up)** and **Enable deletion**, and **Save**. Otherwise anyone who finds
   the site could make an account of their own. You can still add and delete
   users yourself from the console. (If your console doesn't show User actions,
   skip this: the rules already give such accounts nothing.)

## 3. Create one login per position

**Authentication → Users → Add user**, eight times:

| Email | Position |
|---|---|
| `vpa@lemsic-points.app` | VPA |
| `lo.aub@lemsic-points.app` | LO · LC AUB |
| `lo.usj@lemsic-points.app` | LO · LC USJ |
| `lo.lau@lemsic-points.app` | LO · LC LAU |
| `lo.bau@lemsic-points.app` | LO · LC BAU |
| `lo.lu@lemsic-points.app` | LO · LC LU |
| `lo.uob@lemsic-points.app` | LO · LC UOB |
| `lo.usek@lemsic-points.app` | LO · LC USEK |

- Pick a different password for each, at least 10 characters.
- `lemsic-points.app` is only part of the login name. Nothing is ever emailed
  to it. People type just `lo.aub` on the sign-in page.
- Give each LO their password yourself. **Never put a password into this
  repository** — it is public.

To change a password later (someone forgot it, or a new person takes over a
position): the console's **Reset password** only emails a link, and these
addresses don't receive email. Instead, **delete that user and add it again**
with the same address and the new password. Nothing is lost — the site goes by
the position (`lo.aub`), not by the account.

## 4. Create the database and its rules

1. **Databases & Storage → Firestore → Create database**. (Older consoles:
   **Build → Firestore Database**.)
2. If asked for an edition, choose **Standard**. Leave the database ID as
   **(default)** — the site looks for that one.
3. Location: `eur3 (europe-west)` is a good choice for Lebanon; any
   `europe-west` location is fine. It can't be changed later.
4. Start in **production mode** → **Create**.
5. Open the **Rules** tab, delete everything there, paste in the whole of
   `firestore.rules` from this repository, and **Publish**.

## 5. Connect the site to the project

1. On **Project Overview**, choose **+ Add app** and pick the web icon `</>`.
   (Or **Settings → Project settings → Your apps**.)
2. Give it a nickname (say `LeMSIC Points`), leave Firebase Hosting off, and
   **Register app**.
3. Firebase shows a block starting `const firebaseConfig = {`. Copy everything
   between the `{` and the `}`.
4. In this repository, open `docs/site-settings.js` and replace the
   `window.LEMSIC_FIREBASE = null;` line with:

   ```js
   window.LEMSIC_FIREBASE = {
     // paste the lines you copied here
   };
   ```

These values are meant to be public — they only say which project to talk to.
The rules from step 4 are what protect the data.

## 6. Publish the site

1. On GitHub: **Settings → Pages**.
2. **Source: Deploy from a branch**. Branch: the one holding this code;
   folder: **/docs** → **Save**.
3. After a minute the address appears at the top of that page, ending in
   `github.io/points-system/`.

## 7. First sign-in

1. Open the address and sign in as `vpa`.
2. Click **Load the starting setup**. This loads the term, the seven committees
   and a starting rubric; change any of it from the app afterwards.
3. **Upload the member list** under **Members**: an Excel or CSV file with each
   member's name, LeMSIC ID and LC. LOs find volunteers by typing a name or ID,
   from any LC. People already there are recognised, so uploading an updated
   list later only adds the new ones.
4. **Import the old points sheet** under **Import old sheet**, before LOs
   start submitting. Doing it after step 3 lets it match people by LeMSIC ID.
   It brings in each member's points as a starting balance, adds anyone
   missing to the member list, and can be undone.
5. Send each LO the address and their password.

Points always count for the member's own LC, even when another LC's event
credits them. The Ledger sheet notes which LC ran the event.

## Optional: lock the key to your site

Firebase's web key can be restricted so it only works from your GitHub Pages
address. In <https://console.cloud.google.com> open the same project,
go to **APIs & Services → Credentials**, open the **Browser key**, and under
**Application restrictions** choose **Websites** and add
`https://<your-github-username>.github.io/*`. The rules already protect the
data; this only stops other sites from using your project's sign-in.

---

# Part 2 — Keeping the Excel workbook up to date

Optional, and it can be done any time. Without it, the VPA downloads the
workbook from the Excel screen whenever they want a copy. With it, every
approval, correction and import rewrites the workbook on LeMSIC's SharePoint or
OneDrive by itself.

It needs **someone who manages LeMSIC's Microsoft 365** for steps 1–3, once.

## 1. Register the app

1. Sign in to <https://entra.microsoft.com> with a LeMSIC admin account.
2. **Identity → Applications → App registrations → New registration**.
3. Name: `LeMSIC Points`.
4. Supported account types: **Accounts in this organizational directory only**.
5. Redirect URI: choose **Single-page application (SPA)** and enter the site's
   address followed by `ms-redirect.html`, for example
   `https://<your-github-username>.github.io/points-system/ms-redirect.html`.
6. **Register**.

## 2. Allow it to edit files

1. In the new app: **API permissions → Add a permission → Microsoft Graph →
   Delegated permissions**.
2. Tick **Files.ReadWrite.All** → **Add permissions**.
3. Choose **Grant admin consent for LeMSIC** and confirm. (If you skip this, the
   VPA is asked to agree the first time they sign in — some organisations don't
   allow that, in which case the admin has to grant it here.)

"Delegated" means the site can only ever touch files the signed-in person
could open themselves, and only while they use the site.

## 3. Put the two IDs into the site

On the app's **Overview** page, copy the **Application (client) ID** and the
**Directory (tenant) ID**. In `docs/site-settings.js`, replace
`window.LEMSIC_MICROSOFT = null;` with:

```js
window.LEMSIC_MICROSOFT = { clientId: "<Application (client) ID>", tenantId: "<Directory (tenant) ID>" };
```

Both are identifiers, not secrets.

## 4. Choose the workbook

1. Sign in to the site as `vpa` and open **Excel**.
2. **Sign in to Microsoft** with the LeMSIC account that can edit the workbook.
3. Either paste the link to the workbook you already keep (in Excel or SharePoint:
   **Share → Copy link**), or let the site create `LeMSIC Points.xlsx` in that
   account's OneDrive.

The site writes three sheets — **Totals by member**, **Ledger** and **By LC** —
and rewrites them after every change. Any other sheet in the workbook is never
touched, so notes, charts and pivot tables of your own are safe. Don't type into
those three sheets; corrections go through the site.

Those three sheets are locked against accidental typing (Excel shows them as
protected), so nobody edits them by mistake and then loses the edit.

## 5. Share the workbook

Share it from Excel or SharePoint as usual — **view-only** is right for most
people. Every update the site makes shows up for everyone who has it open, and
the **Totals by member** sheet says when it was last updated.

**Whoever you share it with sees every member's points.** Share it with the
board; don't share it with Local Officers, or they see what the site keeps from
them.

## How updates reach the workbook

Updates are written from the VPA's browser, so there is no server to run:

- Approve, correct or import on a device signed in to Microsoft, and the
  workbook updates within seconds.
- Do it on a device that isn't (a phone, say), and the workbook still updates
  within seconds **if the site is open on a signed-in device** at the time.
- If it isn't, the site shows **Excel: behind** at the top, and the workbook
  catches up by itself the next time the site is opened on a signed-in device.
- If the workbook is locked by someone editing it, the Excel screen says so,
  and **Update now** catches up.
