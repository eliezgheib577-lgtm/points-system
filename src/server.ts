import express from "express";
import cookieParser from "cookie-parser";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { checkCsrf, loadUser } from "./auth/session.js";
import { authRoutes } from "./routes/auth.js";
import { loRoutes } from "./routes/lo.js";
import { vpaRoutes } from "./routes/vpa.js";
import { accountRoutes } from "./routes/accounts.js";
import { sharedRoutes } from "./routes/shared.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const secret = process.env.SESSION_SECRET;
if (!secret) throw new Error("SESSION_SECRET is not set — copy .env.example to .env");

export const app = express();
app.set("trust proxy", true);
app.disable("x-powered-by");

app.use(express.urlencoded({ extended: false, limit: "256kb" }));
app.use(cookieParser(secret));
app.use(express.static(path.join(here, "..", "public"), { maxAge: "1h" }));
app.use(loadUser);
app.use(checkCsrf);

// Specific role routes first; sharedRoutes owns the paths that branch on role,
// so "/submissions/new" must match before "/submissions/:id".
app.use(authRoutes);
app.use(loRoutes);
app.use(vpaRoutes);
app.use(accountRoutes);
app.use(sharedRoutes);

app.use((req, res) => {
  res.status(404).send(`<!doctype html><meta charset="utf-8"><title>Not found</title>
    <link rel="stylesheet" href="/app.css">
    <div style="max-width:420px;margin:18vh auto;padding:0 20px">
      <h1 style="font-size:20px;margin-bottom:8px">No such page</h1>
      <p style="color:var(--muted);font-size:14px">Nothing lives at ${req.path}.</p>
      <p style="margin-top:16px"><a href="/" style="color:var(--accent);font-weight:600">Back to your dashboard</a></p>
    </div>`);
});

app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  res.status(500).send(`<!doctype html><meta charset="utf-8"><title>Something broke</title>
    <link rel="stylesheet" href="/app.css">
    <div style="max-width:460px;margin:18vh auto;padding:0 20px">
      <h1 style="font-size:20px;margin-bottom:8px">Something broke on our side</h1>
      <p style="color:var(--muted);font-size:14px">Nothing you submitted was lost. Try again, and tell the VPA if it keeps happening.</p>
      <p style="margin-top:16px"><a href="/" style="color:var(--accent);font-weight:600">Back to your dashboard</a></p>
    </div>`);
});

const port = Number(process.env.PORT ?? 3000);
if (process.env.NODE_ENV !== "test") {
  app.listen(port, () => console.log(`LeMSIC Points listening on http://localhost:${port}`));
}
