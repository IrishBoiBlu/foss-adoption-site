#!/usr/bin/env python3
"""Stage files/foss-clone for GitHub Pages in .deploy.

GitHub Pages serves a project site from https://<user>.github.io/<repo>/, but
the pages link to things like /assets/site.css, which would resolve to the
domain root. This copies the site and prefixes every root-absolute link with
the repository path. On a user site (<user>.github.io) the prefix is empty.

    BASE_PATH=/my-repo/ python3 deploy_pages.py
"""
import json
import os
import re
import shutil

try:
    from PIL import Image
except ImportError:  # publishing still works without the image step
    Image = None

SRC = os.environ.get("SITE_SRC", "files/foss-clone")
OUT = os.environ.get("OUT_DIR", "").strip() or ".deploy"

# Photos copied from the shelter arrive as multi-megabyte PNGs. Shrinking them
# at publish time keeps the pages light without touching the saved copy, which
# the sync rewrites.
IMG_DIR = os.path.join(OUT, "assets", "img")
IMG_MIN_BYTES = 120_000
IMG_MAX_EDGE = 1400
IMG_QUALITY = 80

# The site is served from its own domain once that domain points here, and then
# pages must stay at the root with a CNAME file naming the domain. Left empty it
# publishes the usual https://<user>.github.io/<repo>/ address instead.
CUSTOM_DOMAIN = ""

# Hostinger runs the site from its own folder, so the pages live at the root of
# the domain and no CNAME file is involved. Only the public address changes.
PUBLIC_DOMAIN = os.environ.get("PUBLIC_DOMAIN", "").strip()

# Default to the repository name when running inside GitHub Actions.
base = os.environ.get("BASE_PATH", "").strip()
if not base and (CUSTOM_DOMAIN or PUBLIC_DOMAIN):
    base = "/"
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


def optimise_images():
    """Downscale and re-compress big photos, returning old path -> new path."""
    mapping = {}
    for root, _dirs, files in os.walk(IMG_DIR):
        for name in files:
            path = os.path.join(root, name)
            stem, ext = os.path.splitext(name)
            # Some photos are saved without an extension, which also leaves
            # GitHub guessing at the content type.
            if ext.lower() not in (".png", ".jpg", ".jpeg", ""):
                continue
            if os.path.getsize(path) < IMG_MIN_BYTES:
                continue
            try:
                with Image.open(path) as im:
                    im.thumbnail((IMG_MAX_EDGE, IMG_MAX_EDGE), Image.LANCZOS)
                    keep_alpha = False
                    if im.mode in ("RGBA", "LA", "P") or "transparency" in im.info:
                        # Shelter photos often carry an alpha channel that is
                        # fully opaque; only real cut-outs need it kept.
                        alpha = im.convert("RGBA").getchannel("A")
                        keep_alpha = alpha.getextrema()[0] < 255
                    if keep_alpha:
                        # A logo or cut-out graphic keeps its transparency and
                        # only loses pixels, not its background.
                        target = os.path.join(root, stem + ".png")
                        im.convert("RGBA").save(target, "PNG", optimize=True)
                    else:
                        target = os.path.join(root, stem + ".jpg")
                        im.convert("RGB").save(
                            target, "JPEG", quality=IMG_QUALITY, optimize=True, progressive=True
                        )
            except Exception as exc:  # a broken photo must not stop the publish
                print(f"Skipped {path}: {exc}")
                continue
            if target != path:
                os.remove(path)
            rel = os.path.relpath(path, OUT).replace(os.sep, "/")
            new_rel = os.path.relpath(target, OUT).replace(os.sep, "/")
            mapping["/" + rel] = "/" + new_rel
    return mapping


def rewrite_refs(text, mapping):
    for old, new in mapping.items():
        text = text.replace(old, new)
    return text


def site_host():
    """The public address the pages are served from."""
    if CUSTOM_DOMAIN:
        return f"https://{CUSTOM_DOMAIN}"
    if PUBLIC_DOMAIN:
        return f"https://{PUBLIC_DOMAIN}"
    repo = os.environ.get("GITHUB_REPOSITORY", "").split("/")
    if len(repo) == 2 and repo[0] and repo[1]:
        # base already carries the repository path for a project site.
        return f"https://{repo[0]}.github.io"
    return ""


