#!/usr/bin/env python3
"""Build everything derived from the design source.

  public/app.css                the server app's stylesheet: mockups/prototype.html's
                                CSS minus the bits that only drive the click-through.
  artifact/lemsic-points.html   the published, working Artifact:
                                artifact/app.template.html with that same CSS inlined
                                (Artifacts may not load stylesheets from elsewhere).

One design source, two consumers: change the prototype's CSS, run this, and the
server app and the Artifact pick up the same change.
"""
import pathlib
import re

here = pathlib.Path(__file__).resolve().parent
root = here.parent
src = (here / "prototype.html").read_text()

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


template = (root / "artifact" / "app.template.html").read_text()
assert "/*__APP_CSS__*/" in template
page = template.replace("/*__APP_CSS__*/", css.strip())
assert "<!doctype" not in page.lower() and "<body" not in page.lower()
(root / "artifact" / "lemsic-points.html").write_text(page)
print(f"app.css {len(css):,} bytes · lemsic-points.html {len(page):,} bytes")
