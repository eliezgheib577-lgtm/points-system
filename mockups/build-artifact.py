#!/usr/bin/env python3
"""Derive the Artifact-format page from the standalone prototype.

Artifacts are wrapped in their own <!doctype>/<html>/<head>/<body> skeleton at
publish time, so the published file must contain only the page content.
prototype.html stays a complete, openable document; preview.html is generated.
"""
import re, pathlib

src = pathlib.Path(__file__).with_name("prototype.html").read_text()
out = src
for tag in ['<meta charset="utf-8">', '<meta name="viewport" content="width=device-width, initial-scale=1">',
            "<!doctype html>", '<html lang="en">', "<head>", "</head>",
            "<body>", "</body>", "</html>"]:
    out = out.replace(tag + "\n", "").replace(tag, "")
out = re.sub(r"\n{3,}", "\n\n", out).strip() + "\n"
assert "<!doctype" not in out.lower() and "<body" not in out.lower()
assert "<title>" in out and "--accent" in out
pathlib.Path(__file__).with_name("preview.html").write_text(out)
print("preview.html written:", len(out), "bytes")
