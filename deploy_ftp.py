#!/usr/bin/env python3
"""Publish .deploy-hostinger to Hostinger over FTP or FTPS.

No passwords live in this file. Everything comes from the environment:

    FTP_HOST=foss.bluhuskyinc.com   (or the server IP hPanel shows)
    FTP_USER=u123456789
    FTP_PASSWORD=...                (the FTP account's password)

Optional:
    FTP_PORT=21
    FTP_REMOTE_DIR=public_html/foss  folder the subdomain serves from
    FTP_TLS=1                       1 = FTPS, 0 = plain FTP
    FTP_SOURCE=.deploy-hostinger
    FTP_STATE_FILE=.ftp-state.json   what was uploaded last time

    python3 deploy_ftp.py --test      connect and show the folder, change nothing
    python3 deploy_ftp.py --dry-run   list what would be uploaded
    python3 deploy_ftp.py             upload what changed, remove what went away

Only files that changed are re-sent, and only files this script uploaded before
are ever deleted, so nothing else in the hosting account is touched.
"""
import ftplib
import hashlib
import json
import os
import posixpath
import sys
import time

SOURCE = os.environ.get("FTP_SOURCE", ".deploy-hostinger")
STATE_FILE = os.environ.get("FTP_STATE_FILE", ".ftp-state.json")
REMOTE_DIR = (os.environ.get("FTP_REMOTE_DIR") or "public_html/foss").strip().strip("/")
TLS = (os.environ.get("FTP_TLS", "1").strip().lower() not in ("0", "false", "no"))

# GitHub Pages leftovers and webserver noise.
SKIP_NAMES = {".nojekyll", "CNAME", ".DS_Store", "Thumbs.db", STATE_FILE}


def credentials():
    host = os.environ.get("FTP_HOST", "").strip()
    user = os.environ.get("FTP_USER", "").strip()
    password = os.environ.get("FTP_PASSWORD", "")
    missing = [name for name, value in (("FTP_HOST", host), ("FTP_USER", user),
                                        ("FTP_PASSWORD", password)) if not value]
    if missing:
        raise SystemExit(
            "FTP is not set up yet - missing " + ", ".join(missing) + ".\n"
            "In GitHub that means adding the repository secrets; locally:\n"
            "  FTP_HOST=... FTP_USER=... FTP_PASSWORD=... python3 deploy_ftp.py --test"
        )
    return host, user, password


def shasum(path):
    digest = hashlib.sha1()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def local_files():
    """Walk the staged site, returning {remote-relative path: (abs, sha1, size)}."""
    if not os.path.isdir(SOURCE):
        raise SystemExit(f"{SOURCE} is missing - run python3 deploy_hostinger.py first")
    files = {}
    for root, dirs, names in os.walk(SOURCE):
        dirs.sort()
        for name in sorted(names):
            if name in SKIP_NAMES:
                continue
            path = os.path.join(root, name)
            rel = os.path.relpath(path, SOURCE).replace(os.sep, "/")
            files[rel] = (path, shasum(path), os.path.getsize(path))
    return files