ORGANISATION = {
    "@context": "https://schema.org",
    "@type": "AnimalShelter",
    "name": "Friends of the Stokes Shelter",
    "description": (
        "A nonprofit animal adoption center in Walnut Cove, North Carolina. "
        "Every dog and cat in our care comes from the Stokes County Animal Shelter."
    ),
    "telephone": "+1-336-914-9270",
    "email": "friendsofstokesshelter@gmail.com",
    "address": {
        "@type": "PostalAddress",
        "streetAddress": "1111 Dodgetown Rd.",
        "addressLocality": "Walnut Cove",
        "addressRegion": "NC",
        "postalCode": "27052",
        "addressCountry": "US",
    },
    "sameAs": [
        "https://www.facebook.com/394299134011222",
        "https://www.instagram.com/fossfriends",
        "https://www.tiktok.com/@fossfriends",
    ],
}


def page_url(rel_path):
    """Public address of a staged page, keeping the usual directory style."""
    host = site_host()
    route = rel_path.replace("index.html", "").replace(os.sep, "/")
    return f"{host}{base}{route}" if host else f"{base}{route}"


def describe_pages(pages):
    """Add a canonical link and schema.org details so search and AI tools can
    read what the shelter is, where it is and how to reach it."""
    host = site_host()
    data = dict(ORGANISATION)
    data["url"] = f"{host}{base}" if host else base
    logo = "header-logo.png"
    if not os.path.exists(os.path.join(IMG_DIR, logo)):
        logo = "header-logo.jpg"
    data["logo"] = f"{host}{base}assets/img/{logo}" if host else ""
    block = '<script type="application/ld+json">' + json.dumps(data, indent=None) + "</script>"
    for page in pages:
        path = os.path.join(OUT, page)
        text = open(path, encoding="utf-8").read()
        if "application/ld+json" not in text:
            url = page_url(page)
            canonical = f'<link rel="canonical" href="{url}"/>' if url else ""
            text = text.replace("</head>", canonical + block + "</head>", 1)
            open(path, "w", encoding="utf-8").write(text)


def write_discovery_files(pages):
    """robots.txt and sitemap.xml: the two files crawlers and AI tools look for
    first and neither of which the site had."""
    host = site_host()
    with open(os.path.join(OUT, "robots.txt"), "w", encoding="utf-8") as fh:
        fh.write("User-agent: *\nAllow: /\n")
        if host:
            fh.write(f"\nSitemap: {host}{base}sitemap.xml\n")

    entries = []
    for page in sorted(pages):
        url = page_url(page)
        if url:
            entries.append(f"  <url><loc>{url}</loc></url>")
    with open(os.path.join(OUT, "sitemap.xml"), "w", encoding="utf-8") as fh:
        fh.write('<?xml version="1.0" encoding="UTF-8"?>\n')
        fh.write('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n')
        fh.write("\n".join(entries))
        fh.write("\n</urlset>\n")


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

    pages = []
    for root, _dirs, files in os.walk(OUT):
        if "index.html" in files:
            pages.append(os.path.relpath(os.path.join(root, "index.html"), OUT))

    mapping = optimise_images() if Image else {}
    if mapping:
        for page in pages:
            path = os.path.join(OUT, page)
            text = open(path, encoding="utf-8").read()
            new = rewrite_refs(text, mapping)
            if new != text:
                open(path, "w", encoding="utf-8").write(new)
        for root, _dirs, files in os.walk(OUT):
            for name in files:
                if not name.endswith(".js"):
                    continue
                path = os.path.join(root, name)
                text = open(path, encoding="utf-8").read()
                new = rewrite_refs(text, mapping)
                if new != text:
                    open(path, "w", encoding="utf-8").write(new)

    describe_pages(pages)
    write_discovery_files(pages)

    if CUSTOM_DOMAIN:
        open(os.path.join(OUT, "CNAME"), "w", encoding="utf-8").write(CUSTOM_DOMAIN + "\n")
    print(
        f"Staged {OUT} with base path {base} ({changed} files rewritten, "
        f"{len(mapping)} images compressed, {len(pages)} pages described)"
    )


if __name__ == "__main__":
    main()
