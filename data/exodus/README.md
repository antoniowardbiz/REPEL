# Drop your Exodus CSV exports here

Put the **Export Transactions** CSV from Exodus into this folder (file name does
not matter, it just has to end in `.csv`). The reconciler reads every `.csv` in
here and merges them, de-duplicating by transaction id — so it is safe to keep
dropping in fresh full-history exports; older copies are harmless.

## How to export from Exodus

**Desktop app:** open Exodus → top-left menu → **Settings** → **Exodus Settings**
→ scroll to **Export** → **Export All Transactions**. This saves a CSV of every
transaction across all assets.

**Mobile app:** **Settings (gear)** → **Transaction Export** → choose the
assets / *All assets* → it emails you the CSV; download it and drop it here.

## Uploading it (GitHub Actions cloud runtime)

1. Click **Add file → Upload files** in this folder on GitHub.
2. Drag in the CSV and commit.
3. The **Exodus Cost Reconciler** workflow runs automatically on the upload and
   posts any discrepancies into the Notion alerts database.

> The CSV contains your crypto transaction amounts, dates, and on-chain tx ids
> — no card numbers, seed phrase, or passwords. Keep this repository private.
