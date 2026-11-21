#!/usr/bin/env python3
"""Rebuild foss.macaly.app as a self-contained static site in files/foss-clone."""
import hashlib
import html as htmllib
import os
import re
import shutil
import subprocess
import urllib.parse

REF = ".ref"
OUT = "files/foss-clone"
ASSETS = os.path.join(OUT, "assets")
IMGDIR = os.path.join(ASSETS, "img")

ROUTES = {
    "home.html": "",
    "about.html": "about",
    "adopt_all.html": "adopt/all",
    "adopt_cats.html": "adopt/cats",
    "adopt_dogs.html": "adopt/dogs",
    "adopt_other-pets.html": "adopt/other-pets",
    "adopt_process.html": "adopt/process",
    "board.html": "board",
    "contact.html": "contact",
    "faces.html": "faces",
    "give.html": "give",
    "give_five-friday.html": "give/five-friday",
    "give_legacy.html": "give/legacy",
    "give_recurring.html": "give/recurring",
    "give_supplies.html": "give/supplies",
    "impact-2025.html": "impact-2025",
    "newsletter.html": "newsletter",
    "programs_felv-fiv.html": "programs/felv-fiv",
    "programs_microchip.html": "programs/microchip",
    "programs_spay-neuter.html": "programs/spay-neuter",
    "reading-buddies.html": "reading-buddies",
    "recognitions.html": "recognitions",
    "sponsors.html": "sponsors",
    "volunteer.html": "volunteer",
}

REMOTE_IMG = re.compile(
    r'https://(?:nebula\.wsimg\.com|assets\.macaly-user-data\.dev|new-s3\.shelterluv\.com)/[^"\'\s>]+'
)

url_map = {}


def local_image(match):
    raw = match.group(0)
    url = htmllib.unescape(raw)
    if url in url_map:
        return url_map[url]
    base = os.path.basename(urllib.parse.urlparse(url).path) or "image"
    base = re.sub(r"[^A-Za-z0-9._-]", "_", base)
    name = f"{hashlib.md5(url.encode()).hexdigest()[:8]}-{base}"
    dest = os.path.join(IMGDIR, name)
    if not os.path.exists(dest):
        res = subprocess.run(
            ["curl", "-sS", "-L", "-m", "60", "-o", dest, "-w", "%{http_code}", url],
            capture_output=True, text=True,
        )
        if res.stdout.strip() != "200" or os.path.getsize(dest) < 1000:
            print("  !! image failed", res.stdout, url)
    local = "/assets/img/" + name
    url_map[url] = local
    return local


def transform(page):
    page = re.sub(r"<script\b[^>]*>.*?</script>", "", page, flags=re.S | re.I)
    page = re.sub(r"<script\b[^>]*/>", "", page, flags=re.I)
    page = re.sub(r'<link rel="modulepreload"[^>]*>', "", page)
    page = re.sub(r'<link rel="preload" as="script"[^>]*>', "", page)
    page = re.sub(r'<link rel="manifest"[^>]*>', "", page)
    page = page.replace("/assets/index-BIu1Q0pE.css", "/assets/site.css")
    page = REMOTE_IMG.sub(local_image, page)
    page = page.replace(
        "</head>", '<link rel="stylesheet" href="/assets/custom.css"/></head>'
    )
    page = page.replace(
        "</body>", '<script src="/assets/nav.js" defer></script></body>'
    )
    return page


def write_page(route, page):
    if route:
        directory = os.path.join(OUT, route)
    else:
        directory = OUT
    os.makedirs(directory, exist_ok=True)
    with open(os.path.join(directory, "index.html"), "w", encoding="utf-8") as fh:
        fh.write(page)


ADOPT_INDEX = """<!doctype html>
<html lang=\"en\"><head><meta charset=\"utf-8\"/>
<meta name=\"viewport\" content=\"width=100%\"/>
<meta http-equiv=\"refresh\" content=\"0; url=all/\"/>
<link rel=\"canonical\" href=\"all/\"/>
<title>Adoptable pets | Friends of the Stokes Shelter</title>
</head><body><p><a href=\"all/\">See all our adoptable pets</a></p></body></html>
"""


def main():
    if os.path.exists(OUT):
        shutil.rmtree(OUT)
    os.makedirs(IMGDIR, exist_ok=True)

    shutil.copyfile(os.path.join(REF, "index.css"), os.path.join(ASSETS, "site.css"))

    pages = dict(ROUTES)
    for fn in sorted(os.listdir(os.path.join(REF, "pages", "pets"))):
        if not fn.endswith(".html"):
            continue
        route = fn[:-5].lstrip("_").replace("_", "/")
        pages["pets/" + fn] = route

    for src, route in pages.items():
        path = os.path.join(REF, "pages", src)
        with open(path, encoding="utf-8", errors="replace") as fh:
            page = fh.read()
        write_page(route, transform(page))
        print((" /" + route).rstrip("/") or "/", "->", os.path.join(OUT, route, "index.html") if route else os.path.join(OUT, "index.html"))

    # /adopt has no page of its own in the reference site; send it to the list.
    write_page("adopt", ADOPT_INDEX)

    for extra in ("favicon.svg",):
        subprocess.run(
            ["curl", "-sS", "-L", "-m", "30", "-o", os.path.join(OUT, extra),
             f"https://foss.macaly.app/{extra}"], check=False,
        )

    shutil.copyfile("custom.css", os.path.join(ASSETS, "custom.css"))
    shutil.copyfile("nav.js", os.path.join(ASSETS, "nav.js"))
    print(f"\n{len(pages)} pages, {len(url_map)} images downloaded")


if __name__ == "__main__":
    main()
