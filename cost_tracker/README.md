# Exodus → Notion cost reconciler

A watchdog that compares the **outgoing payments** in your Exodus wallet against
the **Total Costs** Notion database and alerts you when something is off. It does
**not** auto-create cost entries — you keep logging costs the way you do now.
It just tells you when you forgot one, or logged the wrong amount.

## What it flags

| Alert | Meaning |
|-------|---------|
| **Untracked Payment** | Money left Exodus but there's no matching row in Total Costs. |
| **Amount Mismatch** | A cost row sits right next to the payment date, but its $ amount is nowhere near what actually left the wallet. |
| **Period Gap** | Over a whole month, more $ left Exodus than is logged in Total Costs. |

Every alert becomes a row in the **⚠️ Payment Reconciliation Alerts** database
(inside your **FINANCE** page). Alerts are de-duplicated, so you won't get the
same one twice — and an Open alert flips to **Resolved** automatically once you
add/fix the matching cost.

## How it works

```
 Exodus app ──export CSV──▶ data/exodus/*.csv
                                  │
                       cost_tracker/reconcile.py   (GitHub Actions, scheduled)
                                  │  crypto→USD via CoinGecko (stablecoins = $1)
                                  ▼
                    reads "Total Costs" ── compares ──▶ writes "⚠️ Alerts"
```

---

## One-time setup (≈ 10 minutes)

### 1. Create a Notion integration (gives the robot read/write access)

1. Go to <https://www.notion.so/profile/integrations> → **New integration**.
2. Name it `Exodus Reconciler`, pick your workspace (**REPEL's space**), type **Internal**.
3. Capability: **Read content** + **Insert content** + **Update content**.
4. Copy the **Internal Integration Secret** (starts with `ntn_…`). You'll need it in step 3.

### 2. Give the integration access to the two databases

In Notion, open the **FINANCE** page → top-right **`•••`** → **Connections** →
**Connect to** → choose `Exodus Reconciler`. Because both **Total Costs** and
**⚠️ Payment Reconciliation Alerts** live under FINANCE, this one step grants
access to both. (If you prefer, connect each database individually instead.)

### 3. Add the secret to GitHub

In this repo: **Settings → Secrets and variables → Actions → New repository secret**.

| Name | Value |
|------|-------|
| `NOTION_TOKEN` | the `ntn_…` secret from step 1 |
| `COINGECKO_API_KEY` | *(optional)* a free CoinGecko Demo key — only needed if you pay in volatile coins a lot and hit rate limits |

### 4. (First run only) avoid old-history spam

If your wallet has lots of old payments you never logged, open
`cost_tracker/config.json` and set `reconcile.start_date` to the date you want to
start checking from, e.g. `"2026-06-01"`. Otherwise it will alert on everything.

### 5. Done — use it

- Export the Exodus CSV and upload it to **`data/exodus/`** (see that folder's README).
- The **Exodus Cost Reconciler** GitHub Action runs on every upload, plus once a
  day, and posts any problems into the alerts database.
- You can also trigger it manually: **Actions** tab → *Exodus Cost Reconciler* → **Run workflow**.

> ⏰ The daily schedule only starts working once this code is merged into the
> repo's **default branch** (GitHub only runs scheduled workflows from there).
> Until then, uploads and manual runs work fine.

---

## Running it locally (optional)

```bash
pip install -r cost_tracker/requirements.txt
export NOTION_TOKEN='ntn_...'
python cost_tracker/reconcile.py --csv ~/Downloads/exodus-export.csv --dry-run
```

`--dry-run` reports what it *would* do without writing anything to Notion — good
for a first test. Drop `--dry-run` to actually post alerts. Add `--verbose` to
see each payment priced and matched.

---

## Tuning (config.json)

All thresholds live in `cost_tracker/config.json` — no code changes needed:

- `matching.date_window_days` – how far from a payment date to look for its cost row (default 4).
- `matching.amount_rel_tolerance` / `amount_abs_tolerance_usd` – how close the amounts must be to count as a match (default 12% or $15).
- `reconcile.min_payment_usd` – ignore dust below this (default $5).
- `reconcile.start_date` – ignore payments before this date.
- `period_check.*` – the monthly gap thresholds, or set `enabled: false` to turn it off.
- `currency.coingecko_ids` – add any coin the parser doesn't recognise (`"SYMBOL": "coingecko-id"`).

## If your CSV columns look different

Exodus has shipped a few CSV layouts. The parser auto-detects the usual column
names (`DATE`, `TYPE`, `OUTAMOUNT`, `OUTCURRENCY`, `OUTTXID`, `OUTTXURL`,
`PERSONALNOTE`, …). If a column isn't picked up, open an export, check the header
row, and we can add the alias — the mapping lives in `parse_exodus_csv()` in
`reconcile.py`.
