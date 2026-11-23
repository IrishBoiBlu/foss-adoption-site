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

# The live site's header swaps its paw placeholder for the shelter wordmark once
# React hydrates. A static copy never hydrates, so the wordmark is baked in here.
LOGO_URL = (
    "https://assets.macaly-user-data.dev/m43a1wmvbbm0ri6tminvgjyz/"
    "nwd1rmmqmdldp432j1rixfdd/ca3-VLgKY25d95WQNP_xe/generated-l0mSlZ_B.png"
)
LOGO_LOCAL = "/assets/img/header-logo.png"
HEADER_MARK = re.compile(
    r'(<a class="flex items-center gap-3[^"]*"[^>]*>).*?(</a>)', re.S
)
HEADER_LOGO = (
    '<img src="' + LOGO_LOCAL + '" alt="" aria-hidden="true" '
    'class="h-11 w-auto max-w-[9rem] shrink-0 object-contain"/>'
)


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


def ensure_logo():
    dest = os.path.join(IMGDIR, "header-logo.png")
    if os.path.exists(dest) and os.path.getsize(dest) > 1000:
        return
    res = subprocess.run(
        ["curl", "-sS", "-L", "-m", "60", "-o", dest, "-w", "%{http_code}", LOGO_URL],
        capture_output=True, text=True,
    )
    if res.stdout.strip() != "200" or os.path.getsize(dest) < 1000:
        print("  !! logo failed", res.stdout, LOGO_URL)


def transform(page):
    page = re.sub(r"<script\b[^>]*>.*?</script>", "", page, flags=re.S | re.I)
    page = re.sub(r"<script\b[^>]*/>", "", page, flags=re.I)
    page = re.sub(r'<link rel="modulepreload"[^>]*>', "", page)
    page = re.sub(r'<link rel="preload" as="script"[^>]*>', "", page)
    page = re.sub(r'<link rel="manifest"[^>]*>', "", page)
    page = page.replace("/assets/index-BIu1Q0pE.css", "/assets/site.css")
    page = REMOTE_IMG.sub(local_image, page)
    page = HEADER_MARK.sub(lambda m: m.group(1) + HEADER_LOGO + m.group(2), page, count=1)
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


