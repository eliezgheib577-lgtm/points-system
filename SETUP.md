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

1. In the left menu: **Build → Authentication → Get started**.
2. Under **Sign-in method**, choose **Email/Password**, switch on the first toggle
   (leave "Email link" off), and **Save**.

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
position), open that user here, choose **Reset password**, and set a new one.

## 4. Create the database and its rules

1. **Build → Firestore Database → Create database**.
2. Location: `eur3 (europe-west)` is a good choice for Lebanon. It can't be
   changed later.
3. Start in **production mode** → **Create**.
4. Open the **Rules** tab, delete everything there, paste in the whole of
   `firestore.rules` from this repository, and **Publish**.

## 5. Connect the site to the project

1. Click the gear next to **Project Overview → Project settings**.
2. Under **Your apps**, choose the web icon `</>`, give it a nickname (say
   `LeMSIC Points`), leave Firebase Hosting off, and **Register app**.
3. Firebase shows a block starting `const firebaseConfig = {`. Copy everything
   between the `{` and the `}`.
4. In this repository, open `docs/firebase-config.js` and replace the last line
   with:

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
3. Add your members under **Members**. LOs pick volunteers from this list.
4. Send each LO the address and their password.

## Optional: lock the key to your site

Firebase's web key can be restricted so it only works from your GitHub Pages
address. In <https://console.cloud.google.com> open the same project,
go to **APIs & Services → Credentials**, open the **Browser key**, and under
**Application restrictions** choose **Websites** and add
`https://<your-github-username>.github.io/*`. The rules already protect the
data; this only stops other sites from using your project's sign-in.
