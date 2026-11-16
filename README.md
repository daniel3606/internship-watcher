# internship-watcher

Every 5 minutes, a GitHub Action reads [SimplifyJobs/Summer2027-Internships](https://github.com/SimplifyJobs/Summer2027-Internships) and sends a phone push via [ntfy](https://ntfy.sh) when a new SWE / mobile / product-engineering / PM internship (Summer, Winter, Spring or Fall 2027, US or remote) appears at a company on `companies.txt`.

- Public repo → GitHub Actions minutes are free.
- Notification topic lives in the `NTFY_TOPIC` repository secret (never in the code).
- `state/seen.txt` remembers postings already checked; the first run only records, it doesn't notify.
- Edit `companies.txt` to change which companies trigger an alert.

## Scheduler: Google Apps Script (GitHub's cron never fires for this account)

GitHub has not run a single `schedule` event on any of this account's repos, so the 5-minute check runs on a free Google Apps Script time trigger instead (`apps_script/Watcher.gs`). Same filter, same `companies.txt` (read from this repo), same ntfy topic. No GitHub token needed.

1. Open https://script.google.com → **New project** → paste `apps_script/Watcher.gs` into `Code.gs` → save.
2. **Project Settings → Script properties → Add**: `NTFY_TOPIC` = the same value as this repo's `NTFY_TOPIC` secret.
3. In the editor choose function **`setup`** → **Run** → approve the permission prompt ("connect to an external service").
4. Your phone gets "Internship watcher (Apps Script) is on". From then on it checks every 5 minutes. **Executions** in the left sidebar shows each run; Script property `LAST_RUN` shows the last result.

The GitHub workflow stays for manual test pings (`workflow_dispatch`). If GitHub schedules ever start firing, delete the `schedule:` lines in `watch.yml` to avoid double alerts.
