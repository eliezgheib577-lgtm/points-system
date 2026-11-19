import { Router } from "express";
import { z } from "zod";
import { one, query } from "../lib/db.js";
import { hashPassword, verifyPassword } from "../auth/passwords.js";
import { createSession, destroySession } from "../auth/session.js";
import { bare } from "../views/layout.js";
import { html } from "../lib/html.js";
import { csrfField, note } from "../views/components.js";
import { audit } from "../domain/core.js";
import { randomToken } from "../lib/text.js";
import { clearAttempts, isLimited, minutesUntilReset, recordFailure } from "../auth/rate-limit.js";

export const authRoutes = Router();

function loginPage(options: { error?: string; next?: string; csrf: string }): string {
  return bare("Sign in", html`
    <div class="auth">
      <div class="auth-l">
        <div class="brand" style="padding:0"><div class="mark">LP</div>
          <div><b>LeMSIC Points</b><span>Volunteering &amp; contribution tracker</span></div></div>
        <h2>One place for every event, every volunteer, every point.</h2>
        <p>Local Officers submit the work their members did. The VPA reviews it once, approves it,
           and the points sheet updates itself.</p>
        <div class="auth-steps">
          <div class="as"><span class="n">1</span><span>LO logs an event and the volunteers behind it</span></div>
          <div class="as"><span class="n">2</span><span>Points are suggested automatically from the official rubric</span></div>
          <div class="as"><span class="n">3</span><span>VPA reviews, edits if needed, approves</span></div>
          <div class="as"><span class="n">4</span><span>Approved points land in the live sheet</span></div>
        </div>
      </div>
      <div class="auth-r">
        <form class="authbox" method="post" action="/login">
          ${csrfField(options.csrf)}
          <input type="hidden" name="next" value="${options.next ?? ""}">
          <h3>Sign in</h3>
          <p class="sub">Accounts are issued by the VPA. There is no public sign-up.</p>
          ${options.error ? html`<div style="margin:14px 0">${note("warn", options.error)}</div>` : ""}
          <div style="display:flex;flex-direction:column;gap:13px;margin-top:16px">
            <div class="field"><label for="username">Username</label>
              <input class="inp" id="username" name="username" autocomplete="username" autofocus required></div>
            <div class="field"><label for="password">Password</label>
              <input class="inp" id="password" name="password" type="password" autocomplete="current-password" required></div>
            <button class="btn pri" style="justify-content:center;padding:10px" type="submit">Sign in</button>
            ${note("info", "First sign-in asks you to choose a new password. Sessions last 14 days.")}
          </div>
        </form>
      </div>
    </div>`);
}

authRoutes.get("/login", async (req, res) => {
  if (req.user) return res.redirect("/");
  // A visitor has no session yet, so mint one token just for this form.
  const csrf = randomToken(16);
  res.cookie("pre", csrf, { httpOnly: true, sameSite: "lax", signed: true, maxAge: 900_000 });
  res.send(loginPage({ csrf, next: typeof req.query.next === "string" ? req.query.next : undefined }));
});

const credentials = z.object({
  username: z.string().min(1).max(80),
  password: z.string().min(1).max(200),
  next: z.string().optional(),
});

