#!/usr/bin/env python3
"""Pull live pet data from ShelterLuv into the static site in files/foss-clone.

Run after build.py (build.py regenerates the reference copy of the site; this
script then replaces the pet listings and pet pages with live ShelterLuv data).

    python3 sync.py

Nothing but the standard library is needed, and no API key: ShelterLuv publishes
the shelter's adoptable animals through its public listings feed.
"""
import html
import json
import os
import re
import shutil
import sys
import time
import urllib.parse
import urllib.request
from datetime import date

SHELTER_ID = "27932"  # Friends of the Stokes Shelter on ShelterLuv
FEED = f"https://new.shelterluv.com/api/v3/available-animals/{SHELTER_ID}"
EMBED = "https://new.shelterluv.com/embed/animal/{}"
PUBLIC_URL = "https://www.shelterluv.com/embed/animal/{}"

SITE = "files/foss-clone"
PET_IMGDIR = os.path.join(SITE, "assets", "img", "pets")
URL_PREFIX = "/assets/img/pets/"
MAX_PHOTOS = 12
UA = "Mozilla/5.0 (compatible; FOSS-site-sync/1.0)"

SPECIES = {
    "Dog": {"route": "dogs", "one": "dog", "many": "dogs", "plural": "Dogs", "filter": "Dog"},
    "Cat": {"route": "cats", "one": "cat", "many": "cats", "plural": "Cats", "filter": "Cat"},
}
OTHER = {"route": "other-pets", "one": "animal", "many": "animals",
         "plural": "Other pets", "filter": "Other"}

ARROW = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" '
         'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" '
         'class="h-4 w-4"><path d="M4 12h15"></path><path d="m13.5 6.5 6 5.5-6 5.5"></path></svg>')

TEL = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" '
       'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" '
       'class="h-4 w-4"><path d="M6.2 3.6h2.5l1.5 3.7-1.9 1.3a11.6 11.6 0 0 0 5.2 5.2l1.3-1.9 '
       '3.7 1.5v2.5c0 1.4-1.1 2.5-2.5 2.5A13.6 13.6 0 0 1 3.7 6.1c0-1.4 1.1-2.5 2.5-2.5Z"></path></svg>')


# ---------------------------------------------------------------- fetching

def get(url, tries=3):
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": UA, "Accept": "application/json,*/*"})
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.read().decode("utf-8", "replace")
        except Exception as exc:  # network hiccup - retry before giving up
            last = exc
            time.sleep(1.5 * (attempt + 1))
    raise SystemExit(f"Could not reach {url}: {last}")


def fix_slashes(value):
    """ShelterLuv double-escapes URLs in its embedded JSON."""
    if isinstance(value, str):
        return value.replace("\\/", "/")
    if isinstance(value, list):
        return [fix_slashes(v) for v in value]
    if isinstance(value, dict):
        return {k: fix_slashes(v) for k, v in value.items()}
    return value


def animal_details(uid):
    """Weight + write-up live only on the public embed page."""
    try:
        raw = get(EMBED.format(uid))
        match = re.search(r':animal="([^"]*)"', raw)
        if not match:
            return {}
        blob = match.group(1).replace("\\\\/", "/").replace("\\/", "/")
        return fix_slashes(json.loads(html.unescape(blob)))
    except Exception as exc:
        print(f"  .. no detail for {uid} ({exc})")
        return {}


def clean_description(raw):
    if not raw:
        return ""
    text = raw.replace("\\\\/", "/").replace("\\/", "/")
    text = html.unescape(text)                 # &lt;br /&gt; -> <br />
    text = re.sub(r"(?i)<\s*br\s*/?\s*>", "\n\n", text)
    text = re.sub(r"(?i)</?\s*p\s*>", "\n\n", text)
    text = re.sub(r"(?i)<\s*li\s*>", "\n• ", text)
    text = re.sub(r"<[^>]*>", " ", text)
    text = html.unescape(text)                 # &#039; -> '
    text = text.replace("\xa0", " ").replace("&nbsp;", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


# ---------------------------------------------------------------- photos

def gallery(animal):
    """Cover photo first, then the rest in the shelter's own order."""
    photos = animal.get("photos") or []
    cover = [p for p in photos if p.get("isCover")]
    rest = sorted([p for p in photos if not p.get("isCover")],
                  key=lambda p: p.get("order_column") or 0)
    ordered = cover + rest
    return ordered[:MAX_PHOTOS]


def local_photo(uid, index, url):
    ext = os.path.splitext(urllib.parse.urlparse(url).path)[1].lower()
    if ext not in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
        ext = ".jpg"
    name = f"{uid}-{index}{ext}"
    dest = os.path.join(PET_IMGDIR, name)
    if not os.path.exists(dest) or os.path.getsize(dest) < 1000:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=90) as resp, open(dest, "wb") as fh:
                shutil.copyfileobj(resp, fh)
        except Exception as exc:
            print(f"  !! photo failed {url} ({exc})")
            if os.path.exists(dest):
                os.remove(dest)
            return None
    return URL_PREFIX + name


