#!/usr/bin/env python3
"""Every-5-minute watcher (GitHub Actions, public repo = free).

Downloads SimplifyJobs Summer2027-Internships listings.json, keeps new, active,
US/remote SWE / mobile / product-eng / PM internships at SPAN-tier companies
(companies.txt), and pushes a phone notification through ntfy.sh.

Env: NTFY_TOPIC (repo secret). Without it, matches are only printed.
First run seeds state silently (no notification flood).
"""
import json, os, re, sys, time, urllib.request

LISTINGS = "https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/.github/scripts/listings.json"
HERE = os.path.dirname(os.path.abspath(__file__))
SEEN = os.path.join(HERE, "state", "seen.txt")
TERMS = {"Summer 2027", "Winter 2027", "Spring 2027", "Fall 2027"}
CATS = {"Software", "Software Engineering", "Product", "Product Management"}
REQ = re.compile(r"(?i)(software|swe|engineer|developer|ios|android|mobile|full[- ]?stack|front[- ]?end|back[- ]?end|web|product manag|\bapm\b|associate product|product engineer)")
EXCL = re.compile(r"(?i)\b(phd|ph\.d|mba|hardware|firmware|embedded|asic|fpga|mechanical|electrical|manufacturing|test engineer|quality|process engineer|chemical|civil|controls|systems engineer|design engineer|it support|help ?desk|sales|marketing|recruit|finance|accounting|legal)\b")
US = set("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split())
MAX_PUSH = 8
MAX_AGE_DAYS = 7


def norm(s):
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def load_companies():
    out = []
    with open(os.path.join(HERE, "companies.txt")) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#"):
                out.append(norm(line))
    return out


def tier_ok(company, tiers):
    c = norm(company)
    return any(c == t or c.startswith(t + " ") for t in tiers)


def is_us(locs):
    if not locs:
        return True
    for l in locs:
        if re.search(r"(?i)remote", l) and not re.search(r"(?i)canada|uk|india|europe|emea|apac|mexico|brazil", l):
            return True
        parts = [p.strip() for p in l.split(",")]
        if len(parts) >= 2 and parts[1][:2].upper() in US and len(parts[1]) <= 3:
            return True
        if re.search(r"\b(USA|United States|US)\b", l):
            return True
    return False


def push(topic, title, body, url):
    req = urllib.request.Request(f"https://ntfy.sh/{topic}", data=body.encode(), method="POST")
    req.add_header("Title", title.encode("utf-8").decode("latin-1", "ignore"))
    req.add_header("Priority", "high")
    req.add_header("Tags", "briefcase")
    if url:
        req.add_header("Click", url)
    urllib.request.urlopen(req, timeout=20).read()


def main():
    topic = os.environ.get("NTFY_TOPIC", "").strip()
    os.makedirs(os.path.dirname(SEEN), exist_ok=True)
    first = not os.path.exists(SEEN)
    seen = set()
    if not first:
        with open(SEEN) as f:
            seen = {l.strip() for l in f if l.strip()}

    with urllib.request.urlopen(LISTINGS, timeout=60) as r:
        data = json.load(r)

    tiers = load_companies()
    now = time.time()
    hits = []
    for x in data:
        lid = x["id"]
        if lid in seen:
            continue
        seen.add(lid)
        if first:
            continue
        if not (x.get("active") and x.get("is_visible", True)):
            continue
        if x.get("category") not in CATS or not TERMS.intersection(x.get("terms") or []):
            continue
        if now - x.get("date_posted", 0) > MAX_AGE_DAYS * 86400:
            continue
        t = x.get("title", "")
        if EXCL.search(t) or not REQ.search(t) or not is_us(x.get("locations")):
            continue
        if not tier_ok(x.get("company_name"), tiers):
            continue
        hits.append(x)

    with open(SEEN, "w") as f:
        f.write("\n".join(sorted(seen)) + "\n")

    print(f"first_run={first} listings={len(data)} hits={len(hits)}")
    for x in hits[:MAX_PUSH]:
        title = f"{x['company_name']} - {x['title']}"[:120]
        body = f"{', '.join(x.get('terms') or [])} | {', '.join((x.get('locations') or [])[:2])}\nTap to open the posting."
        print("HIT", title, x.get("url"))
        if topic:
            try:
                push(topic, title, body, x.get("url"))
            except Exception as e:
                print("push failed:", e, file=sys.stderr)
    if len(hits) > MAX_PUSH and topic:
        push(topic, f"+{len(hits) - MAX_PUSH} more SPAN-tier postings", "Check SimplifyJobs Summer2027-Internships.", "https://github.com/SimplifyJobs/Summer2027-Internships")


if __name__ == "__main__":
    main()