def load_state():
    try:
        with open(STATE_FILE, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return {}
    return data.get("files") or {}


def save_state(root, files):
    with open(STATE_FILE, "w", encoding="utf-8") as fh:
        json.dump({"root": root, "files": files}, fh, indent=1, sort_keys=True)


def connect():
    host, user, password = credentials()
    port = int(os.environ.get("FTP_PORT", "21"))
    if TLS:
        ftp = ftplib.FTP_TLS(timeout=90)
        try:
            ftp.connect(host, port)
            ftp.login(user, password)
            ftp.prot_p()
            return ftp
        except ftplib.all_errors as exc:
            ftp.close()
            print(f"Secure FTP was refused ({exc}); trying plain FTP.")
    ftp = ftplib.FTP(timeout=90)
    ftp.connect(host, port)
    ftp.login(user, password)
    return ftp


def ensure_remote_dir(ftp, path):
    """mkdir -p for FTP, starting from the account's home folder."""
    if path.startswith("/"):
        ftp.cwd("/")
    for part in [p for p in path.split("/") if p and p != "."]:
        try:
            ftp.cwd(part)
        except ftplib.error_perm:
            ftp.mkd(part)
            ftp.cwd(part)


def remote_root(ftp):
    if REMOTE_DIR.startswith("/"):
        return posixpath.normpath(REMOTE_DIR)
    return posixpath.normpath(posixpath.join(ftp.pwd() or "/", REMOTE_DIR))


def goto(ftp, root, rel_dir=""):
    ftp.cwd(root)
    if rel_dir:
        ensure_remote_dir(ftp, rel_dir)


def upload(ftp, root, files, state):
    uploaded = skipped = failed = 0
    new_state = {}
    started = time.time()

    for rel, (path, digest, size) in files.items():
        if state.get(rel) == digest:
            new_state[rel] = digest
            skipped += 1
            continue
        try:
            goto(ftp, root, posixpath.dirname(rel))
            with open(path, "rb") as fh:
                ftp.storbinary("STOR " + posixpath.basename(rel), fh)
            remote_size = ftp.size(posixpath.basename(rel))
            if remote_size is not None and remote_size != size:
                raise IOError(f"remote size {remote_size} != local {size}")
            new_state[rel] = digest
            uploaded += 1
            print(f"  uploaded {rel}")
        except ftplib.all_errors as exc:
            failed += 1
            print(f"  !! {rel}: {exc}")

    deleted = 0
    gone = [rel for rel in state if rel not in files]
    for rel in gone:
        try:
            goto(ftp, root, posixpath.dirname(rel))
            ftp.delete(posixpath.basename(rel))
            deleted += 1
            print(f"  removed {rel}")
        except ftplib.error_perm as exc:
            # Already absent is fine; anything else is worth reporting.
            if "550" not in str(exc):
                print(f"  .. could not remove {rel} ({exc})")

    return uploaded, skipped, deleted, failed, new_state, time.time() - started


def test():
    host = os.environ.get("FTP_HOST", "").strip()
    ftp = connect()
    root = remote_root(ftp)
    print(f"Connected to {host} as {os.environ.get('FTP_USER', '').strip()}.")
    print(f"Home folder: {ftp.pwd()}")
    print(f"This script writes to: {root}  (FTP_REMOTE_DIR={REMOTE_DIR})")
    try:
        ftp.cwd(root)
        listing = ftp.nlst()
        print(f"{len(listing)} entries there now, e.g. {listing[:8]}")
        if any(name.rstrip("/").endswith(".html") for name in listing):
            print("Looks right: web pages live in that folder.")
        else:
            print("No .html files there yet - a first upload will fill it.")
            print("If the subdomain shows a different folder in hPanel, set "
                  "FTP_REMOTE_DIR to that folder.")
    except ftplib.error_perm as exc:
        print(f"{root} does not exist yet ({exc}).")
        print("The first upload creates it; nothing to fix if that folder is the "
              "document root hPanel shows for the subdomain.")
        try:
            ftp.cwd(ftp.pwd() or "/")
            entries = [n for n in ftp.nlst() if not n.endswith(".")][:12]
            print(f"Folders in the account's home folder: {entries}")
            print("If your site folder is one of those, set FTP_REMOTE_DIR to it.")
        except ftplib.all_errors:
            pass
    finally:
        try:
            ftp.quit()
        except ftplib.all_errors:
            ftp.close()


def main():
    args = set(sys.argv[1:])
    if "--test" in args:
        return test()

    dry_run = "--dry-run" in args
    files = local_files()
    state = load_state()
    total = sum(size for _p, _d, size in files.values())
    pending = [rel for rel, (_p, digest, _s) in files.items() if state.get(rel) != digest]
    print(
        f"{len(files)} files staged ({total / 1_048_576:.1f} MB); "
        f"{len(pending)} changed since the last upload."
    )
    gone = [rel for rel in state if rel not in files]
    if dry_run:
        for rel in pending:
            print(f"  would upload {rel} ({files[rel][2] / 1024:.0f} KB)")
        for rel in gone:
            print(f"  would delete {rel}")
        print(f"Dry run: {len(pending)} to upload, {len(files) - len(pending)} unchanged, "
              f"{len(gone)} to delete. Nothing was sent and no account was contacted.")
        return
    if not pending and not gone:
        print("Everything already up to date; nothing to send.")
        return

    ftp = connect()
    try:
        root = remote_root(ftp)
        ensure_remote_dir(ftp, root)
        uploaded, skipped, deleted, failed, new_state, elapsed = upload(
            ftp, root, files, state)
    finally:
        try:
            ftp.quit()
        except ftplib.all_errors:
            ftp.close()

    save_state(root, new_state)
    print(
        f"Uploaded {uploaded}, unchanged {skipped}, removed {deleted} "
        f"in {elapsed:.1f}s to {root}."
    )
    if failed:
        raise SystemExit(f"{failed} files could not be uploaded")
    if uploaded or deleted:
        print("Live at https://foss.bluhuskyinc.com/ (clear the browser cache if a "
              "page looks stale).")


if __name__ == "__main__":
    main()