# ---------------------------------------------------------------- html bits

def esc(value):
    return html.escape(str(value or ""), quote=True)


def species_of(animal):
    return SPECIES.get(animal.get("species"), OTHER)


def build_pet(animal):
    uid = animal.get("uniqueId") or ""
    details = animal_details(uid)
    meta = species_of(animal)
    breed = (animal.get("breed") or "").strip()
    secondary = (animal.get("secondary_breed") or "").strip()
    if secondary and secondary.lower() not in breed.lower():
        breed = f"{breed} / {secondary}" if breed else secondary
    if not breed:
        breed = "Mixed breed"

    weight = details.get("weight")
    units = (details.get("weight_units") or "lbs").strip()
    weight_text = f"{weight:g} {units}" if isinstance(weight, (int, float)) else (str(weight or "").strip())

    photos = []
    for i, photo in enumerate(gallery(animal)):
        local = local_photo(uid, i, fix_slashes(photo.get("url", "")))
        if local:
            photos.append(local)

    return {
        "uid": uid,
        "name": animal.get("name") or "Unnamed",
        "species": animal.get("species") or "",
        "one": meta["one"],
        "many": meta["many"],
        "route": meta["route"],
        "plural": meta["plural"],
        "filter": meta["filter"],
        "breed": breed,
        "age": ((animal.get("age_group") or {}).get("name") or "").strip() or "Age unknown",
        "sex": (animal.get("sex") or "").strip() or "Unknown",
        "weight": weight_text,
        "location": (animal.get("location") or "").strip(),
        "description": clean_description(details.get("kennel_description") or details.get("description")),
        "photos": photos,
        "href": f"/adopt/{meta['route']}/{uid}",
        "apply": PUBLIC_URL.format(uid),
        "order": animal.get("intake_date") or 0,
    }


def card_html(pet):
    cover = pet["photos"][0] if pet["photos"] else ""
    image = (
        f'<div class="relative aspect-[4/5] overflow-hidden rounded-2xl bg-sand">'
        f'<img src="{esc(cover)}" alt="{esc(pet["name"])}, an adoptable {esc(pet["one"])} at '
        f'Friends of the Stokes Shelter" loading="lazy" class="h-full w-full object-cover '
        f'transition duration-700 group-hover:scale-[1.04]"/></div>'
    ) if cover else '<div class="relative aspect-[4/5] overflow-hidden rounded-2xl bg-sand"></div>'
    facts = " · ".join(x for x in (pet["breed"], pet["age"], pet["sex"]) if x)
    return (
        f'<article class="group" data-testid="pet-card-{esc(pet["uid"])}">'
        f'<a class="block rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-4 '
        f'focus-visible:outline-coral" href="{esc(pet["href"])}">{image}'
        f'<h2 class="mt-4 font-display text-2xl leading-snug">{esc(pet["name"])}</h2>'
        f'<p class="mt-1 text-xs uppercase tracking-[0.16em] text-ink-soft">{esc(facts)}</p>'
        f'<span class="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-coral-deep '
        f'transition group-hover:text-ink">Meet {esc(pet["name"])}{ARROW}</span></a></article>'
    )


CARD_GRID = ('<div class="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">'
             '{}</div>')
EMPTY_GRID = ('<p class="rounded-2xl border border-ink/10 bg-cream px-6 py-10 text-center '
              'text-sm text-ink-soft">No {} are listed right now. Check back soon.</p>')


def grid_html(pets, many):
    if not pets:
        return EMPTY_GRID.format(esc(many))
    return CARD_GRID.format("".join(card_html(p) for p in pets))


