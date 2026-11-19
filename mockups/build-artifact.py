#!/usr/bin/env python3
"""Build both things derived from mockups/prototype.html.

  mockups/preview.html  the published Artifact. The host wraps every Artifact in
                        its own <!doctype>/<html>/<head>/<body>, so this copy
                        carries only the page content.
  public/app.css        the real application's stylesheet: the prototype's CSS
                        minus the bits that only drive the click-through demo.

prototype.html is the single source. Edit it, run this, and the published
preview and the running app pick up the same change.
"""
import pathlib
import re

here = pathlib.Path(__file__).resolve().parent
root = here.parent
src = (here / "prototype.html").read_text()

# --- the Artifact -----------------------------------------------------------
out = src
for tag in ['<meta charset="utf-8">',
            '<meta name="viewport" content="width=device-width, initial-scale=1">',
            "<!doctype html>", '<html lang="en">', "<head>", "</head>",
            "<body>", "</body>", "</html>"]:
    out = out.replace(tag + "\n", "").replace(tag, "")
out = re.sub(r"\n{3,}", "\n\n", out).strip() + "\n"
assert "<!doctype" not in out.lower() and "<body" not in out.lower()
assert "<title>" in out and "--accent" in out
(here / "preview.html").write_text(out)

# --- the app stylesheet -----------------------------------------------------
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

print(f"preview.html {len(out):,} bytes · app.css {len(css):,} bytes")
