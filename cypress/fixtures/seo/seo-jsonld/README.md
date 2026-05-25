# JSON-LD fixtures

One file per page. Each file is a JSON **array** containing the full expected JSON-LD objects for that page.

## How to populate

1. Open the live page (e.g. https://www.kraftshala.com/marketing-launchpad/digital-marketing-course/) in Chrome.
2. DevTools → Elements → search for `application/ld+json`.
3. Copy the full inner text of every `<script type="application/ld+json">` tag.
4. Paste each into this file's array (one object per script).

The Check 7 (JSON-LD deep diff) test compares page JSON-LD against this array using a recursive walker — every key, every value. When it fails, you'll get a list of missing / extra / changed fields with their full paths.

## Files (one per page)

| File | Page |
|---|---|
| `home.json` | `/` |
| `mlp-core.json` | `/marketing-launchpad/digital-marketing-course/` |
| `mlp-pt.json` | `/marketing-launchpad/part-time-digital-marketing-course/` |
| `mlp-hindi.json` | `/marketing-launchpad/digital-marketing-course-in-hindi/` |
| `alm.json` | `/pgp-in-marketing/` |
| `pgp-sales-marketing.json` | `/pgp/learn-sales-and-marketing/` |
| `blog.json` | `/blog/` |