# Shelter staff land on the separate staff app, which shows the sign-in page.
# Styled like the public site so it doesn't look like a stray page.
STAFF_INDEX = r'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex"/>
<title>Staff sign in | Friends of the Stokes Shelter</title>
<meta name="description" content="Staff sign in for Friends of the Stokes Shelter."/>
<link rel="icon" type="image/svg+xml" href="/favicon.svg"/>
<link rel="stylesheet" href="/assets/site.css"/>
<style>
  .staff-wrap { position: relative; overflow: hidden; isolation: isolate;
    padding: clamp(3rem, 7vw, 5.5rem) 1.25rem clamp(3.5rem, 8vw, 6rem); }
  .staff-glow { position: absolute; inset: -30% -10% auto -10%; height: 130%;
    z-index: -1; pointer-events: none;
    background:
      radial-gradient(40% 45% at 18% 22%, hsl(var(--coral) / .2), transparent 72%),
      radial-gradient(45% 55% at 82% 8%, hsl(177 42% 52% / .22), transparent 72%),
      radial-gradient(50% 60% at 50% 100%, hsl(var(--sand) / .85), transparent 75%); }
  .staff-inner { max-width: 46rem; margin: 0 auto; text-align: center; }
  .staff-kicker { margin: 0 0 1rem; font-size: .78rem; font-weight: 600;
    letter-spacing: .18em; text-transform: uppercase; color: hsl(var(--coral-deep)); }
  .staff-title { margin: 0; font-family: Fraunces, "Iowan Old Style", Georgia, serif;
    font-weight: 600; font-size: clamp(2rem, 4.4vw, 3.1rem); line-height: 1.08;
    letter-spacing: -.01em; color: hsl(var(--ink)); text-wrap: balance; }
  .staff-lede { margin: 1.15rem auto 0; max-width: 36rem; font-size: 1.02rem;
    line-height: 1.7; color: hsl(var(--ink) / .72); }
  .staff-actions { margin-top: 2rem; display: flex; flex-direction: column;
    align-items: center; gap: .9rem; }
  .staff-btn { display: inline-flex; align-items: center; gap: .6rem;
    border-radius: 999px; background: hsl(var(--coral)); color: #fff;
    padding: .95rem 1.9rem; font-size: .78rem; font-weight: 600;
    letter-spacing: .14em; text-transform: uppercase; text-decoration: none;
    box-shadow: 0 18px 35px -22px hsl(var(--coral-deep) / .9);
    transition: background-color .18s ease, transform .18s ease; }
  .staff-btn:hover { background: hsl(var(--coral-deep)); transform: translateY(-1px); }
  .staff-btn svg { width: 1rem; height: 1rem; }
  .staff-note { margin: 0; font-size: .85rem; color: hsl(var(--ink) / .55); }
  .staff-panel { margin-top: 2.75rem; padding: 1.35rem 1.5rem; text-align: left;
    display: grid; gap: .55rem; border: 1px solid hsl(var(--ink) / .1);
    border-radius: 1.25rem; background: hsl(0 0% 100% / .6); }
  .staff-panel p { margin: 0; font-size: .92rem; line-height: 1.6; color: hsl(var(--ink) / .7); }
  .staff-panel strong { color: hsl(var(--ink)); font-weight: 600; }
  .staff-foot { border-top: 1px solid hsl(var(--ink) / .1);
    padding: 1.6rem 1.25rem 2.2rem; text-align: center;
    font-size: .82rem; color: hsl(var(--ink) / .6); }
  .staff-foot a { color: hsl(var(--coral-deep)); text-decoration: none; }
  .staff-foot a:hover { text-decoration: underline; }
  .staff-form { display: grid; gap: .55rem; width: min(24rem, 100%); margin: 0 auto;
    padding: 1.5rem 1.4rem 1.6rem; text-align: left;
    border: 1px solid hsl(var(--ink) / .12); border-radius: 1.35rem;
    background: hsl(0 0% 100% / .82);
    box-shadow: 0 24px 45px -34px hsl(var(--ink) / .5); }
  .staff-form label { margin-top: .35rem; font-size: .7rem; font-weight: 600;
    letter-spacing: .14em; text-transform: uppercase; color: hsl(var(--ink) / .6); }
  .staff-form input { width: 100%; border: 1px solid hsl(var(--ink) / .18);
    border-radius: .8rem; padding: .72rem .85rem; font: inherit; font-size: .98rem;
    color: hsl(var(--ink)); background: #fff; }
  .staff-form input:focus-visible { outline: 2px solid hsl(var(--coral));
    outline-offset: 1px; border-color: transparent; }
  .staff-form .staff-btn { width: 100%; justify-content: center; margin-top: .7rem;
    border: 0; cursor: pointer; }
  .staff-form .staff-btn[disabled] { opacity: .6; cursor: progress; }
  .staff-msg { margin: .35rem 0 0; font-size: .85rem; line-height: 1.5;
    color: hsl(var(--ink) / .6); }
  .staff-msg-err { color: hsl(2 70% 40%); }
  .staff-msg-ok { color: hsl(160 45% 28%); }
  .staff-link { margin: .2rem auto 0; padding: 0; border: 0; background: none;
    cursor: pointer; font: inherit; font-size: .82rem; color: hsl(var(--coral-deep));
    text-decoration: underline; text-underline-offset: 3px; }
  .staff-open { margin: .5rem 0 0; font-size: .82rem; color: hsl(var(--ink) / .55); }
  .staff-open a { color: hsl(var(--coral-deep)); }
  .is-hidden { display: none !important; }
</style>
</head><body>
<div class="min-h-screen bg-cream font-sans text-ink">
<header class="sticky top-0 z-50 border-b border-ink/10 bg-cream/90 backdrop-blur-md"><div class="mx-auto flex h-[4.75rem] max-w-6xl items-center justify-between gap-4 px-5 sm:px-8"><a class="flex items-center gap-3 rounded-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-coral" href="/"><img src="/assets/img/header-logo.png" alt="Friends of the Stokes Shelter" class="h-11 w-auto max-w-[9rem] shrink-0 object-contain"/></a><nav aria-label="Main" class="hidden items-center gap-7 lg:flex"><a class="text-[0.78rem] font-semibold uppercase tracking-[0.14em] text-ink/80 transition hover:text-coral-deep focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-coral" href="/">Home</a><a class="text-[0.78rem] font-semibold uppercase tracking-[0.14em] text-ink/80 transition hover:text-coral-deep focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-coral" href="/adopt/all/">Adopt</a><a href="/about" class="text-[0.78rem] font-semibold uppercase tracking-[0.14em] text-ink/80 transition hover:text-coral-deep focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-coral">Our story</a><a href="/#programs" class="text-[0.78rem] font-semibold uppercase tracking-[0.14em] text-ink/80 transition hover:text-coral-deep focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-coral">Programs</a><a href="/#involved" class="text-[0.78rem] font-semibold uppercase tracking-[0.14em] text-ink/80 transition hover:text-coral-deep focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-coral">Get involved</a><a href="/#visit" class="text-[0.78rem] font-semibold uppercase tracking-[0.14em] text-ink/80 transition hover:text-coral-deep focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-coral">Visit</a></nav><div class="flex items-center gap-2"><a class="hidden items-center gap-2 rounded-full bg-coral px-5 py-2.5 text-[0.78rem] font-semibold uppercase tracking-[0.14em] text-white shadow-sm transition hover:bg-coral-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink sm:inline-flex" href="/give">Donate</a></div></div></header>
<main>
<section class="staff-wrap">
<div class="staff-glow" aria-hidden="true"></div>
<div class="staff-inner">
<p class="staff-kicker">Staff area</p>
<h1 class="staff-title">Sign in to look after the shelter site</h1>
<p class="staff-lede">The public pages are the same site visitors see. Behind this door you can change the name, logo, header and contact details, invite the rest of the team, and connect email and Cloudflare.</p>
<div class="staff-actions">
<form class="staff-form" id="staff-form" novalidate>
  <label for="staff-email">Email</label>
  <input id="staff-email" name="email" type="email" autocomplete="username" required/>
  <div id="staff-password-row">
    <label for="staff-password" id="staff-password-label">Password</label>
    <input id="staff-password" name="password" type="password" autocomplete="current-password"/>
  </div>
  <div id="staff-code-row" class="is-hidden">
    <label for="staff-code">Six-digit code from your email</label>
    <input id="staff-code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456"/>
  </div>
  <button class="staff-btn" type="submit" id="staff-submit">Sign in</button>
  <p class="staff-msg" id="staff-msg" role="status" aria-live="polite"></p>
  <button class="staff-link" type="button" id="staff-forgot">First time here, or forgot your password?</button>
</form>
<p class="staff-open">Already signed in? <a href="https://shelter-staff-admin-0xjqut.freebuff.site/">Open the staff area</a></p>
</div>
<div class="staff-panel">
<p><strong>Adoptable pets</strong> refresh on their own every 30 minutes &mdash; nothing to update by hand.</p>
<p><strong>Sign in with your email and password</strong>, then the 6-digit code we send you.</p>
<p><strong>Need access?</strong> Ask an admin to add your email address to the staff list.</p>
</div>
</div>
</section>
</main>
<footer class="staff-foot">Friends of the Stokes Shelter &middot; Questions about access? Email <a href="mailto:friendsofthestokesshelter@gmail.com">friendsofthestokesshelter@gmail.com</a></footer>
</div>
<script>
(function () {
  var APP = 'https://shelter-staff-admin-0xjqut.freebuff.site';
  var form = document.getElementById('staff-form');
  var email = document.getElementById('staff-email');
  var password = document.getElementById('staff-password');
  var passwordRow = document.getElementById('staff-password-row');
  var passwordLabel = document.getElementById('staff-password-label');
  var codeRow = document.getElementById('staff-code-row');
  var code = document.getElementById('staff-code');
  var submit = document.getElementById('staff-submit');
  var msg = document.getElementById('staff-msg');
  var forgot = document.getElementById('staff-forgot');
  var step = 'password';

  function say(text, kind) {
    msg.textContent = text || '';
    msg.className = 'staff-msg' + (kind ? ' staff-msg-' + kind : '');
  }
  function setBusy(on, label) {
    submit.disabled = on;
    if (label) submit.textContent = label;
  }
  function setStep(next) {
    step = next;
    codeRow.classList.toggle('is-hidden', next === 'password');
    passwordRow.classList.toggle('is-hidden', next === 'code');
    passwordLabel.textContent = next === 'choose' ? 'Choose a password (10+ characters)' : 'Password';
    password.setAttribute('autocomplete', next === 'choose' ? 'new-password' : 'current-password');
    submit.textContent = next === 'code' ? 'Enter code' : next === 'choose' ? 'Save password' : 'Sign in';
  }
  async function call(path, body) {
    var res = await fetch(APP + path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      var err = new Error(data.error || 'That did not work. Try again.');
      err.detail = data.detail;
      throw err;
    }
    return data;
  }
  async function finish() {
    say('Signed in. Opening the staff area…', 'ok');
    setBusy(true);
    try {
      var res = await fetch(APP + '/api/me', { credentials: 'include' });
      var me = await res.json();
      if (me && me.signedIn) {
        window.location.href = APP + '/';
        return;
      }
    } catch (e) {
      /* fall through to the plain link */
    }
    setBusy(false);
    say('This browser did not keep the sign-in. Use “Open the staff area” just below — you are already signed in there.', 'err');
  }
  function showError(err) {
    say(err.message || 'That did not work.', 'err');
    if (/code from your email/i.test(err.message || '')) setStep('choose');
  }

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    var address = email.value.trim();
    if (!address) return say('Enter your email address first.', 'err');
    setBusy(true, 'Checking…');
    try {
      if (step === 'code') {
        if (code.value.trim().length < 6) throw new Error('Enter all six digits from the email.');
        await call('/api/auth/verify', { email: address, code: code.value.trim() });
        return await finish();
      }
      if (step === 'choose') {
        if (password.value.length < 10) throw new Error('Use at least 10 characters for the password.');
        var kept = await call('/api/auth/set-password', {
          email: address,
          password: password.value,
          code: code.value.trim()
        });
        return await finish();
      }
      var data = await call('/api/auth/login', { email: address, password: password.value });
      if (data.step === 'code') {
        setStep('code');
        say('We emailed a six-digit code to ' + address + '. It works for 10 minutes.');
      } else if (data.step === 'setup') {
        setStep('choose');
        say('First time here — choose a password for your account.');
      } else {
        await finish();
      }
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
      if (step === 'code') submit.textContent = 'Enter code';
      if (step === 'choose') submit.textContent = 'Save password';
    }
  });

  forgot.addEventListener('click', async function () {
    var address = email.value.trim();
    if (!address) return say('Type your email address above, then tap this again.', 'err');
    setBusy(true, 'Sending…');
    try {
      var data = await call('/api/auth/start', { email: address });
      setStep('choose');
      if (data.sent === false) {
        say('Choose a password for your account. No code is needed until email is connected.');
      } else {
        say('Check your email for a six-digit code, then choose your new password.');
      }
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  });

  fetch(APP + '/api/auth/state', { credentials: 'include' })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (data && data.emailConnected === false && !msg.textContent) {
        say('Passwords only for now — emailed codes turn on once email is connected.');
      }
    })
    .catch(function () { /* the form still works without this note */ });
})();
</script>
</body></html>
'''


def main():
    if os.path.exists(OUT):
        shutil.rmtree(OUT)
    os.makedirs(IMGDIR, exist_ok=True)

    shutil.copyfile(os.path.join(REF, "index.css"), os.path.join(ASSETS, "site.css"))
    ensure_logo()

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

    # /staff hands people to the staff admin app's sign-in page.
    write_page("staff", STAFF_INDEX)

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