authRoutes.post("/login", async (req, res) => {
  const parsed = credentials.safeParse(req.body);
  const csrf = randomToken(16);
  res.cookie("pre", csrf, { httpOnly: true, sameSite: "lax", signed: true, maxAge: 900_000 });
  if (!parsed.success) {
    return res.status(400).send(loginPage({ csrf, error: "Fill in both fields." }));
  }
  const { username, password, next } = parsed.data;

  // Throttle before touching the database, so guessing costs the attacker time
  // whether or not the username exists.
  const byName = `user:${username.toLowerCase()}`;
  const byAddress = `ip:${req.ip ?? "unknown"}`;
  if (isLimited(byName, 10) || isLimited(byAddress, 50)) {
    await audit({ actorId: null, action: "login.throttled", summary: `Too many attempts for “${username}”`, ip: req.ip ?? null });
    return res.status(429).send(loginPage({
      csrf,
      error: `Too many sign-in attempts. Try again in ${Math.max(minutesUntilReset(byName), 1)} minutes, or ask the VPA to reset your password.`,
    }));
  }

  const user = await one<{ id: number; password_hash: string; active: boolean }>(
    "select id, password_hash, active from users where lower(username) = lower($1)",
    [username],
  );
  const ok = user?.active === true && await verifyPassword(password, user.password_hash);
  if (!ok || !user) {
    recordFailure(byName);
    recordFailure(byAddress);
    await audit({ actorId: null, action: "login.failed", summary: `Failed sign-in for “${username}”`, ip: req.ip ?? null });
    // Same message either way: never reveal which usernames exist.
    return res.status(401).send(loginPage({ csrf, error: "That username and password don't match." }));
  }
  // Only the username's record is cleared. The per-address count is left to
  // expire on its own: otherwise anyone holding one valid account could sign in
  // between guesses at other people's and keep resetting it.
  clearAttempts(byName);
  await createSession(user.id, req, res);
  await audit({ actorId: user.id, action: "login.ok", summary: "Signed in", ip: req.ip ?? null });
  res.redirect(next && next.startsWith("/") ? next : "/");
});

authRoutes.post("/logout", async (req, res) => {
  if (req.user) await audit({ actorId: req.user.id, action: "logout", summary: "Signed out" });
  await destroySession(req, res);
  res.redirect("/login");
});

authRoutes.get("/password", async (req, res) => {
  if (!req.user) return res.redirect("/login");
  res.send(bare("Choose a password", html`
    <div class="auth-r" style="min-height:100vh">
      <form class="authbox" method="post" action="/password">
        ${csrfField(req.csrfToken ?? "")}
        <h3>Choose your password</h3>
        <p class="sub">${req.user.must_change_password
          ? "Your account was created with a one-time password. Pick your own before you carry on."
          : "Change the password you use to sign in."}</p>
        <div style="display:flex;flex-direction:column;gap:13px;margin-top:16px">
          <div class="field"><label for="current">Current password</label>
            <input class="inp" id="current" name="current" type="password" autocomplete="current-password" required></div>
          <div class="field"><label for="next">New password</label>
            <input class="inp" id="next" name="next" type="password" autocomplete="new-password" minlength="10" required>
            <span class="hint">At least 10 characters. A short phrase is easier to remember and harder to guess.</span></div>
          <button class="btn pri" style="justify-content:center;padding:10px" type="submit">Save password</button>
        </div>
      </form>
    </div>`));
});

authRoutes.post("/password", async (req, res) => {
  if (!req.user) return res.redirect("/login");
  const parsed = z.object({ current: z.string(), next: z.string().min(10).max(200) }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).send(bare("Choose a password", html`
      <div class="auth-r" style="min-height:100vh"><div class="authbox">
        ${note("warn", "The new password needs at least 10 characters.")}
        <p style="margin-top:14px"><a href="/password">Try again</a></p></div></div>`));
  }
  const row = await one<{ password_hash: string }>("select password_hash from users where id = $1", [req.user.id]);
  if (!row || !await verifyPassword(parsed.data.current, row.password_hash)) {
    return res.status(400).send(bare("Choose a password", html`
      <div class="auth-r" style="min-height:100vh"><div class="authbox">
        ${note("warn", "That current password is not right.")}
        <p style="margin-top:14px"><a href="/password">Try again</a></p></div></div>`));
  }
  await query("update users set password_hash = $2, must_change_password = false where id = $1",
    [req.user.id, await hashPassword(parsed.data.next)]);
  await audit({ actorId: req.user.id, action: "password.changed", summary: "Changed their password" });
  res.redirect("/");
});
