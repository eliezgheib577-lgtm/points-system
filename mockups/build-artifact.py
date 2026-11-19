#!/usr/bin/env python3
"""Build everything derived from the design and the app template.

  public/app.css               the server build's stylesheet: mockups/prototype.html's
                               CSS minus the bits that only drive the click-through.
  artifact/lemsic-points.html  the claude.ai test build (no document skeleton: the
                               Artifact host wraps the page in its own).
  docs/index.html              the GitHub Pages build: a complete page that reads its
                               Firebase and Microsoft settings from docs/site-settings.js.

All three share one design source and one app source (artifact/app.template.html),
so a change made once reaches every build.
"""
import json
import pathlib
import re

here = pathlib.Path(__file__).resolve().parent
root = here.parent
src = (here / "prototype.html").read_text()

# --- the design system ------------------------------------------------------
css = re.search(r"<style>(.*?)</style>", src, re.S).group(1)
css = css.replace(".screen{display:none}\n", "").replace(".screen.active{display:block}\n", "")
start = css.find("/* ---------- prototype chrome ---------- */")
end = css.find("/* ---------- misc ---------- */")
assert 0 <= start < end, "prototype chrome markers moved"
css = css[:start] + css[end:]
assert ".navbar" not in css and ".sheet-inner" not in css
header = ("/* LeMSIC Points design system — GENERATED, do not edit by hand.\n"
          "   Source: mockups/prototype.html. Rebuild: python3 mockups/build-artifact.py */\n")
(root / "public" / "app.css").write_text(header + css.strip() + "\n")

# --- the app ----------------------------------------------------------------
template = (root / "artifact" / "app.template.html").read_text()
assert "/*__APP_CSS__*/" in template
seed = json.loads((root / "artifact" / "live-seed.json").read_text())
seed_tag = ('<script type="application/json" id="lemsic-seed">'
            + json.dumps({"docs": seed["docs"]}, ensure_ascii=False).replace("</", "<\\/")
            + "</script>\n")
page = template.replace("/*__APP_CSS__*/", css.strip())
head_part, body_part = page.split('<div id="app">', 1)
body_part = '<div id="app">' + body_part
app_div, app_script = body_part.split("\n<script>", 1)
app_script = "<script>" + app_script

# claude.ai build: content only — the host adds the document skeleton.
artifact = head_part + app_div + "\n" + seed_tag + app_script
assert "<!doctype" not in artifact.lower() and "<body" not in artifact.lower()
(root / "artifact" / "lemsic-points.html").write_text(artifact)

# GitHub Pages build: a complete document, Firebase settings loaded from a file.
site_head = head_part.replace('<meta name="claude:viewport-fit-sides" content="cover">\n', "")
site = ("<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n"
        + site_head.strip() + "\n</head>\n<body>\n" + app_div.strip() + "\n" + seed_tag
        + '<script src="site-settings.js"></script>\n' + app_script.strip() + "\n</body>\n</html>\n")
docs = root / "docs"
docs.mkdir(exist_ok=True)
(docs / "index.html").write_text(site)
(docs / ".nojekyll").write_text("")
# Microsoft's sign-in pop-up returns here; the page that opened it reads the result.
(docs / "ms-redirect.html").write_text(
    "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\"><title>Signing in…</title></head>\n"
    "<body style=\"font:14px system-ui,sans-serif;color:#6b807a;display:grid;place-items:center;min-height:90vh\">Signing in…</body></html>\n")
config = docs / "site-settings.js"
if not config.exists():  # never overwrite real settings once they are in
    config.write_text(
        "// Settings for the GitHub Pages build. Every value here is meant to be public.\n"
        "window.LEMSIC_FIREBASE = null;\n"
        "window.LEMSIC_MICROSOFT = null;\n")

print(f"app.css {len(css):,} · artifact {len(artifact):,} · docs/index.html {len(site):,} bytes")
