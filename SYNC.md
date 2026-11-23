# ShelterLuv sync

The pet pages in `files/foss-clone` come from the shelter's live ShelterLuv
listings (shelter ID `27932`), so adding, editing or adopting out a pet in
ShelterLuv shows up here on the next sync.

No API key or login is needed: ShelterLuv publishes the shelter's adoptable
animals at `https://new.shelterluv.com/api/v3/available-animals/27932`, and each
pet's write-up and weight come from its public profile page.

## Scripts

| Script | What it does | Takes |
| --- | --- | --- |
| `scheduler.sh` | Runs the sync now, then every 30 minutes. Appends to `sync.log`. | runs until stopped |
| `sync-one.sh` | One incremental pass. What the scheduler runs each cycle. | ~10 s |
| `sync.py` | The sync itself (what `sync-one.sh` calls). | ~10 s |
| `refresh.sh` | Full rebuild: rebuild the reference pages, then sync. Use after changing the design or restoring the workspace. | ~30 s |

## What the sync updates

- `/adopt/all`, `/adopt/dogs`, `/adopt/cats`, `/adopt/other-pets` — pet cards,
  the counts in the filter buttons, and the "updated <date>" line.
- `/adopt/<dogs|cats|other-pets>/<ref>/` — one page per pet: photo, breed, age,
  sex, weight, location, write-up and photo gallery.
- Deletes the page and photos of any pet ShelterLuv no longer lists.
- Downloads photos into `files/foss-clone/assets/img/pets/` (cover photo first,
  up to 12 per pet) and only re-downloads what is missing.

Pets marked not adoptable in ShelterLuv are left out of the site.

## Scheduled on GitHub (always on)

`.github/workflows/sync.yml` runs the sync on GitHub's servers every 30 minutes
and publishes the refreshed pages twice: to Hostinger over FTP, which is what
`foss.bluhuskyinc.com` serves, and to GitHub Pages as a fallback. It needs no
machine of yours to stay awake. See `HOSTINGER.md` for the FTP details it uses
and the one-time hPanel setup.

To turn it on, the repository needs two settings under **Settings**:

1. **Actions → General → Workflow permissions**: *Read and write permissions*
   (the job commits the refreshed pages back to the repo).
2. **Pages → Build and deployment → Source**: *GitHub Actions*.

`deploy_pages.py` stages the site for Pages and rewrites the root-absolute
links (`/assets/site.css`) to include the repository path, so the site works at
`https://<user>.github.io/<repo>/`. On a `<user>.github.io` repository it leaves
them alone. `deploy_hostinger.py` reuses the same staging with the links left at
the domain root and writes `files/foss-site-public_html.zip`; `deploy_ftp.py`
uploads the result.

GitHub's scheduler is best-effort: a run can start a few minutes late when
their queue is busy. Scheduled workflows also pause after 60 days with no
repository activity; the sync's own commits normally count as activity, and
**Run workflow** in the Actions tab starts it again.

## Scheduling it somewhere permanent

`cron` is not installed in the Freebuff workspace, so the scheduler is a plain
loop: it keeps running while this workspace is awake and stops when the
workspace sleeps. For a sync that never stops, run it on an always-on machine:

```cron
*/30 * * * * cd /path/to/this/folder && ./sync-one.sh >> /path/to/this/folder/sync.log 2>&1
```

On a machine with systemd, a user timer is the equivalent:

```ini
# ~/.config/systemd/user/foss-sync.{service,timer}
[Service]
WorkingDirectory=%h/foss-site
ExecStart=%h/foss-site/sync-one.sh
```

## Logs

`sync.log` records every run with a timestamp, so `tail -20 sync.log` shows the
last few cycles and any failures. `scheduler.pid` holds the scheduler's process
ID if it needs stopping.

## Notes

- Run `./refresh.sh` (not `sync.py`) if `files/foss-clone` is missing: it
  rebuilds the whole site from the saved reference copy first.
- `kennel_description` in ShelterLuv is what appears as the pet's story.
- Overlapping runs are blocked with a lock file, so a slow run never collides
  with the next tick.
