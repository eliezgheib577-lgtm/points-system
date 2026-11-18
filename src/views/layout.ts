import { html, type Html, raw } from "../lib/html.js";
import type { AuthUser, Role } from "../auth/session.js";

interface NavItem { icon: string; label: string; href?: string; count?: number | null }

const LO_NAV: NavItem[] = [
  { icon: "◆", label: "Dashboard", href: "/" },
  { icon: "＋", label: "New submission", href: "/submissions/new" },
  { icon: "▤", label: "My submissions", href: "/submissions" },
  { icon: "◇", label: "Returned to me", href: "/submissions?status=returned" },
];
const LO_REFERENCE: NavItem[] = [
  { icon: "◉", label: "Points rubric", href: "/rubric" },
];
const VPA_NAV: NavItem[] = [
  { icon: "◆", label: "Overview", href: "/" },
  { icon: "◇", label: "Pending review", href: "/review" },
  { icon: "▤", label: "All submissions", href: "/submissions" },
  { icon: "≡", label: "Points sheet", href: "/points" },
  { icon: "◈", label: "Members", href: "/members" },
  { icon: "⇅", label: "Excel sync" },
  { icon: "◉", label: "Rubric & rules", href: "/rubric" },
  { icon: "⚙", label: "Accounts & LCs" },
  { icon: "⟲", label: "Audit log", href: "/audit" },
];
const MEMBER_NAV: NavItem[] = [
  { icon: "◆", label: "My points", href: "/" },
];

function navFor(role: Role): { main: NavItem[]; reference: NavItem[]; label: string } {
  if (role === "lo") return { main: LO_NAV, reference: LO_REFERENCE, label: "Local Officer" };
  if (role === "member") return { main: MEMBER_NAV, reference: [], label: "Member" };
  return { main: VPA_NAV, reference: [], label: role === "admin" ? "Admin" : "VPA" };
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
}

function navItem(item: NavItem, currentPath: string): Html {
  const active = item.href && (item.href === currentPath ||
    (item.href !== "/" && currentPath.startsWith(item.href.split("?")[0]!) && !item.href.includes("?")));
  const badge = item.count ? html`<span class="count">${item.count}</span>` : "";
  if (!item.href) {
    return html`<div class="nav" style="opacity:.45" title="Not built yet">
      <span class="ic">${item.icon}</span>${item.label}
      <span class="count" style="background:transparent;color:var(--side-muted)">soon</span></div>`;
  }
  return html`<a class="nav${active ? " on" : ""}" href="${item.href}" style="text-decoration:none">
    <span class="ic">${item.icon}</span>${item.label}${badge}</a>`;
}

export interface PageOptions {
  user: AuthUser;
  title: string;
  crumb?: Html | string;
  currentPath: string;
  csrf: string;
  termLabel?: string | null;
  topbarExtra?: Html;
  counts?: Record<string, number>;
  /** Review and ledger screens carry wide tables and need the full width. */
  wide?: boolean;
}

export function page(options: PageOptions, body: Html): string {
  const { user, title, crumb, currentPath, termLabel, topbarExtra, counts, csrf, wide } = options;
  const nav = navFor(user.role);
  const withCounts = (items: NavItem[]) =>
    items.map((item) => ({ ...item, count: counts?.[item.label] ?? null }));
  const subtitle = user.role === "lo"
    ? (user.lc_code ? `LC ${user.lc_code}` : "Local committee")
    : user.role === "member" ? "Member view" : "National · VPA";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · LeMSIC Points</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="/app.css">
</head><body>${html`
<div class="shell">
  <aside class="side">
    <div class="brand"><div class="mark">LP</div><div><b>LeMSIC Points</b><span>${subtitle}</span></div></div>
    <div class="navgroup">
      <div class="navlabel">${nav.label}</div>
      ${withCounts(nav.main).map((item) => navItem(item, currentPath))}
    </div>
    ${nav.reference.length > 0 ? html`<div class="navgroup">
      <div class="navlabel">Reference</div>
      ${nav.reference.map((item) => navItem(item, currentPath))}
    </div>` : ""}
    <div class="side-foot">
      <div class="avatar">${initials(user.display_name)}</div>
      <div style="flex:1"><b>${user.display_name}</b>
        <small>${user.role === "lo" ? `LO · LC ${user.lc_code ?? ""}` : user.role === "member" ? "Member" : "VPA · National"}</small></div>
    </div>
    <form method="post" action="/logout" style="margin:0">
      <input type="hidden" name="_csrf" value="${csrf}">
      <button class="nav" type="submit" style="width:100%;border:0;background:transparent;font:inherit;text-align:left;color:var(--side-fg)">
        <span class="ic">⏻</span>Sign out</button>
    </form>
  </aside>
  <div class="main">
    <div class="topbar">
      <div class="crumb">${crumb ?? html`<b>${title}</b>`}</div>
      <div class="spacer"></div>
      ${termLabel ? html`<div class="termsel"><span class="dot"></span>${termLabel}</div>` : ""}
      ${topbarExtra ?? ""}
    </div>
    <div class="content"${wide ? html` style="max-width:1460px"` : ""}>${body}</div>
  </div>
</div>`.__html}</body></html>`;
}

/** Full-bleed page with no app shell — sign in, password change. */
export function bare(title: string, body: Html): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · LeMSIC Points</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="/app.css">
</head><body>${body.__html}</body></html>`;
}

export { html, raw };
