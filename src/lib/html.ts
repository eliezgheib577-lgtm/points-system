/** Minimal HTML templating: escapes by default, so view code cannot inject markup by accident. */
export type Html = { __html: string };

const ESCAPES: Record<string, string> = {
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
};

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]!);
}

function render(value: unknown): string {
  if (value === null || value === undefined || value === false || value === true) return "";
  if (Array.isArray(value)) return value.map(render).join("");
  if (typeof value === "object" && value !== null && "__html" in value) {
    return (value as Html).__html;
  }
  return escapeHtml(value);
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): Html {
  let out = "";
  for (let i = 0; i < strings.length; i++) {
    out += strings[i];
    if (i < values.length) out += render(values[i]);
  }
  return { __html: out };
}

/** Only for markup you built yourself — never for user input. */
export const raw = (markup: string): Html => ({ __html: markup });
export const toString = (node: Html): string => node.__html;