def detail_html(pet):
    name = esc(pet["name"])
    one = esc(pet["one"])
    facts = [
        ("Breed", pet["breed"]),
        ("Age", pet["age"]),
        ("Sex", pet["sex"]),
        ("Weight", pet["weight"]),
        ("Location", pet["location"]),
    ]
    cells = "".join(
        f'<div class="bg-cream px-4 py-4"><dt class="text-[0.62rem] font-semibold uppercase '
        f'tracking-[0.2em] text-ink-soft">{esc(label)}</dt>'
        f'<dd class="mt-1.5 text-[0.95rem] font-medium leading-snug text-ink">{esc(value)}</dd></div>'
        for label, value in facts if value
    )

    if pet["description"]:
        story = (f'<p class="mt-7 max-w-xl whitespace-pre-line text-[1.02rem] leading-relaxed '
                 f'text-ink-soft">{esc(pet["description"])}</p>')
    else:
        story = (
            f'<p class="mt-7 max-w-xl text-[1.02rem] leading-relaxed text-ink-soft">{name} does not '
            f'have a write-up on the site yet. The full ShelterLuv profile has the latest notes from '
            f'our team, or call 336-914-9270 and we will tell you all about {name}.</p>'
        )

    if pet["photos"]:
        cover = pet["photos"][0]
        photo_block = (f'<div class="overflow-hidden rounded-3xl bg-sand" data-testid="pet-detail-photo">'
                       f'<img src="{esc(cover)}" alt="{name}, an adoptable {one} at Friends of the Stokes '
                       f'Shelter" class="aspect-[4/5] h-full w-full object-cover"/></div>')
    else:
        photo_block = ('<div class="aspect-[4/5] overflow-hidden rounded-3xl bg-sand" '
                       'data-testid="pet-detail-photo"></div>')

    if len(pet["photos"]) > 1:
        gallery_section = (
            f'<section class="border-t border-ink/10 py-14" data-testid="pet-photo-gallery">'
            f'<div class="mx-auto max-w-6xl px-5 sm:px-8">'
            f'<h2 class="font-display text-2xl leading-snug sm:text-3xl">More photos of {name}</h2>'
            f'<p class="mt-3 max-w-2xl text-sm leading-relaxed text-ink-soft">Every photo comes from '
            f'{name}’s ShelterLuv record, so what you see here is what our team sees.</p>'
            f'<div class="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">'
            + "".join(
                f'<img src="{esc(src)}" alt="{name}, photo {i}" loading="lazy" '
                f'class="aspect-square w-full rounded-xl bg-sand object-cover"/>'
                for i, src in enumerate(pet["photos"], start=1))
            + '</div></div></section>'
        )
    else:
        gallery_section = ""

    return f"""<main>
<section class="border-b border-ink/10 bg-sand/40"><div class="mx-auto max-w-6xl px-5 pb-12 pt-10 sm:px-8 sm:pb-16 sm:pt-14">
<nav aria-label="Breadcrumb" class="text-xs text-ink-soft"><ol class="flex flex-wrap items-center gap-2"><li><a class="transition hover:text-coral-deep" href="/">Home</a></li><li aria-hidden="true">/</li><li><a class="transition hover:text-coral-deep" href="/adopt/all">Adopt</a></li><li aria-hidden="true">/</li><li><a class="transition hover:text-coral-deep" href="/adopt/{esc(pet['route'])}">{esc(pet['plural'])}</a></li><li aria-hidden="true">/</li><li aria-current="page" class="font-semibold text-ink">{name}</li></ol></nav>
<div class="mt-8 grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start lg:gap-14">{photo_block}
<div data-testid="pet-detail" data-state="ready" data-pet-id="{esc(pet['uid'])}">
<p class="flex items-center gap-2.5 text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-ink-soft"><span class="h-px w-7 bg-coral" aria-hidden="true"></span>Adoptable {one}</p>
<h1 class="mt-4 font-display text-[clamp(2.4rem,5vw,3.8rem)] leading-[1.02] tracking-[-0.02em]">{name}</h1>
<dl class="mt-8 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-ink/10 bg-ink/10 sm:grid-cols-3">{cells}</dl>
{story}
<div class="mt-8 flex flex-wrap items-center gap-3"><a href="{esc(pet['apply'])}" target="_blank" rel="noreferrer noopener" class="inline-flex items-center gap-2 rounded-full bg-ink px-6 py-3 text-[0.78rem] font-semibold uppercase tracking-[0.12em] text-cream transition hover:bg-coral focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">Apply for adoption<span class="sr-only">(opens the full ShelterLuv profile in a new tab)</span>{ARROW}</a><a href="tel:+13369149270" class="inline-flex items-center gap-2 rounded-full border border-ink/20 px-6 py-3 text-[0.78rem] font-semibold uppercase tracking-[0.12em] text-ink transition hover:border-ink hover:bg-cream">{TEL}Book a visit</a></div>
<p class="mt-5 text-xs text-ink-soft">Reference {esc(pet['uid'])} when you call, and it helps to bring the whole household, including any dogs who already live with you.</p>
<div class="mt-9 rounded-2xl border border-ink/10 bg-sand/40 p-5"><p class="text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-ink-soft">Visiting hours</p><p class="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-ink"><span>Adoption visits: Tue–Fri 10–6 · Sat 10–2</span><span>1111 Dodgetown Rd, Walnut Cove, NC 27052</span></p></div>
<div class="mt-8"><a class="inline-flex items-center gap-2 text-sm font-semibold text-coral-deep underline decoration-coral/40 underline-offset-4 transition hover:text-ink" href="/adopt/{esc(pet['route'])}">All adoptable {esc(pet['many'])}{ARROW}</a></div>
</div></div></div></section>
{gallery_section}
<section class="py-14"><div class="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-5 sm:px-8 lg:flex-row lg:items-center"><div><h2 class="font-display text-2xl leading-snug sm:text-3xl">Not quite the right match?</h2><p class="mt-2 max-w-md text-sm leading-relaxed text-ink-soft">Our list changes as pets arrive and head home, and it updates on its own.</p></div><div class="flex flex-wrap items-center gap-3"><a class="inline-flex items-center gap-2 rounded-full border border-ink/20 bg-cream px-6 py-3 text-[0.78rem] font-semibold uppercase tracking-[0.12em] text-ink transition hover:border-coral hover:bg-coral hover:text-white" href="/adopt/process">How adoption works</a><a class="inline-flex items-center gap-2 text-sm font-semibold text-coral-deep underline decoration-coral/40 underline-offset-4 transition hover:text-ink" href="/contact">Ask us a question{ARROW}</a></div></div></section>
</main>"""


