# EM Guidelines

A phone-first, offline-capable web app (PWA) of emergency-medicine–relevant clinical
pathways. It is searchable, grouped by category and care setting, and refreshed on the 1st of
every month by a GitHub Action.

**Current source:** [Nationwide Children's clinical pathways](https://www.nationwidechildrens.org/for-medical-professionals/tools-for-your-practice/clinical-pathways)

## Using it on your phone

1. Open the GitHub Pages URL in Safari.
2. Tap Share → **Add to Home Screen**. It opens full screen like an app and works offline
   after the first load (the guideline list is cached; PDFs open from the source site).

Features:
- **Search** with EM shorthand (`dka`, `uti`, `nat`, `apap`, `ssti`, `cspine`, `rsi`, …)
- **Setting filter**: ED + UC (default), All, or a single setting (ED, UC, IP, NICU, OP, Surgery, BHP)
- **Category chips**: Respiratory, Infectious Disease, Toxicology, Trauma, Neurology, …
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
