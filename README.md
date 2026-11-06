# EM Guidelines

A phone-first, offline-capable web app (PWA) of emergency-medicine–relevant clinical
pathways. It is searchable, grouped by category and care setting, and refreshed on the 1st of
every month by a GitHub Action.

## Sources

| Source | How it's pulled |
|---|---|
| **ACEP Clinical Policies** | ACEP's public policy list, matched to the Annals of Emergency Medicine publication (date, DOI, abstract) |
| **ACC/AHA** | ACC's guideline index (all joint ACC/AHA guidelines), plus AHA-led guidelines from the literature: stroke, ICH, SAH, CPR/ECC |
| **DVT / PE** | Literature: CHEST, ASH, ESC, ISTH, ERS, ACEP, AHA |
| **Sepsis & Critical Care** | Literature: Surviving Sepsis Campaign, SCCM, ESICM |
| **IDSA / ATS** | Literature: EM-relevant infectious disease and pulmonary guidelines |
| **Trauma & Surgery** | Literature: EAST, WTA, AAST, WSES |
| **SAEM GRACE** | Literature: Academic Emergency Medicine GRACE guidelines |
| **Neurocritical Care / AAN** | Literature: NCS and AAN guidelines (status epilepticus, ICH/SAH, TBI, headache, etc.) |
| **ESC** | Literature: European Society of Cardiology guidelines |
| **AAP** | Literature: AAP clinical practice guidelines (febrile infant, UTI, bronchiolitis, BRUE, etc.) |
| **ACG (GI)** | Literature: GI bleeding, pancreatitis, liver, diverticulitis |
| **Resuscitation (ERC/ILCOR)** | Literature: ERC guidelines and ILCOR consensus |
| **Toxicology (AACT/EXTRIP)** | Literature: Clinical Toxicology recommendations and position statements |
| **Nationwide Children's** | Pathway listing page + each pathway PDF's `Last-Modified` date |
| **CHOP** | Pathway library + each pathway's "Revised" date |
| **RebelEM** | Every post since 2021 (WordPress API), summarized and cross-referenced to guidelines on the same topic |
| **ALiEM** | Clinical posts since 2021 (education, wellness and social-media categories excluded) |
| **UpToDate** | Link-out only ("Search UpToDate", marked subscription). Its terms don't allow copying or summarizing its content |

"Literature" sources search specific journals for guideline publications on EM topics, so a new
guideline appears automatically at the next monthly run. The search tries **Europe PMC**, then
**PubMed** (falling back to the PubMed website's search if the E-utilities search API is down),
then **Crossref**. One index being down doesn't stop the refresh. Titles that only discuss,
correct or summarize a guideline (errata, "Ten Commandments", commentaries) are filtered out, and
older versions of the same guideline are marked "Older version" and shown only in search.

## AI summaries

`scraper/summarize.mjs` writes `docs/data/summaries.json`: for every guideline and blog post, a short
summary, 4-8 key points (doses, thresholds and recommendation class kept when the source states
them), 1-3 topics from the fixed list in `scraper/topics.mjs`, and the access status.

- **Model:** Claude Opus 5.5 via the Message Batches API (half price). Medium effort for guidelines,
  low for blog posts.
- **Source text:** pathway PDFs (NCH), pathway pages (CHOP), post text (RebelEM/ALiEM), and for
  journal guidelines the Europe PMC abstract plus open full text when it exists. Long guidelines are
  trimmed to the opening and the paragraphs that state recommendations. Each summary records which
  basis it came from ("abstract only", "full text", …).
- **Paywalls:** each guideline shows a free / paywalled / unverified badge, and paywalled links are
  labelled. ACEP clinical policies are members-only on acep.org and subscription-only in Annals with
  no abstract, so they get no summary. They are tagged with topics from the title only, so they still
  appear on topic pages next to RebelEM/ALiEM discussion.
- **Cost control:** results are cached by each item's fingerprint, so only new or changed items are
  sent each month. A batch that hasn't finished is saved to `summary-pending.json` and collected on
  the next run.
- **Setup:** add the repository secret `ANTHROPIC_API_KEY` (Settings → Secrets and variables →
  Actions). Without it the step is skipped and the app shows source descriptions only.
- `node scraper/summarize.mjs --dry-run` fetches all source text and prints the item count and an
  estimated cost without calling the API.

Every summary is labelled as AI-generated, with a reminder to check the source.

## Using it on your phone

1. Open the GitHub Pages URL in Safari.
2. Tap Share → **Add to Home Screen**. It opens full screen like an app and works offline
   after the first load (the guideline list is cached; PDFs open from the source site).

Features:
- **Search** with EM shorthand (`stemi`, `acs`, `pe`, `dvt`, `doac`, `tia`, `sah`, `afib`, `dka`, `uti`, `nat`, `apap`, `rsi`, `acls`, …)
- **Setting filter**: EM-relevant (default), All, or a single setting (ED, UC, IP, ICU, NICU, OP, Surgery, BHP)
- **Source filter**: All, Adult, Peds, or a single society/hospital
- **Category chips**: Respiratory, Infectious Disease, Toxicology, Trauma, Neurology, …
- **Topics tab**: one page per topic (e.g. Pulmonary embolism) with the current landmark guideline first, then other guidelines and pathways, RebelEM/ALiEM discussion, and older versions
- **Ordering**: in every list, current major-society guidelines come first (newest first), then hospital pathways; older versions only show in search
- **Updated tab**: pathways the source revised in the last 90 days, plus what changed in the last refresh
- **Save** (star) favorites, stored on the device

## How the monthly refresh works

`.github/workflows/refresh.yml` runs at 09:17 UTC on the 1st of each month (or on demand from
**Actions → Refresh guidelines & deploy → Run workflow**):

1. `node scraper/index.mjs` crawls each source, follows every pathway page, and reads each
   PDF's `Last-Modified` date.
2. Results merge with the previous `docs/data/guidelines.json`; each entry keeps `firstSeen`
   and gets a new `lastChanged` when its documents change. A run summary is prepended to
   `docs/data/changelog.json` (added / updated / removed).
3. If a source suddenly returns under 60% of its previous count, which usually means the site's
   layout changed, the old data is kept and the error is logged instead of wiping the list.
4. Changed data is committed and `docs/` is deployed to GitHub Pages.

## Adding a source

**A society that publishes guidelines in journals:** add an entry to `SOCIETIES` in
`scraper/sources/societies.mjs` (journal ISSNs + title terms). That's all.

**A website with its own pathway list:**

1. Create `scraper/sources/<name>.mjs` exporting `id`, `name`, `homepage`, and
   `async fetchGuidelines({ log })` that returns records like:
   ```js
   { sourceUrl, title, summary, settings: ['ED'], documents: [{ url, label, lastModified, size }],
     // optional: category, emRelevant
   }
   ```
2. Add it to the `SOURCES` array in `scraper/index.mjs`.
3. Add keyword rules to `scraper/categories.mjs` if the new titles need them.
4. Run `npm run scrape` to test just it: `node scraper/index.mjs --only=<id>`.

## Local development

```bash
npm run scrape   # refresh docs/data (about 2 min, polite 400 ms delay between requests)
npm run serve    # http://localhost:8080
```

No dependencies. Node 20+ for the scraper.

> Reference links only. Always follow local protocols and clinical judgment. Not affiliated
> with the source institutions; content belongs to them.