# ---------------------------------------------------------------- editing

def replace_inner(page, opener, inner, start=0):
    i = page.find(opener, start)
    if i < 0:
        return page, False
    body_start = i + len(opener)
    depth = 1
    tag_re = re.compile(r"<div\b|</div>")
    pos = body_start
    while True:
        match = tag_re.search(page, pos)
        if not match:
            return page, False
        if match.group(0) == "</div>":
            depth -= 1
            if depth == 0:
                return page[:body_start] + inner + page[match.start():], True
        else:
            depth += 1
        pos = match.end()


def replace_grid(page, anchor, inner):
    """Replace the contents of the <div> carrying `anchor`."""
    i = page.find(anchor)
    if i < 0:
        return page, False
    open_at = page.rfind("<div", 0, i)
    close = page.find(">", open_at)
    return replace_inner(page, page[open_at:close + 1], inner, start=open_at)


CHIP = re.compile(
    r"(>)(\d+)(<!-- --> <!-- -->)([^<]+)(<!-- --> in our care · updated<!-- --> <!-- -->)([^<]+)(<)")


def update_chip(page, count, updated):
    def repl(match):
        return (match.group(1) + str(count) + match.group(3) + match.group(4)
                + match.group(5) + updated + match.group(7))
    return CHIP.sub(repl, page, count=1)


def update_filter_count(page, key, count):
    pattern = re.compile(
        r'(data-testid="pet-filter-' + key + r'"[^>]*>.*?<span class="rounded-full[^"]*">)\d+(</span>)',
        re.S)
    return pattern.sub(lambda m: m.group(1) + str(count) + m.group(2), page, count=1)


def set_pet_count_attr(page, anchor, count):
    pattern = re.compile(r'(data-testid="' + anchor + r'"[^>]*?data-pet-count=")\d+(")')
    return pattern.sub(lambda m: m.group(1) + str(count) + m.group(2), page, count=1)


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def write(path, text):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


def page_path(route):
    return os.path.join(SITE, route, "index.html")


def listing_page(route):
    path = page_path(route)
    return read(path) if os.path.exists(path) else None


# ---------------------------------------------------------------- main

