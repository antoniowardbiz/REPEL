#!/usr/bin/env python3
"""Exodus -> Notion cost reconciler.

Watches outgoing payments exported from the Exodus wallet (a "Export
Transactions" CSV) and checks each one against the **Total Costs** Notion
database. It does NOT auto-log costs. Instead it raises an alert in the
**Payment Reconciliation Alerts** Notion database whenever:

  * Untracked Payment - money left Exodus but no matching row exists in
    Total Costs.
  * Amount Mismatch   - a cost row sits right next to the payment date but its
    USD amount is nowhere near what actually left the wallet.
  * Period Gap        - over a whole month, more (USD) left Exodus than is
    logged in Total Costs.

Crypto amounts are converted to USD at the payment date (stablecoins are
treated as $1; everything else uses CoinGecko historical prices) so they can
be compared against the dollar amounts in the tracker.

Alerts are de-duplicated by transaction id, and an Open alert is flipped to
Resolved automatically once the tracker catches up.

Secrets come from the environment, never the config file:
  NOTION_TOKEN        (required) - Notion internal integration token.
  COINGECKO_API_KEY   (optional) - CoinGecko Demo/Pro key for higher limits.

Usage:
  python cost_tracker/reconcile.py                 # normal run
  python cost_tracker/reconcile.py --dry-run       # report only, write nothing
  python cost_tracker/reconcile.py --csv path.csv  # reconcile one specific file
  python cost_tracker/reconcile.py --verbose
"""

from __future__ import annotations

import argparse
import csv
import glob
import hashlib
import json
import os
import sys
import time
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from collections import defaultdict
from typing import Optional

try:
    import requests
except ImportError:  # pragma: no cover
    sys.exit("Missing dependency: run `pip install -r cost_tracker/requirements.txt`")

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(HERE)
DEFAULT_CONFIG = os.path.join(HERE, "config.json")
NOTION_BASE = "https://api.notion.com/v1"


# --------------------------------------------------------------------------- #
# Data models
# --------------------------------------------------------------------------- #
@dataclass
class Payment:
    """An outgoing payment that left the Exodus wallet."""
    when: date
    currency: str
    amount: float            # absolute crypto amount sent
    fee: float
    fee_currency: str
    txid: str
    tx_url: str
    note: str
    usd: Optional[float] = None  # filled in by pricing

    @property
    def key(self) -> str:
        """Stable de-dup key for this payment."""
        if self.txid:
            return self.txid
        raw = f"{self.when.isoformat()}|{self.currency}|{self.amount:.10f}"
        return "noid-" + hashlib.sha1(raw.encode()).hexdigest()[:16]


@dataclass
class TrackerRow:
    """A row in the Total Costs Notion database."""
    when: Optional[date]
    amount_usd: float
    title: str
    url: str


@dataclass
class Problem:
    kind: str                # "Untracked Payment" | "Amount Mismatch" | "Period Gap"
    key: str                 # de-dup key (txid or PERIOD-YYYY-MM)
    title: str
    amount_usd: float
    when: Optional[date]
    details: str
    tracked_usd: Optional[float] = None
    exodus_amount: Optional[float] = None
    currency: str = ""
    tx_url: str = ""


