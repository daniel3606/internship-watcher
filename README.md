# internship-watcher

Every 5 minutes, a GitHub Action reads [SimplifyJobs/Summer2027-Internships](https://github.com/SimplifyJobs/Summer2027-Internships) and sends a phone push via [ntfy](https://ntfy.sh) when a new SWE / mobile / product-engineering / PM internship (Summer, Winter, Spring or Fall 2027, US or remote) appears at a company on `companies.txt`.

- Public repo → GitHub Actions minutes are free.
- Notification topic lives in the `NTFY_TOPIC` repository secret (never in the code).
- `state/seen.txt` remembers postings already checked; the first run only records, it doesn't notify.
- Edit `companies.txt` to change which companies trigger an alert.
