# Publishing to Hostinger

The public site is now built for `https://foss.bluhuskyinc.com/` and pushed to
Hostinger's own folder over FTP, so it no longer depends on any DNS pointing at
GitHub. The 30-minute ShelterLuv sync publishes to both places every run.

## What runs every 30 minutes

`.github/workflows/sync.yml`:

1. Pulls the live pets from ShelterLuv.
2. Builds the site for Hostinger (`deploy_hostinger.py`) — links at the root of
   the domain, no `/foss-adoption-site/` prefix, images shrunk, `robots.txt`,
   `sitemap.xml`, canonical links and the shelter's schema.org details written in.
3. Uploads only what changed over FTP (`deploy_ftp.py`) and deletes the pages and
   photos of pets who have been adopted.
4. Also refreshes the GitHub Pages copy, and keeps an uploadable zip as a run
   artifact for 7 days.

## One-time setup in hPanel

1. **Create the subdomain.** Websites → your site → Domains → Subdomains, add
   `foss`. Note the **document root** it shows — normally `public_html/foss`.
   That folder is what `FTP_REMOTE_DIR` must point at.
2. **Create an FTP account.** Files → FTP Accounts. Username, password, and the
   host shown there (usually `ftp.bluhuskyinc.com` or the server IP). Copy all
   three; they are what the sync needs.
3. **Turn on the free SSL certificate** for the subdomain if hPanel has not
   already (Security → SSL). Once it is issued, switch on *Force HTTPS*.

Nothing else is needed: no DNS records, no parked domain, no GitHub Pages
settings.

## Give the sync the FTP details

In GitHub: repository → Settings → Secrets and variables → Actions.

Secrets (encrypted, never visible in the repo or the logs):

| Name | Value |
| --- | --- |
| `FTP_HOST` | the FTP host from hPanel |
| `FTP_USER` | the FTP username |
| `FTP_PASSWORD` | the FTP password |

Optional repository **variable** (Settings → Secrets and variables → Actions →
Variables), only if your document root is not `public_html/foss`:

| Name | Value |
| --- | --- |
| `FTP_REMOTE_DIR` | e.g. `public_html`, or `domains/bluhuskyinc.com/public_html/foss` |

Until `FTP_HOST` exists the FTP step is skipped; everything else still runs.

## Uploading by hand, without FTP

`python3 deploy_hostinger.py` writes **files/foss-site-public_html.zip** — the
whole site, ready for the web root. In hPanel: Files → File Manager, open the
subdomain's folder, upload the zip, then right-click it → **Extract**, and delete
the zip afterwards. Same result as the FTP upload, just manual.

The zip from the latest sync run is also on the Actions tab under
**foss-site-public_html**.

## Checking the connection

```bash
FTP_HOST=ftp.bluhuskyinc.com FTP_USER=u123456789 FTP_PASSWORD='...' \
  python3 deploy_ftp.py --test
```

It logs in, prints the folder it would write to, and lists what is already there.
Nothing is changed. A wrong folder is the usual first surprise; correct it with
`FTP_REMOTE_DIR`.

To see what an upload would send without sending it:

```bash
python3 deploy_ftp.py --dry-run
```

## How the uploader stays safe

- Credentials come from the environment only. No password is written into the
  repository, the workflow file or the logs.
- It compares a fingerprint of every file with the previous run's record
  (`.ftp-state.json`, kept in the Actions cache and never committed), so an
  unchanged site uploads nothing.
- It only deletes files it uploaded itself and that are gone locally — a pet's
  page and photos once that pet is adopted. Other files in the folder, including
  anything you put there yourself, are left alone.
- Each file is verified by size after upload; the run fails rather than reporting
  a success it cannot back up.

## Local copies

```bash
python3 deploy_hostinger.py   # build .deploy-hostinger + the zip
python3 deploy_ftp.py         # upload what changed (needs the FTP_* env vars)
./refresh.sh                  # rebuild the site from the reference copy, then sync
python3 deploy_pages.py       # the GitHub Pages build, unchanged
```