# --------------------------------------------------------------------------- #
# Config / env
# --------------------------------------------------------------------------- #
def load_config(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def require_token() -> str:
    token = os.environ.get("NOTION_TOKEN", "").strip()
    if not token:
        sys.exit(
            "NOTION_TOKEN is not set.\n"
            "Locally:  export NOTION_TOKEN='ntn_...'\n"
            "In GitHub Actions: add it under Settings > Secrets and variables > Actions."
        )
    return token


# --------------------------------------------------------------------------- #
# Exodus CSV parsing
# --------------------------------------------------------------------------- #
# Exodus' "Export Transactions" CSV is read by normalising the header names
# (uppercase, no spaces/underscores) so we tolerate the different layouts the
# desktop and mobile apps have shipped over the years.
def _norm_header(name: str) -> str:
    return "".join(ch for ch in name.upper() if ch.isalnum())


def _pick(row: dict, *candidates: str) -> str:
    for c in candidates:
        if c in row and row[c] not in (None, ""):
            return str(row[c]).strip()
    return ""


def _to_float(raw: str) -> float:
    if not raw:
        return 0.0
    cleaned = raw.replace(",", "").replace("$", "").strip()
    try:
        return float(cleaned)
    except ValueError:
        return 0.0


_DATE_FORMATS = (
    "%Y-%m-%dT%H:%M:%S.%fZ",
    "%Y-%m-%dT%H:%M:%SZ",
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d %H:%M",
    "%Y-%m-%d",
    "%m/%d/%Y %H:%M:%S",
    "%m/%d/%Y %H:%M",
    "%m/%d/%Y",
    "%d/%m/%Y",
)


def _parse_date(raw: str) -> Optional[date]:
    if not raw:
        return None
    raw = raw.strip()
    # Normalise common ISO timezone forms to something strptime can read.
    iso = raw.replace("Z", "")
    if "+" in iso:
        iso = iso.split("+", 1)[0]
    for candidate in (raw, iso):
        for fmt in _DATE_FORMATS:
            try:
                return datetime.strptime(candidate, fmt).date()
            except ValueError:
                continue
    # Last resort: fromisoformat handles offsets in modern Python.
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).date()
    except ValueError:
        return None


def _classify_type(raw_type: str) -> str:
    """Bucket an Exodus TYPE value. Returns one of:
    failed | internal | incoming | staking | withdrawal | unknown.
    Uses substring matching so 'withdrawal (failed)' -> failed, not withdrawal.
    """
    t = (raw_type or "").lower().strip()
    if "fail" in t:
        return "failed"
    if any(w in t for w in ("exchange", "swap", "trade", "convert")):
        return "internal"
    if any(w in t for w in ("stake", "unstake", "claim", "reward", "airdrop", "mining", "mint", "earn")):
        return "staking"
    if any(w in t for w in ("deposit", "receive", "incoming")):
        return "incoming"
    if any(w in t for w in ("withdraw", "send", "sent", "payment", "spend", "spent")):
        return "withdrawal"
    return "unknown"


def _split_amount_currency(raw: str) -> tuple[str, str]:
    """Handle the v2 COINAMOUNT layout where the symbol is embedded, e.g.
    '-0.0026765 BTC' -> ('-0.0026765', 'BTC')."""
    raw = (raw or "").strip()
    if " " in raw:
        num, _, sym = raw.partition(" ")
        return num.strip(), sym.strip().upper()
    return raw, ""


