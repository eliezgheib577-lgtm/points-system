import { html, type Html } from "../lib/html.js";

const STATUS_LOOK: Record<string, { cls: string; label: string }> = {
  draft:        { cls: "draft", label: "Draft" },
  pending:      { cls: "pend",  label: "Pending VPA" },
  under_review: { cls: "pend",  label: "Under review" },
  approved:     { cls: "ok",    label: "Approved" },
  returned:     { cls: "ret",   label: "Returned" },
};

export function statusPill(status: string): Html {
  const look = STATUS_LOOK[status] ?? { cls: "flat", label: status };
  return html`<span class="pill ${look.cls}">● ${look.label}</span>`;
}

export function note(level: "warn" | "info" | "good", body: Html | string): Html {
  const icon = level === "warn" ? "!" : level === "good" ? "✓" : "i";
  return html`<div class="note ${level}"><span class="ic">${icon}</span><span>${body}</span></div>`;
}

export function tile(label: string, value: string | number, detail?: string, hot = false): Html {
  return html`<div class="tile${hot ? " hot" : ""}">
    <div class="k">${label}</div><div class="v">${value}</div>
    ${detail ? html`<div class="d">${detail}</div>` : ""}</div>`;
}

export function initialsAvatar(name: string): Html {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  return html`<span class="ava">${initials}</span>`;
}

export function who(name: string, sub?: string | null): Html {
  return html`<div class="who">${initialsAvatar(name)}<div><b>${name}</b>
    ${sub ? html`<small>${sub}</small>` : ""}</div></div>`;
}

export function csrfField(token: string): Html {
  return html`<input type="hidden" name="_csrf" value="${token}">`;
}

export function emptyState(title: string, body: string): Html {
  return html`<div class="card"><div class="card-b" style="text-align:center;padding:42px 18px">
    <b style="font-size:15px;display:block;margin-bottom:6px">${title}</b>
    <span class="sub">${body}</span></div></div>`;
}
