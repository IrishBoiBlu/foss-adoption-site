#!/usr/bin/env python3
"""Package the site for Hostinger's public_html at foss.bluhuskyinc.com.

The GitHub Pages build prefixes every link with the repository path
(/foss-adoption-site/assets/site.css). On Hostinger the site sits at the root of
its own domain, so that prefix has to go and the pages must address
https://foss.bluhuskyinc.com/ directly.

This stages the same site into .deploy-hostinger and writes
files/foss-site-public_html.zip, which can be uploaded and unpacked in hPanel's
File Manager without any FTP setup at all.

    python3 deploy_hostinger.py

deploy_ftp.py uploads the same staged folder over FTP; run that (or let the
sync workflow run it) to keep the live site current.
"""
import os
import subprocess
import sys
import zipfile

DOMAIN = os.environ.get("PUBLIC_DOMAIN", "foss.bluhuskyinc.com").strip()
STAGE = os.environ.get("OUT_DIR", "").strip() or ".deploy-hostinger"
ZIP = os.path.join("files", "foss-site-public_html.zip")

# Files that only make sense on GitHub Pages, or that a webserver should never
# be handed.
SKIP_NAMES = {".nojekyll", "CNAME", ".DS_Store", "Thumbs.db"}


def stage():
    if not os.path.isdir("files/foss-clone"):
        raise SystemExit("files/foss-clone is missing - run ./refresh.sh first")
    env = dict(os.environ, BASE_PATH="/", PUBLIC_DOMAIN=DOMAIN, OUT_DIR=STAGE)
    print(f"Staging the site for https://{DOMAIN}/ ...")
    subprocess.run([sys.executable, "deploy_pages.py"], env=env, check=True)


def packaged_files():
    found = []
    for root, dirs, names in os.walk(STAGE):
        dirs.sort()
        for name in sorted(names):
            if name in SKIP_NAMES:
                continue
            found.append(os.path.join(root, name))
    return found


def write_zip(paths):
    os.makedirs(os.path.dirname(ZIP), exist_ok=True)
    with zipfile.ZipFile(ZIP, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        # Relative paths, so unpacking into public_html gives index.html at the
        # top level rather than a nested folder.
        for path in paths:
            zf.write(path, os.path.relpath(path, STAGE).replace(os.sep, "/"))


def main():
    stage()
    paths = packaged_files()
    if not paths:
        raise SystemExit(f"{STAGE} is empty - nothing to package")
    write_zip(paths)
    total = sum(os.path.getsize(p) for p in paths)
    print(
        f"Packaged {len(paths)} files ({total / 1_048_576:.1f} MB of site) into {ZIP}\n"
        f"Upload it to public_html and choose Extract, or run: python3 deploy_ftp.py"
    )


if __name__ == "__main__":
    main()
