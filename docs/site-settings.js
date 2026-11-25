// Settings for the GitHub Pages build. Every value here is meant to be public:
// they only say which Firebase project and which Microsoft app to talk to.
// Passwords and keys never go in this file — the repository is public.

// Firebase: console → Project settings → Your apps → Web app → Config.
// While this is null the page runs as a demo.
// (The "apiKey" is not a secret: it only names the project. What protects the
// data is the sign-in plus the rules in firestore.rules.)
window.LEMSIC_FIREBASE = {
  apiKey: "AIzaSyCr1YKM6O0DIkTMGF8TCnaUZNLEHBaW3N0",
  authDomain: "lemsic-points.firebaseapp.com",
  projectId: "lemsic-points",
  storageBucket: "lemsic-points.firebasestorage.app",
  messagingSenderId: "315606714277",
  appId: "1:315606714277:web:112324b6fe554a5d138a4c"
};

// Microsoft 365, for keeping the Excel workbook up to date and saving the daily
// backups (see SETUP.md, part 2). Both are identifiers, not secrets: the app
// registration in LeMSIC's Microsoft Entra, and LeMSIC's Microsoft 365 tenant.
window.LEMSIC_MICROSOFT = {
  clientId: "0661a0ca-0e06-4ed4-9d8e-bc0a2e47bcfd",
  tenantId: "a910431d-3056-4cbe-817f-8bfd7ae94377"
};

// Who to contact when something goes wrong. Shown on the sign-in page and at the
// bottom of every page. "tel" is the number with the country code, for the
// call and WhatsApp links.
window.LEMSIC_HELP = { phone: "03 356 618", tel: "+9613356618" };
