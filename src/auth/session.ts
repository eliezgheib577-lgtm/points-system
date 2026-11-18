import type { NextFunction, Request, Response } from "express";
import { one, query } from "../lib/db.js";
import { randomToken } from "../lib/text.js";

export type Role = "lo" | "vpa" | "admin" | "member";

export interface AuthUser {
  id: number;
  username: string;
  display_name: string;
  role: Role;
  lc_id: number | null;
  lc_code: string | null;
  lc_name: string | null;
  member_id: number | null;
  must_change_password: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      sessionId?: string;
      csrfToken?: string;
    }
  }
}

const SESSION_COOKIE = "sid";
const SESSION_DAYS = 14;

export async function createSession(userId: number, req: Request, res: Response): Promise<void> {
  const id = randomToken(32);
  const csrf = randomToken(16);
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await query(
    `insert into sessions (id, user_id, csrf_token, expires_at, user_agent, ip)
     values ($1, $2, $3, $4, $5, $6)`,
    [id, userId, csrf, expires, req.get("user-agent") ?? null, req.ip ?? null],
  );
  await query("update users set last_login_at = now() where id = $1", [userId]);
  res.cookie(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    signed: true,
    expires,
  });
}

export async function destroySession(req: Request, res: Response): Promise<void> {
  if (req.sessionId) await query("delete from sessions where id = $1", [req.sessionId]);
  res.clearCookie(SESSION_COOKIE);
}

/** Attaches req.user when the cookie points at a live session. Never rejects. */
export async function loadUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const id = req.signedCookies?.[SESSION_COOKIE];
  if (typeof id !== "string" || id.length === 0) return next();
  const row = await one<AuthUser & { csrf_token: string }>(
    `select u.id, u.username, u.display_name, u.role, u.lc_id, u.member_id,
            u.must_change_password, s.csrf_token, c.code as lc_code, c.name as lc_name
       from sessions s
       join users u on u.id = s.user_id
  left join local_committees c on c.id = u.lc_id
      where s.id = $1 and s.expires_at > now() and u.active`,
    [id],
  );
  if (row) {
    const { csrf_token, ...user } = row;
    req.user = user as AuthUser;
    req.sessionId = id;
    req.csrfToken = csrf_token;
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    return;
  }
  if (req.user.must_change_password && req.path !== "/password" && req.method === "GET") {
    res.redirect("/password");
    return;
  }
  next();
}

/**
 * Role gate. This is the only thing standing between a Local Officer and the
 * points data, so it is checked on every request rather than by hiding links.
 */
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).send(renderForbidden(roles));
      return;
    }
    next();
  };
}

function renderForbidden(roles: Role[]): string {
  return `<!doctype html><meta charset="utf-8"><title>Not your screen</title>
  <link rel="stylesheet" href="/app.css">
  <div style="max-width:420px;margin:18vh auto;padding:0 20px">
    <h1 style="font-size:20px;margin-bottom:8px">That screen isn't yours</h1>
    <p style="color:var(--muted);font-size:14px">
      It is open to ${roles.join(" and ")} accounts only. If you think that's wrong, ask the VPA.</p>
    <p style="margin-top:16px"><a href="/" style="color:var(--accent);font-weight:600">Back to your dashboard</a></p>
  </div>`;
}

/** Rejects any state-changing request whose form token does not match the session. */
export function checkCsrf(req: Request, res: Response, next: NextFunction): void {
  if (req.method === "GET" || req.method === "HEAD") return next();
  const supplied = (req.body as Record<string, unknown> | undefined)?.["_csrf"];
  // Signed-in requests carry the session token; the sign-in form itself carries a
  // short-lived token from a signed cookie, since it has no session yet.
  const expected = req.csrfToken ?? (req.signedCookies?.["pre"] as string | undefined);
  if (!expected || supplied !== expected) {
    res.status(403).send("Your session expired or the form was stale. Go back and try again.");
    return;
  }
  next();
}
