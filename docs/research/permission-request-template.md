# Permission request template (WP-02)

For sources whose Terms **prohibit** automated access (Devpost), **don't address it** (Devfolio, most college
sites), or **can't be read without a browser** (Unstop). Send from a university address, ideally the department's,
with a faculty member's name in the signature — not from a personal account.

**Before sending:** fill every `<…>` placeholder, and keep it short. One concrete ask, one paragraph of context,
an explicit offer to stop. Sending this does not grant permission — until a written reply arrives, the source stays
`MANUAL_IMPORT_ONLY` or `BLOCKED` in `sources.compliance_status`.

---

**Subject:** Permission for low-volume automated access to <Source> event listings — <University>, <Department>

Dear <Source> team,

I am <Name>, <role> in the <Department> at <University>, <city>, India.

We are building a small internal tool that helps our professors keep track of hackathons, ideathons, innovation
challenges, CTFs and coding contests that our students could enter, and then manage the students' participation.
It runs on a single departmental computer, and only our faculty can see it. It is **not a public website, not a
commercial product, and we do not republish or resell any data**.

To keep the listings current we would like to read your public event listings automatically, at a low rate:

- roughly **one request every <30–60> minutes**, and a detail request only when a listing entry has changed;
- we honour `robots.txt`, any `Crawl-delay`, `429`/`Retry-After` and conditional requests (ETag/Last-Modified);
- we identify ourselves with `User-Agent: CompIntel/<version> (+<department contact email>)`;
- we never log in, never bypass any protection, and store only event facts (title, organiser, dates, mode,
  location, eligibility, fee, prize, links) — we discard any personal data about participants;
- every event we show links back to your page as the source of record.

**Our questions:**

1. Do you permit this kind of low-volume automated reading of your public listings? If not, we will stop
   immediately and enter events by hand instead.
2. Do you offer a documented API, a data feed, or an export we should use instead? We would much prefer a
   supported route, and are happy to use an API key with any rate limit you set.
3. Is there attribution wording you would like us to display?

We are happy to adjust our request rate, restrict ourselves to particular paths, or identify our traffic in any
way that helps you. If you would rather we did not do this at all, please just say so and we will comply.

Thank you for your time, and for running a service our students rely on.

Kind regards,
<Name>
<Role>, <Department>
<University>
<email> · <phone, optional>

---

## Per-source notes

| Source | Send to | Say specifically |
|---|---|---|
| **Devpost** | via `https://info.devpost.com` support / `support@devpost.com` | Their ToS prohibits automated access ("Uses manual or automated software … to 'scrape,' 'crawl' or 'spider' the Site"), so **ask for written permission or API access**. Until they reply, no automated access of any kind — this is the one source where the answer is currently "no". |
| **Unstop** | `help@unstop.com` (listed on their contact page) | Mention that their `robots.txt` already allows `/hackathons/`, `/competitions/` and `/api/public/*`, and ask whether that public API may be used and whether documentation exists. Also ask them to confirm their Terms permit it (we could not read the Terms page without JavaScript). |
| **Devfolio** | via the contact route on `devfolio.co` | Their Terms don't mention automated access. Ask for confirmation that reading the public hackathon listing pages at a low rate is acceptable, and whether they would prefer we use an API. |
| **CLIST** | the address on `https://clist.by/terms/` | Permission is **not** needed (the API is offered for "personal, educational and community projects"), but tell them our use case, confirm the 10 requests/minute limit is fine for us, and confirm our attribution wording ("Contest data provided by CLIST"). |
| **CTFtime** | "Contact us" on `ctftime.org` | Permission is **not** needed for API "data analysis" use. Only write if we ever want more than the documented endpoints, or a higher rate. |
| **College / institute sites** | the webmaster address in the site footer, or the department that runs the event | Short version of the above, plus: we read only the public events/notices page, at most a few requests per day, and we link back. For government institutes, mention that this supports student participation from <University>. |
