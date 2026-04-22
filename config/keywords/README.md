# Keywords

Each file here is named `<app-id>.json` and contains your keyword lists grouped by locale (ISO country code lowercase).

```json
{
  "us": ["keyword 1", "keyword 2"],
  "de": ["deutsches keyword"]
}
```

**These files are gitignored** — your keywords stay private.

`example.*.json` files are committed as demo — do not edit, they don't affect the app.

## How to add keywords

Either edit the JSON files directly, or use the Keywords editor in the UI.

## Methodology

Track 2-4 word **search phrases** — what users actually type into App Store search. Not single words from the Keywords field in ASC.

Localize by **intent**, not literal translation. Example: Turkish users search `rüya tabiri` ("dream interpretation") — not `rüya günlüğü` ("dream journal").