def main():
    if not os.path.isdir(SITE):
        raise SystemExit(f"{SITE} is missing - run build.py first")

    os.makedirs(PET_IMGDIR, exist_ok=True)

    print(f"Fetching ShelterLuv feed for shelter {SHELTER_ID} ...")
    feed = json.loads(fix_slashes(get(FEED)))
    animals = [a for a in feed.get("animals") or [] if a.get("adoptable")]

    pets = []
    for animal in animals:
        pet = build_pet(animal)
        if not pet["uid"]:
            continue
        pets.append(pet)
        print(f"  {pet['species']:<4} {pet['uid']:<16} {pet['name']}")
        time.sleep(0.15)

    by_species = {}
    for pet in pets:
        by_species.setdefault(pet["route"], []).append(pet)

    updated = date.today().strftime("%B %-d, %Y")
    used_photos = set()

    # ---- per-species listing pages + detail pages
    for route, meta in ((v["route"], v) for v in list(SPECIES.values()) + [OTHER]):
        group = by_species.get(route, [])
        used_photos.update(os.path.basename(p[len(URL_PREFIX):])
                           for pet in group for p in pet["photos"])

        page = listing_page(f"adopt/{route}")
        if page is None:
            print(f"  !! no /adopt/{route} page to update")
            continue

        updated_page = page
        if route == "other-pets":
            if group:
                # The shipped page carries an empty state; swap in real cards.
                start = updated_page.find('<section class="py-16 sm:py-20 bg-cream text-ink ">')
                end = updated_page.find("</main>")
                if start > -1 and end > start:
                    section = (
                        '<section class="py-16 sm:py-20" data-testid="adoptable-listings" '
                        f'data-state="ready" data-pet-count="{len(group)}">'
                        '<div class="mx-auto max-w-6xl px-5 sm:px-8">'
                        f'{grid_html(group, meta["many"])}</div></section>')
                    updated_page = updated_page[:start] + section + updated_page[end:]
        else:
            updated_page, ok = replace_grid(
                updated_page, 'data-testid="adoptable-grid"', grid_html(group, meta["many"]))
            if not ok:
                print(f"  !! grid not found on /adopt/{route}")
            updated_page = set_pet_count_attr(updated_page, "adoptable-listings", len(group))
            updated_page = update_chip(updated_page, len(group), updated)

        if updated_page != page:
            write(page_path(f"adopt/{route}"), updated_page)
            print(f"  /adopt/{route}: {len(group)} {meta['many']}")

        # ---- detail pages
        top = updated_page[:re.search(r"<main\b", updated_page).start()]
        bottom = updated_page[re.search(r"</main>", updated_page).end():]
        keep = set()
        for pet in group:
            keep.add(pet["uid"])
            title = f"{pet['name']}, adoptable {pet['one']} | Friends of the Stokes Shelter"
            desc = (f"Meet {pet['name']}, an adoptable {pet['one']} at Friends of the Stokes "
                    f"Shelter in Walnut Cove, North Carolina. See photos, breed, age and sex, "
                    f"then book a visit.")
            head = re.sub(r"\s*<link rel=\"preload\" as=\"image\"[^>]*>", "", top)
            head = re.sub(r"<title>.*?</title>", f"<title>{esc(title)}</title>", head, count=1, flags=re.S)
            if re.search(r'<meta name="description"', head):
                head = re.sub(r'<meta name="description" content="[^"]*"/>',
                              f'<meta name="description" content="{esc(desc)}"/>', head, count=1)
            else:
                head = head.replace("</head>", f'<meta name="description" content="{esc(desc)}"/></head>')
            if pet["photos"]:
                head = head.replace(
                    "</head>", f'<link rel="preload" as="image" href="{esc(pet["photos"][0])}"/></head>')
            write(page_path(f'adopt/{route}/{pet["uid"]}'),
                  head + detail_html(pet) + bottom)

        # drop pages for pets who have left
        directory = os.path.join(SITE, "adopt", route)
        for entry in sorted(os.listdir(directory)):
            full = os.path.join(directory, entry)
            if os.path.isdir(full) and entry not in keep:
                shutil.rmtree(full)
                print(f"  removed /adopt/{route}/{entry} (no longer listed)")

    # ---- the "all pets" page
    page = listing_page("adopt/all")
    if page:
        by_filter = {
            "all": len(pets),
            "Dog": len(by_species.get("dogs", [])),
            "Cat": len(by_species.get("cats", [])),
            "Other": len(by_species.get("other-pets", [])),
        }
        ordered = (by_species.get("dogs", []) + by_species.get("cats", [])
                   + by_species.get("other-pets", []))
        updated_page = page
        updated_page = set_pet_count_attr(updated_page, "all-pets", len(pets))
        updated_page, ok = replace_grid(updated_page, 'data-testid="all-pets"', grid_html(ordered, "pets"))
        if not ok:
            print("  !! grid not found on /adopt/all")
        for key, count in by_filter.items():
            updated_page = update_filter_count(updated_page, key, count)
        updated_page = update_chip(updated_page, len(pets), updated)
        if updated_page != page:
            write(page_path("adopt/all"), updated_page)
            print(f"  /adopt/all: {len(pets)} pets")

    # ---- drop photos of pets who have left
    for entry in sorted(os.listdir(PET_IMGDIR)):
        if entry not in used_photos:
            os.remove(os.path.join(PET_IMGDIR, entry))
            print(f"  removed photo {entry}")

    print(f"\nSynced {len(pets)} pets on {updated}: "
          f"{len(by_species.get('dogs', []))} dogs, "
          f"{len(by_species.get('cats', []))} cats, "
          f"{len(by_species.get('other-pets', []))} other.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
