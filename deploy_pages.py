#!/usr/bin/env python3
"""Stage files/foss-clone for GitHub Pages in .deploy.

GitHub Pages serves a project site from https://<user>.github.io/<repo>/, but
the pages link to things like /assets/site.css, which would resolve to the
domain root. This copies the site and prefixes every root-absolute link with
the repository path. On a user site (<user>.github.io) the prefix is empty.

    BASE_PATH=/my-repo/ python3 deploy_pages.py
"""
import os
import re
import shutil

SRC = "files/foss-clone"
OUT = ".deploy"

# Default to the repository name when running inside GitHub Actions.
base = os.environ.get("BASE_PATH", "").strip()
if not base and os.environ.get("GITHUB_REPOSITORY"):
    repo = os.environ["GITHUB_REPOSITORY"].split("/")[-1]
    base = "/" if repo.lower().endswith(".github.io") else f"/{repo}/"
base = "/" + base.strip("/") + "/" if base.strip("/") else "/"

HTML_ATTR = re.compile(r'(?<=[\s"\'])(href|src|action)="/')


def fix_html(text):
    if base == "/":
        return text
    prefix = base.rstrip("/")
    return HTML_ATTR.sub(lambda m: f'{m.group(1)}="{prefix}/', text)


def fix_js(text):
    if base == "/":
        return text
    prefix = base.rstrip("/")
    # A path added to another site's address (the staff area's config) belongs
    # to that site, so it must keep its own root path.
    held = '\x00ADMIN_ORIGIN + "\x00'
    text = text.replace('ADMIN_ORIGIN + "', held)
    text = re.sub(r'"/(?=[A-Za-z#?])', f'"{prefix}/', text)
    text = re.sub(r'"/(?=")', f'"{prefix}/', text)
    return text.replace(held, 'ADMIN_ORIGIN + "')


def main():
    if not os.path.isdir(SRC):
        raise SystemExit(f"{SRC} is missing - run refresh.sh first")
    if os.path.exists(OUT):
        shutil.rmtree(OUT)
    shutil.copytree(SRC, OUT)

    changed = 0
    for root, _dirs, files in os.walk(OUT):
        for name in files:
            path = os.path.join(root, name)
            if name.endswith(".html"):
                text = open(path, encoding="utf-8").read()
                new = fix_html(text)
            elif name.endswith(".js"):
                text = open(path, encoding="utf-8").read()
                new = fix_js(text)
            else:
                continue
            if new != text:
                open(path, "w", encoding="utf-8").write(new)
                changed += 1

    open(os.path.join(OUT, ".nojekyll"), "w").close()
    print(f"Staged {OUT} with base path {base} ({changed} files rewritten)")


if __name__ == "__main__":
    main()