def parse_exodus_csv(path: str, verbose: bool = False) -> list[Payment]:
    """Return the outgoing payments (sends/withdrawals) found in one CSV."""
    payments: list[Payment] = []
    # utf-8-sig strips a BOM if the file has one.
    with open(path, "r", encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        if not reader.fieldnames:
            return payments
        header_map = {_norm_header(h): h for h in reader.fieldnames}

        def col(*norm_names: str) -> Optional[str]:
            for n in norm_names:
                if n in header_map:
                    return header_map[n]
            return None

        c_date = col("DATE", "TIME", "TIMESTAMP", "DATETIME")
        c_type = col("TYPE", "TRANSACTIONTYPE")
        # OUTAMOUNT (v1) or the single signed COINAMOUNT (v2).
        c_out_amt = col("OUTAMOUNT", "COINAMOUNT", "AMOUNT", "SENTAMOUNT")
        c_out_cur = col("OUTCURRENCY", "CURRENCY", "COIN", "ASSET", "SYMBOL")
        c_fee_amt = col("FEEAMOUNT", "FEE", "NETWORKFEE")
        c_fee_cur = col("FEECURRENCY", "FEECOIN")
        c_txid = col("OUTTXID", "TXID", "TXHASH", "TRANSACTIONID", "TXIDOUT")
        c_txurl = col("OUTTXURL", "TXURL", "EXPLORERURL", "LINK")
        c_in_amt = col("INAMOUNT", "RECEIVEDAMOUNT")
        c_orderid = col("ORDERID", "ORDER", "EXCHANGEID")
        c_note = col("PERSONALNOTE", "NOTE", "NOTES", "MEMO", "LABEL", "COMMENT")

        for raw_row in reader:
            row = {k: (v or "") for k, v in raw_row.items()}
            tx_type = _pick(row, c_type) if c_type else ""
            out_amount_raw = _pick(row, c_out_amt) if c_out_amt else ""
            currency = (_pick(row, c_out_cur) if c_out_cur else "").upper()
            # v2 COINAMOUNT carries the symbol inline (e.g. "-0.0026 BTC").
            if not currency:
                out_amount_raw, embedded = _split_amount_currency(out_amount_raw)
                currency = embedded
            out_amount = _to_float(out_amount_raw)
            in_amount = _to_float(_pick(row, c_in_amt)) if c_in_amt else 0.0
            orderid = _pick(row, c_orderid) if c_orderid else ""
            cls = _classify_type(tx_type)

            # An external send: money left, nothing came in on the same row, it's
            # not part of an exchange (ORDERID/INAMOUNT empty), and the type is a
            # withdrawal/send (or untyped). Skips deposits, swaps, staking, fails.
            is_outgoing = (
                out_amount != 0
                and in_amount == 0
                and not orderid
                and cls in ("withdrawal", "unknown")
            )
            if not is_outgoing:
                continue

            when = _parse_date(_pick(row, c_date)) if c_date else None
            if when is None:
                if verbose:
                    print(f"  ! skipping row with unparseable date in {os.path.basename(path)}")
                continue

            payments.append(Payment(
                when=when,
                currency=currency,
                amount=abs(out_amount),
                fee=abs(_to_float(_pick(row, c_fee_amt))) if c_fee_amt else 0.0,
                fee_currency=(_pick(row, c_fee_cur) if c_fee_cur else "").upper(),
                txid=_pick(row, c_txid) if c_txid else "",
                tx_url=_pick(row, c_txurl) if c_txurl else "",
                note=_pick(row, c_note) if c_note else "",
            ))
    if verbose:
        print(f"  parsed {len(payments)} outgoing payment(s) from {os.path.basename(path)}")
    return payments


def collect_payments(cfg: dict, explicit_csv: Optional[str], verbose: bool) -> list[Payment]:
    if explicit_csv:
        paths = [explicit_csv]
    else:
        input_dir = os.path.join(REPO_ROOT, cfg["csv"]["input_dir"])
        paths = sorted(glob.glob(os.path.join(input_dir, "*.csv")))
    if not paths:
        print("No CSV files found to reconcile. Export from Exodus and drop the "
              f"file into {cfg['csv']['input_dir']}/ then run again.")
        return []

    merged: dict[str, Payment] = {}
    for path in paths:
        for p in parse_exodus_csv(path, verbose=verbose):
            merged[p.key] = p     # later files win; de-dups across full-history exports

    payments = list(merged.values())

    # Apply filters from config.
    rc = cfg.get("reconcile", {})
    start_raw = rc.get("start_date")
    start = _parse_date(start_raw) if start_raw else None
    ignore = {c.upper() for c in rc.get("ignore_currencies", [])}
    if start:
        payments = [p for p in payments if p.when >= start]
    if ignore:
        payments = [p for p in payments if p.currency not in ignore]
    payments.sort(key=lambda p: p.when)
    return payments


# --------------------------------------------------------------------------- #
# Pricing (crypto -> USD at the payment date)
# --------------------------------------------------------------------------- #
class Pricer:
    def __init__(self, cfg: dict, session: requests.Session):
        self.cfg = cfg["currency"]
        self.session = session
        self.base = self.cfg["coingecko_api_base"].rstrip("/")
        self.stable = {s.upper() for s in self.cfg.get("stablecoins", [])}
        self.ids = {k.upper(): v for k, v in self.cfg.get("coingecko_ids", {}).items()}
        self.api_key = os.environ.get("COINGECKO_API_KEY", "").strip()
        self._cache: dict[tuple[str, str], Optional[float]] = {}
        self._symbol_list: Optional[dict[str, str]] = None
        self.warnings: list[str] = []

    def _headers(self) -> dict:
        if self.api_key:
            # Works for both Demo (x-cg-demo-api-key) and Pro keys; CoinGecko
            # accepts the demo header on the public host.
            return {"x-cg-demo-api-key": self.api_key}
        return {}

    def _resolve_id(self, symbol: str) -> Optional[str]:
        if symbol in self.ids:
            return self.ids[symbol]
        # Fall back to the full coin list, matching by ticker symbol.
        if self._symbol_list is None:
            self._symbol_list = {}
            try:
                r = self.session.get(f"{self.base}/coins/list", headers=self._headers(), timeout=30)
                if r.ok:
                    for coin in r.json():
                        sym = str(coin.get("symbol", "")).upper()
                        # Keep the first id we see for each symbol (usually canonical).
                        self._symbol_list.setdefault(sym, coin.get("id"))
            except requests.RequestException:
                pass
        return self._symbol_list.get(symbol)

    def usd(self, symbol: str, when: date) -> Optional[float]:
        symbol = (symbol or "").upper()
        if not symbol:
            return None
        if symbol in self.stable:
            return 1.0
        ck = (symbol, when.isoformat())
        if ck in self._cache:
            return self._cache[ck]

        coin_id = self._resolve_id(symbol)
        if not coin_id:
            self.warnings.append(f"no CoinGecko id for {symbol}")
            self._cache[ck] = None
            return None

        url = f"{self.base}/coins/{coin_id}/history"
        params = {"date": when.strftime("%d-%m-%Y"), "localization": "false"}
        price = self._get_price(url, params)
        self._cache[ck] = price
        if price is None:
            self.warnings.append(f"no price for {symbol} on {when.isoformat()}")
        return price

    def _get_price(self, url: str, params: dict) -> Optional[float]:
        for attempt in range(5):
            try:
                r = self.session.get(url, params=params, headers=self._headers(), timeout=30)
            except requests.RequestException:
                time.sleep(2 * (attempt + 1))
                continue
            if r.status_code == 429:
                wait = float(r.headers.get("Retry-After", 8 * (attempt + 1)))
                time.sleep(min(wait, 30))         # respect rate limit, back off
                continue
            if not r.ok:
                return None
            try:
                data = r.json()
            except ValueError:
                return None
            # market_data may be absent (e.g. date before the coin was listed).
            return (data.get("market_data") or {}).get("current_price", {}).get("usd")
        return None


def price_payments(payments: list[Payment], pricer: Pricer, verbose: bool) -> None:
    for p in payments:
        p.usd = pricer.usd(p.currency, p.when)
        if verbose and p.usd is not None:
            print(f"  {p.when} {p.amount:.8f} {p.currency} = ${p.usd * p.amount:,.2f}")


# --------------------------------------------------------------------------- #
# Notion REST helpers
# --------------------------------------------------------------------------- #
class Notion:
    def __init__(self, token: str, version: str, session: requests.Session):
        self.session = session
        self.headers = {
            "Authorization": f"Bearer {token}",
            "Notion-Version": version,
            "Content-Type": "application/json",
        }

    def _request(self, method: str, url: str, what: str, **kwargs) -> dict:
        """One request with 429/5xx retry (Notion allows ~3 req/s)."""
        for attempt in range(5):
            r = self.session.request(method, url, headers=self.headers, timeout=60, **kwargs)
            if r.status_code == 429:
                wait = float(r.headers.get("Retry-After", 2 * (attempt + 1)))
                time.sleep(min(wait, 30))
                continue
            if r.status_code >= 500:
                time.sleep(2 * (attempt + 1))
                continue
            if not r.ok:
                raise RuntimeError(f"Notion {what} failed ({r.status_code}): {r.text[:400]}")
            return r.json()
        raise RuntimeError(f"Notion {what} failed after retries (rate limited or server error)")

    def query_all(self, database_id: str) -> list[dict]:
        results: list[dict] = []
        cursor: Optional[str] = None
        while True:
            body: dict = {"page_size": 100}
            if cursor:
                body["start_cursor"] = cursor
            data = self._request(
                "POST", f"{NOTION_BASE}/databases/{database_id}/query",
                "query", json=body,
            )
            results.extend(data.get("results", []))
            if data.get("has_more"):
                cursor = data.get("next_cursor")
            else:
                break
        return results

    def create_page(self, database_id: str, properties: dict) -> dict:
        return self._request(
            "POST", f"{NOTION_BASE}/pages", "create",
            json={"parent": {"database_id": database_id}, "properties": properties},
        )

    def update_properties(self, page_id: str, properties: dict) -> dict:
        return self._request(
            "PATCH", f"{NOTION_BASE}/pages/{page_id}", "update",
            json={"properties": properties},
        )


def prop_number(page: dict, name: str) -> Optional[float]:
    p = page.get("properties", {}).get(name) or {}
    return p.get("number")


def prop_date(page: dict, name: str) -> Optional[date]:
    p = page.get("properties", {}).get(name) or {}
    d = p.get("date") or {}
    start = d.get("start")
    if not start:
        return None
    return _parse_date(start)


def prop_title(page: dict, name: str) -> str:
    p = page.get("properties", {}).get(name) or {}
    return "".join(t.get("plain_text", "") for t in p.get("title", []))


def prop_rich_text(page: dict, name: str) -> str:
    p = page.get("properties", {}).get(name) or {}
    return "".join(t.get("plain_text", "") for t in p.get("rich_text", []))


def prop_select(page: dict, name: str) -> str:
    p = page.get("properties", {}).get(name) or {}
    sel = p.get("select") or {}
    return sel.get("name", "")


# --------------------------------------------------------------------------- #
# Reconciliation logic
# --------------------------------------------------------------------------- #
def extract_tracker_rows(pages: list[dict], props: dict) -> list[TrackerRow]:
    rows: list[TrackerRow] = []
    for pg in pages:
        amount = prop_number(pg, props["amount"])
        if amount is None:
            continue
        rows.append(TrackerRow(
            when=prop_date(pg, props["date"]),
            amount_usd=float(amount),
            title=prop_title(pg, props["title"]),
            url=pg.get("url", ""),
        ))
    return rows


def _amount_matches(payment_usd: float, row_usd: float, m: dict) -> bool:
    diff = abs(payment_usd - row_usd)
    if diff <= m["amount_abs_tolerance_usd"]:
        return True
    if payment_usd > 0 and diff / payment_usd <= m["amount_rel_tolerance"]:
        return True
    return False


def reconcile(payments: list[Payment], rows: list[TrackerRow], cfg: dict) -> list[Problem]:
    m = cfg["matching"]
    min_usd = cfg.get("reconcile", {}).get("min_payment_usd", 0.0)
    window = timedelta(days=m["date_window_days"])
    tight = timedelta(days=m["tight_date_window_days"])
    problems: list[Problem] = []

    dated_rows = [r for r in rows if r.when is not None]

    for p in payments:
        if p.usd is None:
            # Could not price it; cannot compare to a USD tracker. Report softly.
            problems.append(Problem(
                kind="Untracked Payment", key=p.key,
                title=f"Unpriced {p.amount:g} {p.currency} payment on {p.when.isoformat()}",
                amount_usd=0.0, when=p.when,
                details=(f"Sent {p.amount:g} {p.currency} but could not fetch its USD "
                         f"value to compare against the tracker. Check it manually."),
                exodus_amount=p.amount, currency=p.currency, tx_url=p.tx_url,
            ))
            continue

        payment_usd = p.usd * p.amount
        if payment_usd < min_usd:
            continue

        in_window = [r for r in dated_rows if abs((r.when - p.when).days) <= window.days]
        if any(_amount_matches(payment_usd, r.amount_usd, m) for r in in_window):
            continue  # tracked correctly

        near = [r for r in dated_rows if abs((r.when - p.when).days) <= tight.days]
        if len(near) == 1:
            row = near[0]
            problems.append(Problem(
                kind="Amount Mismatch", key=p.key,
                title=f"{p.currency} payment ${payment_usd:,.2f} logged as ${row.amount_usd:,.2f}",
                amount_usd=payment_usd, when=p.when, tracked_usd=row.amount_usd,
                details=(f"Sent {p.amount:g} {p.currency} (~${payment_usd:,.2f}) on "
                         f"{p.when.isoformat()}, but the nearby tracker row "
                         f"\"{row.title or 'Untitled'}\" is ${row.amount_usd:,.2f} - "
                         f"off by ${abs(payment_usd - row.amount_usd):,.2f}."),
                exodus_amount=p.amount, currency=p.currency, tx_url=p.tx_url,
            ))
        else:
            problems.append(Problem(
                kind="Untracked Payment", key=p.key,
                title=f"Untracked ${payment_usd:,.2f} {p.currency} payment on {p.when.isoformat()}",
                amount_usd=payment_usd, when=p.when,
                details=(f"Sent {p.amount:g} {p.currency} (~${payment_usd:,.2f}) on "
                         f"{p.when.isoformat()}" + (f' - note: "{p.note}"' if p.note else "")
                         + ". No matching row found in Total Costs."),
                exodus_amount=p.amount, currency=p.currency, tx_url=p.tx_url,
            ))
    return problems


def period_gaps(payments: list[Payment], rows: list[TrackerRow], cfg: dict) -> list[Problem]:
    pc = cfg.get("period_check", {})
    if not pc.get("enabled"):
        return []
    out_by_month: dict[str, float] = defaultdict(float)
    for p in payments:
        if p.usd is None:
            continue
        out_by_month[p.when.strftime("%Y-%m")] += p.usd * p.amount
    tracked_by_month: dict[str, float] = defaultdict(float)
    for r in rows:
        if r.when is None:
            continue
        tracked_by_month[r.when.strftime("%Y-%m")] += r.amount_usd

    problems: list[Problem] = []
    for month, out_usd in sorted(out_by_month.items()):
        tracked = tracked_by_month.get(month, 0.0)
        gap = out_usd - tracked
        if gap <= 0:
            continue
        if gap < pc["gap_abs_threshold_usd"]:
            continue
        if out_usd > 0 and gap / out_usd < pc["gap_rel_threshold"]:
            continue
        problems.append(Problem(
            kind="Period Gap", key=f"PERIOD-{month}",
            title=f"{month}: ${gap:,.2f} more left Exodus than is tracked",
            amount_usd=out_usd, when=_month_last_day(month), tracked_usd=tracked,
            details=(f"In {month}, ${out_usd:,.2f} of payments left Exodus but only "
                     f"${tracked:,.2f} is logged in Total Costs - a ${gap:,.2f} gap. "
                     f"Some payments this month may be missing or under-recorded."),
        ))
    return problems


def _month_last_day(month: str) -> date:
    y, mo = (int(x) for x in month.split("-"))
    if mo == 12:
        return date(y, 12, 31)
    return date(y, mo + 1, 1) - timedelta(days=1)


# --------------------------------------------------------------------------- #
# Alert writing (with de-dup + auto-resolve)
# --------------------------------------------------------------------------- #
def _txt(value: str) -> dict:
    return {"rich_text": [{"text": {"content": value[:2000]}}]} if value else {"rich_text": []}


def build_alert_properties(prob: Problem) -> dict:
    props: dict = {
        "Alert": {"title": [{"text": {"content": prob.title[:2000]}}]},
        "Type": {"select": {"name": prob.kind}},
        "Status": {"select": {"name": "Open"}},
        "Tx ID": _txt(prob.key),
        "Details": _txt(prob.details),
        "Currency": _txt(prob.currency),
    }
    if prob.amount_usd is not None:
        props["Amount (USD)"] = {"number": round(prob.amount_usd, 2)}
    if prob.tracked_usd is not None:
        props["Tracked (USD)"] = {"number": round(prob.tracked_usd, 2)}
    if prob.exodus_amount is not None:
        props["Exodus Amount"] = {"number": prob.exodus_amount}
    if prob.when is not None:
        props["Date"] = {"date": {"start": prob.when.isoformat()}}
    if prob.tx_url:
        props["Tx Link"] = {"url": prob.tx_url}
    return props


def write_alerts(notion: Notion, alerts_db: str, problems: list[Problem],
                 resolvable_keys: set[str], dry_run: bool, verbose: bool) -> dict:
    """Create new alerts, skip duplicates, auto-resolve fixed ones."""
    existing_pages = notion.query_all(alerts_db)
    existing: dict[tuple[str, str], dict] = {}
    for pg in existing_pages:
        key = prop_rich_text(pg, "Tx ID")
        kind = prop_select(pg, "Type")
        if key:
            existing[(key, kind)] = pg

    problem_keys = {(p.key, p.kind) for p in problems}
    created = skipped = resolved = 0

    for prob in problems:
        ident = (prob.key, prob.kind)
        if ident in existing:
            status = prop_select(existing[ident], "Status")
            skipped += 1
            if verbose:
                print(f"  = already alerted ({status}): {prob.title}")
            continue
        if dry_run:
            print(f"  + WOULD CREATE [{prob.kind}] {prob.title}")
            created += 1
            continue
        notion.create_page(alerts_db, build_alert_properties(prob))
        created += 1
        print(f"  + alert: [{prob.kind}] {prob.title}")

    # Auto-resolve: an Open per-payment alert whose payment now reconciles.
    for (key, kind), pg in existing.items():
        if kind == "Period Gap":
            continue
        if prop_select(pg, "Status") != "Open":
            continue
        still_a_problem = (key, kind) in problem_keys
        if still_a_problem:
            continue
        if key not in resolvable_keys:
            continue  # payment not seen this run; leave the alert alone
        if dry_run:
            print(f"  ~ WOULD RESOLVE: {prop_title(pg, 'Alert')}")
            resolved += 1
            continue
        notion.update_properties(pg["id"], {"Status": {"select": {"name": "Resolved"}}})
        resolved += 1
        print(f"  ~ resolved: {prop_title(pg, 'Alert')}")

    return {"created": created, "skipped": skipped, "resolved": resolved}


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def main() -> int:
    ap = argparse.ArgumentParser(description="Reconcile Exodus payments against the Notion Total Costs tracker.")
    ap.add_argument("--config", default=DEFAULT_CONFIG, help="Path to config.json")
    ap.add_argument("--csv", help="Reconcile one specific CSV file instead of the watched folder")
    ap.add_argument("--dry-run", action="store_true", help="Report only; write nothing to Notion")
    ap.add_argument("--verbose", action="store_true", help="Verbose output")
    args = ap.parse_args()

    cfg = load_config(args.config)
    session = requests.Session()

    print("Exodus -> Notion cost reconciler")
    print("=" * 40)

    payments = collect_payments(cfg, args.csv, args.verbose)
    if not payments:
        return 0
    print(f"Outgoing payments found: {len(payments)}")

    pricer = Pricer(cfg, session)
    price_payments(payments, pricer, args.verbose)
    priced = sum(1 for p in payments if p.usd is not None)
    total_out = sum(p.usd * p.amount for p in payments if p.usd is not None)
    print(f"Priced {priced}/{len(payments)} payments  (~${total_out:,.2f} total outflow)")
    for w in pricer.warnings:
        print(f"  ! {w}")

    token = require_token()
    notion = Notion(token, cfg["notion"]["api_version"], session)
    try:
        cost_pages = notion.query_all(cfg["notion"]["total_costs_database_id"])
    except RuntimeError as exc:
        sys.exit(
            f"{exc}\n\nMost likely the Notion integration has not been granted "
            "access to the Total Costs database. Open the database in Notion -> "
            "'...' menu -> Connections -> add your integration."
        )
    tracker_rows = extract_tracker_rows(cost_pages, cfg["total_costs_properties"])
    print(f"Total Costs rows loaded: {len(tracker_rows)}")

    problems = reconcile(payments, tracker_rows, cfg)
    problems += period_gaps(payments, tracker_rows, cfg)

    by_kind: dict[str, int] = defaultdict(int)
    for p in problems:
        by_kind[p.kind] += 1
    if problems:
        breakdown = ", ".join(f"{k}={v}" for k, v in sorted(by_kind.items()))
        print(f"Discrepancies: {len(problems)}  ({breakdown})")
    else:
        print("Discrepancies: 0 - everything reconciles ✔")

    resolvable_keys = {p.key for p in payments}
    stats = write_alerts(
        notion, cfg["notion"]["alerts_database_id"], problems,
        resolvable_keys, args.dry_run, args.verbose,
    )
    print("-" * 40)
    print(f"Alerts created: {stats['created']}  "
          f"already-known: {stats['skipped']}  auto-resolved: {stats['resolved']}"
          + ("   (dry run - nothing written)" if args.dry_run else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
