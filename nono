#!/usr/bin/env python3
"""REPEL Marketing — per-model Instagram reel-plan bot (single-file build).

Each model gets her own "program": her Instagram handle, a few competitor
handles to watch, her niche, and the tone she posts in. Every week the bot:

  1. (optional) scrapes her competitors + her own profile via Apify,
  2. feeds that to Claude, which writes a 14-reel plan — each reel has a
     concept, an inspiration link, an on-screen hook, a full caption, shoot
     instructions and an audio idea,
  3. sends YOU (the owner) the draft to approve or regenerate,
  4. on approval, delivers the reels to the model as tap-to-track cards and
     writes a full Notion page for reference.

It runs automatically every Monday, and you can also trigger it by hand.

Quick start
-----------
  1. @BotFather -> /newbot -> copy the token.
  2. Set these as environment variables (or in a .env file next to this script):
         BOT_TOKEN=123456:abc...        (from @BotFather)
         OWNER_ID=                      (your numeric Telegram id; locks ownership)
         ANTHROPIC_API_KEY=sk-ant-...   (from console.anthropic.com)
         APIFY_TOKEN=apify_api_...       (optional — enables live scraping)
         NOTION_TOKEN=ntn_...            (optional — writes a Notion page per plan)
         NOTION_PARENT_PAGE_ID=...       (optional — the page plans live under)
         TZ_OFFSET=1                     (hours from UTC, for scheduling)
  3. pip install -r requirements.txt
  4. python marketing_bot.py
  5. Message the bot /start — the first person (or OWNER_ID) becomes the owner
     and can invite models and build their programs.
"""

from __future__ import annotations

import asyncio
import html
import json
import logging
import os
import re
import secrets
import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from enum import Enum
from typing import Iterator, Optional, Sequence

import httpx

from telegram import BotCommand, InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.error import Forbidden, TelegramError
from telegram.ext import (
    Application,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    ConversationHandler,
    MessageHandler,
    PicklePersistence,
    filters,
)

try:
    from dotenv import load_dotenv
except ImportError:  # python-dotenv is optional
    def load_dotenv(*_args, **_kwargs):  # type: ignore
        return False

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s", level=logging.INFO)
log = logging.getLogger("repel-marketing")

# Runtime config kept in a module global, NOT in Application.bot_data:
# PicklePersistence replaces bot_data on startup, which would wipe it.
CONFIG = None


# =========================================================================== #
# Constants
# =========================================================================== #
class Role(str, Enum):
    OWNER = "owner"
    MODEL = "model"


class PlanStatus(str, Enum):
    DRAFT = "draft"        # generated, awaiting owner approval
    APPROVED = "approved"  # owner approved, delivered to model
    DISCARDED = "discarded"


class ReelStatus(str, Enum):
    TODO = "todo"
    SHOT = "shot"


ROLE_LABELS = {Role.OWNER.value: "Owner", Role.MODEL.value: "Model"}
SKIP_WORDS = {"skip", "-", "none", "no", "n/a", "na"}
DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


# =========================================================================== #
# Configuration
# =========================================================================== #
@dataclass(frozen=True)
class Config:
    bot_token: str
    owner_id: int
    db_path: str
    state_path: str
    anthropic_api_key: str
    anthropic_model: str
    apify_token: str
    apify_actor: str
    apify_reel_actor: str
    apify_hashtag_actor: str
    notion_token: str
    notion_parent_page_id: str
    tz_offset: int
    reels_per_week: int
    alternates_count: int
    gen_weekday: int   # 0=Monday .. 6=Sunday
    gen_hour: int      # local hour (0-23) to auto-generate


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)).strip() or default)
    except ValueError:
        return default


def load_config() -> Config:
    load_dotenv()
    token = os.getenv("BOT_TOKEN", "").strip()
    if not token:
        raise RuntimeError(
            "BOT_TOKEN is not set. Put BOT_TOKEN=... (from @BotFather) in a .env "
            "file next to this script, or set it as an environment variable.")
    owner_raw = os.getenv("OWNER_ID", "").strip()
    try:
        owner_id = int(owner_raw) if owner_raw else 0
    except ValueError as exc:
        raise RuntimeError("OWNER_ID must be a numeric Telegram user id.") from exc

    gen_weekday = _int_env("GEN_WEEKDAY", 0)          # Monday
    gen_weekday = gen_weekday if 0 <= gen_weekday <= 6 else 0
    gen_hour = _int_env("GEN_HOUR", 7)                # 7am local
    gen_hour = gen_hour if 0 <= gen_hour <= 23 else 7
    reels = _int_env("REELS_PER_WEEK", 14)
    reels = reels if 1 <= reels <= 40 else 14
    alternates = _int_env("ALTERNATES", 16)
    alternates = alternates if 0 <= alternates <= 40 else 16

    return Config(
        bot_token=token,
        owner_id=owner_id,
        db_path=os.getenv("DB_PATH", "marketing.db").strip() or "marketing.db",
        state_path=os.getenv("STATE_PATH", "marketing_state.pickle").strip() or "marketing_state.pickle",
        anthropic_api_key=os.getenv("ANTHROPIC_API_KEY", "").strip(),
        anthropic_model=os.getenv("ANTHROPIC_MODEL", "claude-opus-4-8").strip() or "claude-opus-4-8",
        apify_token=os.getenv("APIFY_TOKEN", "").strip(),
        apify_actor=os.getenv("APIFY_ACTOR", "apify~instagram-scraper").strip() or "apify~instagram-scraper",
        apify_reel_actor=os.getenv("APIFY_REEL_ACTOR", "apify~instagram-reel-scraper").strip()
            or "apify~instagram-reel-scraper",
        apify_hashtag_actor=os.getenv("APIFY_HASHTAG_ACTOR", "apify~instagram-hashtag-scraper").strip()
            or "apify~instagram-hashtag-scraper",
        notion_token=os.getenv("NOTION_TOKEN", "").strip(),
        notion_parent_page_id=os.getenv("NOTION_PARENT_PAGE_ID", "").strip(),
        tz_offset=_int_env("TZ_OFFSET", 0),
        reels_per_week=reels,
        alternates_count=alternates,
        gen_weekday=gen_weekday,
        gen_hour=gen_hour,
    )


def _tz() -> timezone:
    return timezone(timedelta(hours=CONFIG.tz_offset if CONFIG else 0))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _week_start(d: date) -> str:
    """Monday of the week containing d, as ISO date string."""
    return (d - timedelta(days=d.weekday())).isoformat()


def anthropic_enabled() -> bool:
    return bool(CONFIG and CONFIG.anthropic_api_key)


def apify_enabled() -> bool:
    return bool(CONFIG and CONFIG.apify_token)


# =========================================================================== #
# Database (SQLite)
# =========================================================================== #
_DB_PATH = "marketing.db"


def db_configure(path: str) -> None:
    global _DB_PATH
    _DB_PATH = path


@contextmanager
def _conn() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    telegram_id  INTEGER PRIMARY KEY,
    role         TEXT    NOT NULL,
    display_name TEXT    NOT NULL,
    username     TEXT,
    is_active    INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT    NOT NULL
);
CREATE TABLE IF NOT EXISTS invites (
    code        TEXT PRIMARY KEY,
    role        TEXT NOT NULL,
    label       TEXT,
    created_by  INTEGER NOT NULL,
    used_by     INTEGER,
    created_at  TEXT NOT NULL,
    used_at     TEXT
);
CREATE TABLE IF NOT EXISTS programs (
    model_id      INTEGER PRIMARY KEY,
    ig_handle     TEXT,
    competitors   TEXT,            -- JSON list of handles
    niche         TEXT,
    tone          TEXT,
    reels_per_week INTEGER,
    is_active     INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS plans (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    model_id      INTEGER NOT NULL,
    week_start    TEXT    NOT NULL,
    theme         TEXT,
    status        TEXT    NOT NULL,
    notion_page_id TEXT,
    notion_url    TEXT,
    created_by    INTEGER,
    created_at    TEXT    NOT NULL,
    updated_at    TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plans_model ON plans(model_id);
CREATE TABLE IF NOT EXISTS reels (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id       INTEGER NOT NULL,
    idx           INTEGER NOT NULL,
    day_label     TEXT,
    concept       TEXT,
    why           TEXT,
    inspiration   TEXT,
    reference_url TEXT,
    thumbnail_url TEXT,
    hook          TEXT,
    caption       TEXT,
    hashtags      TEXT,
    shoot         TEXT,
    audio         TEXT,
    kind          TEXT NOT NULL DEFAULT 'week',   -- week | swap
    status        TEXT NOT NULL DEFAULT 'todo',
    created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reels_plan ON reels(plan_id);
CREATE TABLE IF NOT EXISTS candidates (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    model_id    INTEGER NOT NULL,
    handle      TEXT    NOT NULL,
    reason      TEXT,
    status      TEXT    NOT NULL DEFAULT 'proposed',  -- proposed | approved | rejected
    created_at  TEXT    NOT NULL,
    decided_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_candidates_model ON candidates(model_id);
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
);
"""


def init_db() -> None:
    with _conn() as c:
        c.executescript(SCHEMA)
        # Migrate DBs created before newer columns existed (the /data volume persists).
        cols = [row[1] for row in c.execute("PRAGMA table_info(reels)").fetchall()]
        for col in ("reference_url", "thumbnail_url", "hashtags", "why"):
            if col not in cols:
                c.execute(f"ALTER TABLE reels ADD COLUMN {col} TEXT")
        if "kind" not in cols:
            c.execute("ALTER TABLE reels ADD COLUMN kind TEXT NOT NULL DEFAULT 'week'")
        pcols = [row[1] for row in c.execute("PRAGMA table_info(plans)").fetchall()]
        if "notion_url" not in pcols:
            c.execute("ALTER TABLE plans ADD COLUMN notion_url TEXT")


def get_setting(key: str) -> Optional[str]:
    with _conn() as c:
        row = c.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else None


def set_setting(key: str, value: str) -> None:
    with _conn() as c:
        c.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (key, value))


# --- users -------------------------------------------------------------------
def create_user(telegram_id: int, role: str, display_name: str, username: Optional[str]) -> None:
    now = _now()
    with _conn() as c:
        c.execute(
            "INSERT OR IGNORE INTO users (telegram_id, role, display_name, username, "
            "is_active, created_at) VALUES (?, ?, ?, ?, 1, ?)",
            (telegram_id, role, display_name, username, now))
        c.execute(
            "UPDATE users SET role = ?, display_name = ?, username = ?, is_active = 1 "
            "WHERE telegram_id = ?",
            (role, display_name, username, telegram_id))


def touch_user(telegram_id: int, display_name: str, username: Optional[str]) -> None:
    with _conn() as c:
        c.execute("UPDATE users SET display_name = ?, username = ? WHERE telegram_id = ?",
                  (display_name, username, telegram_id))


def set_role(telegram_id: int, role: str) -> None:
    with _conn() as c:
        c.execute("UPDATE users SET role = ? WHERE telegram_id = ?", (role, telegram_id))


def set_active(telegram_id: int, active: bool) -> None:
    with _conn() as c:
        c.execute("UPDATE users SET is_active = ? WHERE telegram_id = ?",
                  (1 if active else 0, telegram_id))


def get_user(telegram_id: int) -> Optional[sqlite3.Row]:
    with _conn() as c:
        return c.execute("SELECT * FROM users WHERE telegram_id = ?", (telegram_id,)).fetchone()


def count_users() -> int:
    with _conn() as c:
        return int(c.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"])


def list_by_role(role: str, active_only: bool = True) -> list[sqlite3.Row]:
    query = "SELECT * FROM users WHERE role = ?"
    if active_only:
        query += " AND is_active = 1"
    query += " ORDER BY display_name COLLATE NOCASE"
    with _conn() as c:
        return list(c.execute(query, [role]).fetchall())


# --- invites -----------------------------------------------------------------
def create_invite(role: str, created_by: int) -> str:
    code = secrets.token_urlsafe(8)
    with _conn() as c:
        c.execute(
            "INSERT INTO invites (code, role, label, created_by, created_at) VALUES (?, ?, ?, ?, ?)",
            (code, role, None, created_by, _now()))
    return code


def get_invite(code: str) -> Optional[sqlite3.Row]:
    with _conn() as c:
        return c.execute("SELECT * FROM invites WHERE code = ?", (code,)).fetchone()


def consume_invite(code: str, used_by: int) -> bool:
    with _conn() as c:
        cur = c.execute(
            "UPDATE invites SET used_by = ?, used_at = ? WHERE code = ? AND used_by IS NULL",
            (used_by, _now(), code))
        return cur.rowcount == 1


# --- programs ----------------------------------------------------------------
def upsert_program(model_id: int, **fields) -> None:
    now = _now()
    existing = get_program(model_id)
    if existing is None:
        with _conn() as c:
            c.execute(
                "INSERT INTO programs (model_id, ig_handle, competitors, niche, tone, "
                "reels_per_week, is_active, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)",
                (model_id, fields.get("ig_handle"), fields.get("competitors"),
                 fields.get("niche"), fields.get("tone"),
                 fields.get("reels_per_week", CONFIG.reels_per_week if CONFIG else 14),
                 now, now))
        return
    if not fields:
        return
    fields["updated_at"] = now
    cols = ", ".join(f"{k} = ?" for k in fields)
    vals = list(fields.values()) + [model_id]
    with _conn() as c:
        c.execute(f"UPDATE programs SET {cols} WHERE model_id = ?", vals)


def get_program(model_id: int) -> Optional[sqlite3.Row]:
    with _conn() as c:
        return c.execute("SELECT * FROM programs WHERE model_id = ?", (model_id,)).fetchone()


def list_active_programs() -> list[sqlite3.Row]:
    with _conn() as c:
        return list(c.execute(
            "SELECT * FROM programs WHERE is_active = 1 ORDER BY model_id").fetchall())


def program_competitors(program: sqlite3.Row) -> list[str]:
    raw = program["competitors"] if program and "competitors" in program.keys() else None
    if not raw:
        return []
    try:
        data = json.loads(raw)
        return [str(x) for x in data] if isinstance(data, list) else []
    except (ValueError, TypeError):
        return []


def add_competitor(model_id: int, handle: str) -> bool:
    """Append a handle to a model's watch-list (de-duped). Returns True if added."""
    prog = get_program(model_id)
    if prog is None:
        return False
    comps = program_competitors(prog)
    if handle.lower() in {c.lower() for c in comps}:
        return False
    comps.append(handle)
    upsert_program(model_id, competitors=json.dumps(comps))
    return True


# --- candidate accounts (auto-discovery) ------------------------------------
def create_candidate(model_id: int, handle: str, reason: str) -> Optional[int]:
    """Insert a proposed candidate, unless one with this handle was already seen."""
    with _conn() as c:
        dup = c.execute(
            "SELECT 1 FROM candidates WHERE model_id = ? AND lower(handle) = ? LIMIT 1",
            (model_id, handle.lower())).fetchone()
        if dup:
            return None
        cur = c.execute(
            "INSERT INTO candidates (model_id, handle, reason, status, created_at) "
            "VALUES (?, ?, ?, 'proposed', ?)",
            (model_id, handle, reason, _now()))
        return int(cur.lastrowid)


def get_candidate(candidate_id: int) -> Optional[sqlite3.Row]:
    with _conn() as c:
        return c.execute("SELECT * FROM candidates WHERE id = ?", (candidate_id,)).fetchone()


def set_candidate_status(candidate_id: int, status: str) -> None:
    with _conn() as c:
        c.execute("UPDATE candidates SET status = ?, decided_at = ? WHERE id = ?",
                  (status, _now(), candidate_id))


def list_seen_handles(model_id: int) -> set[str]:
    """Lower-cased handles already proposed/approved/rejected for this model."""
    with _conn() as c:
        rows = c.execute("SELECT handle FROM candidates WHERE model_id = ?", (model_id,)).fetchall()
    return {r["handle"].lower() for r in rows}


# --- plans & reels -----------------------------------------------------------
def create_plan(model_id: int, week_start: str, theme: str, created_by: int) -> int:
    now = _now()
    with _conn() as c:
        cur = c.execute(
            "INSERT INTO plans (model_id, week_start, theme, status, created_by, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (model_id, week_start, theme, PlanStatus.DRAFT.value, created_by, now, now))
        return int(cur.lastrowid)


def add_reel(plan_id: int, idx: int, **fields) -> int:
    with _conn() as c:
        cur = c.execute(
            "INSERT INTO reels (plan_id, idx, day_label, concept, why, inspiration, reference_url, "
            "thumbnail_url, hook, caption, hashtags, shoot, audio, kind, status, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'todo', ?)",
            (plan_id, idx, fields.get("day_label"), fields.get("concept"), fields.get("why"),
             fields.get("inspiration"), fields.get("reference_url"), fields.get("thumbnail_url"),
             fields.get("hook"), fields.get("caption"), fields.get("hashtags"),
             fields.get("shoot"), fields.get("audio"), fields.get("kind", "week"), _now()))
        return int(cur.lastrowid)


def get_plan(plan_id: int) -> Optional[sqlite3.Row]:
    with _conn() as c:
        return c.execute("SELECT * FROM plans WHERE id = ?", (plan_id,)).fetchone()


def update_plan(plan_id: int, **fields) -> None:
    if not fields:
        return
    fields["updated_at"] = _now()
    cols = ", ".join(f"{k} = ?" for k in fields)
    vals = list(fields.values()) + [plan_id]
    with _conn() as c:
        c.execute(f"UPDATE plans SET {cols} WHERE id = ?", vals)


def list_reels(plan_id: int) -> list[sqlite3.Row]:
    with _conn() as c:
        return list(c.execute(
            "SELECT * FROM reels WHERE plan_id = ? ORDER BY idx", (plan_id,)).fetchall())


def get_reel(reel_id: int) -> Optional[sqlite3.Row]:
    with _conn() as c:
        return c.execute("SELECT * FROM reels WHERE id = ?", (reel_id,)).fetchone()


def set_reel_status(reel_id: int, status: str) -> None:
    with _conn() as c:
        c.execute("UPDATE reels SET status = ? WHERE id = ?", (status, reel_id))


def latest_plan_for_model(model_id: int, status: Optional[str] = None) -> Optional[sqlite3.Row]:
    q = "SELECT * FROM plans WHERE model_id = ?"
    params: list = [model_id]
    if status:
        q += " AND status = ?"
        params.append(status)
    q += " ORDER BY id DESC LIMIT 1"
    with _conn() as c:
        return c.execute(q, params).fetchone()


def plan_exists_for_week(model_id: int, week_start: str) -> bool:
    with _conn() as c:
        row = c.execute(
            "SELECT 1 FROM plans WHERE model_id = ? AND week_start = ? "
            "AND status != ? LIMIT 1",
            (model_id, week_start, PlanStatus.DISCARDED.value)).fetchone()
        return row is not None


# =========================================================================== #
# Inline keyboards
# =========================================================================== #
def _rows(buttons, per_row: int = 1):
    return [list(buttons[i:i + per_row]) for i in range(0, len(buttons), per_row)]


def owner_menu() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("✨ Generate content plan", callback_data="menu:generate")],
        [InlineKeyboardButton("🧩 Models & programs", callback_data="menu:programs")],
        [InlineKeyboardButton("➕ Invite a model", callback_data="owner:invite:model")],
    ])


def model_menu() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([[
        InlineKeyboardButton("🎬 My latest plan", callback_data="menu:myreels")]])


def menu_for(role: str):
    if role == Role.OWNER.value:
        return owner_menu()
    if role == Role.MODEL.value:
        return model_menu()
    return None


def model_picker(models, action: str) -> InlineKeyboardMarkup:
    buttons = [InlineKeyboardButton(m["display_name"], callback_data=f"{action}:{m['telegram_id']}")
               for m in models]
    rows = _rows(buttons, per_row=2)
    rows.append([InlineKeyboardButton("✖ Cancel", callback_data="flow:cancel")])
    return InlineKeyboardMarkup(rows)


def program_actions(model_id: int, has_program: bool) -> InlineKeyboardMarkup:
    rows = [[InlineKeyboardButton("📝 Set up / edit program", callback_data=f"prog:edit:{model_id}")]]
    if has_program:
        rows.append([InlineKeyboardButton("✨ Generate now", callback_data=f"gen:start:{model_id}")])
        rows.append([InlineKeyboardButton("🔎 Find new accounts", callback_data=f"disc:run:{model_id}")])
    rows.append([InlineKeyboardButton("⬅ Back", callback_data="menu:programs")])
    return InlineKeyboardMarkup(rows)


def plan_ready_keyboard(plan_id: int, page_url: Optional[str] = None) -> InlineKeyboardMarkup:
    rows = []
    if page_url:
        rows.append([InlineKeyboardButton("📄 Open plan", url=page_url)])
    rows.append([InlineKeyboardButton("📤 Send to model", callback_data=f"plan:send:{plan_id}"),
                 InlineKeyboardButton("🔄 Regenerate", callback_data=f"plan:regen:{plan_id}")])
    return InlineKeyboardMarkup(rows)


def reel_card_kb(reel_id: int, status: str) -> InlineKeyboardMarkup:
    if status == ReelStatus.SHOT.value:
        return InlineKeyboardMarkup([[
            InlineKeyboardButton("✅ Shot — undo?", callback_data=f"reel:undo:{reel_id}")]])
    return InlineKeyboardMarkup([[
        InlineKeyboardButton("📹 Mark as shot", callback_data=f"reel:shot:{reel_id}")]])


# =========================================================================== #
# Shared helpers
# =========================================================================== #
def role_of(telegram_id: int) -> Optional[str]:
    user = get_user(telegram_id)
    if user is None or not user["is_active"]:
        return None
    return user["role"]


def is_owner(telegram_id: int) -> bool:
    return role_of(telegram_id) == Role.OWNER.value


def display_name(update: Update) -> str:
    user = update.effective_user
    return (user.full_name or user.username or str(user.id)).strip()


def _name(telegram_id: int) -> str:
    user = get_user(telegram_id)
    return user["display_name"] if user else f"user {telegram_id}"


def _clean_handle(raw: str) -> str:
    return raw.strip().lstrip("@").strip().rstrip("/").split("/")[-1]


def parse_handles(text: str) -> list[str]:
    parts = re.split(r"[\s,]+", text or "")
    handles = []
    for p in parts:
        h = _clean_handle(p)
        if h and h.lower() not in SKIP_WORDS:
            handles.append(h)
    # de-dupe, keep order
    seen = set()
    out = []
    for h in handles:
        if h.lower() not in seen:
            seen.add(h.lower())
            out.append(h)
    return out


async def send(update: Update, context: ContextTypes.DEFAULT_TYPE, text: str, reply_markup=None):
    return await context.bot.send_message(
        chat_id=update.effective_chat.id, text=text, reply_markup=reply_markup,
        disable_web_page_preview=True)


def program_summary(program: Optional[sqlite3.Row], model_name: str) -> str:
    if program is None:
        return (f"{model_name} has no program yet.\n\n"
                "Set one up so I know her handle, who to watch, her niche and tone.")
    comps = program_competitors(program)
    lines = [f"📋 {model_name}'s program",
             f"• IG handle: @{program['ig_handle']}" if program["ig_handle"] else "• IG handle: —",
             f"• Watching: {', '.join('@'+c for c in comps) if comps else '—'}",
             f"• Niche: {program['niche'] or '—'}",
             f"• Tone: {program['tone'] or '—'}",
             f"• Reels/week: {program['reels_per_week'] or (CONFIG.reels_per_week if CONFIG else 14)}"]
    return "\n".join(lines)


# =========================================================================== #
# Onboarding: /start, /help, /cancel
# =========================================================================== #
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    tg_user = update.effective_user
    name = display_name(update)
    config = CONFIG
    existing = get_user(tg_user.id)

    if existing is None:
        await _register_new_user(update, context, name, config)
        return

    if config.owner_id and tg_user.id == config.owner_id and existing["role"] != Role.OWNER.value:
        set_role(tg_user.id, Role.OWNER.value)
        existing = get_user(tg_user.id)

    touch_user(tg_user.id, name, tg_user.username)
    if not existing["is_active"]:
        await send(update, context, "Your access has been turned off. Contact the agency owner.")
        return
    await _show_home(update, context, existing["role"], name)


async def _register_new_user(update, context, name, config) -> None:
    tg_user = update.effective_user
    args = context.args or []

    if (config.owner_id and tg_user.id == config.owner_id) or count_users() == 0:
        create_user(tg_user.id, Role.OWNER.value, name, tg_user.username)
        await send(
            update, context,
            f"👑 Welcome, {name}. You're set up as the owner of REPEL Marketing.\n\n"
            "Invite a model, build her program (handle, competitors, niche, tone), then "
            "generate her weekly content plan — by hand or automatically every week.",
            reply_markup=owner_menu())
        return

    if args:
        await _redeem_invite(update, context, args[0].strip(), name)
        return

    await send(
        update, context,
        "👋 Hi! This bot is invite-only.\n\nAsk the agency owner for your personal invite "
        "link, then tap it to get started.")


async def _redeem_invite(update, context, code: str, name: str) -> None:
    tg_user = update.effective_user
    invite = get_invite(code)
    if invite is None or invite["used_by"] is not None:
        await send(update, context,
                   "That invite link is invalid or already used. Ask the owner for a new one.")
        return
    if not consume_invite(code, tg_user.id):
        await send(update, context, "That invite link has just been used. Ask the owner for a new one.")
        return
    create_user(tg_user.id, invite["role"], name, tg_user.username)
    await _show_home(update, context, invite["role"], name,
                     prefix=f"✅ You're registered as a {ROLE_LABELS.get(invite['role'], invite['role'])}.\n\n")


async def _show_home(update, context, role: str, name: str, prefix: str = "") -> None:
    if role == Role.OWNER.value:
        body = "👑 Owner menu — generate plans, manage models, invite people."
    else:
        body = (f"Hi {name}! Each week you'll get a fresh content plan — ideas, references, "
                "shots and captions. Tap below to see your latest.")
    await send(update, context, prefix + body, reply_markup=menu_for(role))


async def help_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    role = role_of(update.effective_user.id)
    if role is None:
        await send(update, context, "You're not registered. Ask the agency owner for an invite link.")
        return
    if role == Role.OWNER.value:
        lines = ["You're the Owner.", "",
                 "/generate — make a content plan for a model",
                 "/discover — find fresh accounts to watch",
                 "/programs — set up models' programs",
                 "/invite — create a model invite link",
                 "/people — list everyone",
                 "/help — this help"]
    else:
        lines = ["You're a Model.", "",
                 "/myreels — your latest content plan",
                 "/help — this help"]
    await send(update, context, "\n".join(lines), reply_markup=menu_for(role))


async def cancel_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data.clear()
    role = role_of(update.effective_user.id)
    await send(update, context, "Okay, cancelled.", reply_markup=menu_for(role) if role else None)
    return ConversationHandler.END


# =========================================================================== #
# Owner: invites & people
# =========================================================================== #
async def _bot_username(context: ContextTypes.DEFAULT_TYPE) -> str:
    cached = context.bot_data.get("bot_username")
    if cached:
        return cached
    me = await context.bot.get_me()
    context.bot_data["bot_username"] = me.username
    return me.username


async def _owner_guard(update: Update, context: ContextTypes.DEFAULT_TYPE) -> bool:
    if is_owner(update.effective_user.id):
        return True
    if update.callback_query:
        await update.callback_query.answer("Owner only.", show_alert=True)
    else:
        await send(update, context, "That's for the agency owner only.")
    return False


async def _make_invite(update, context) -> None:
    code = create_invite(Role.MODEL.value, created_by=update.effective_user.id)
    username = await _bot_username(context)
    link = f"https://t.me/{username}?start={code}"
    await send(update, context,
               f"➕ One-time model invite created. Send her this link — it works once:\n{link}")


async def invite_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not await _owner_guard(update, context):
        return
    await _make_invite(update, context)


async def invite_cb(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.callback_query.answer()
    if not await _owner_guard(update, context):
        return
    await _make_invite(update, context)


async def people_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not await _owner_guard(update, context):
        return
    models = list_by_role(Role.MODEL.value, active_only=False)
    lines = [f"👥 Models ({sum(1 for m in models if m['is_active'])} active):"]
    if not models:
        lines.append("  — none yet")
    for m in models:
        tag = f" @{m['username']}" if m["username"] else ""
        status = "" if m["is_active"] else "  (inactive)"
        prog = "✓ program" if get_program(m["telegram_id"]) else "✗ no program"
        lines.append(f"  • {m['display_name']}{tag} — {prog}{status}")
    await send(update, context, "\n".join(lines), reply_markup=owner_menu())


# =========================================================================== #
# Owner: programs overview
# =========================================================================== #
async def programs_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not await _owner_guard(update, context):
        return
    await _show_programs(update, context)


async def _show_programs(update, context) -> None:
    models = list_by_role(Role.MODEL.value)
    if not models:
        await send(update, context,
                   "No models yet. Invite one first.", reply_markup=owner_menu())
        return
    await send(update, context, "Pick a model to view or set up her program:",
               reply_markup=model_picker(models, "prog:open"))


async def prog_open_cb(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    q = update.callback_query
    await q.answer()
    if not await _owner_guard(update, context):
        return
    model_id = int(q.data.split(":")[2])
    model = get_user(model_id)
    program = get_program(model_id)
    text = program_summary(program, model["display_name"] if model else f"#{model_id}")
    await q.edit_message_text(text, reply_markup=program_actions(model_id, program is not None))


async def programs_menu_cb(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.callback_query.answer()
    if not await _owner_guard(update, context):
        return
    await _show_programs(update, context)


# =========================================================================== #
# Owner: program setup wizard (conversation)
# =========================================================================== #
PROG_HANDLE, PROG_COMPETITORS, PROG_NICHE, PROG_TONE = range(4)


async def prog_edit_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    if not is_owner(update.effective_user.id):
        await q.answer("Owner only.", show_alert=True)
        return ConversationHandler.END
    model_id = int(q.data.split(":")[2])
    model = get_user(model_id)
    if model is None:
        await q.edit_message_text("That model is gone. Start again from the menu.")
        return ConversationHandler.END
    existing = get_program(model_id)
    context.user_data["prog"] = {"model_id": model_id, "model_name": model["display_name"]}
    cur = f"\n\nCurrent: @{existing['ig_handle']}" if existing and existing["ig_handle"] else ""
    await q.edit_message_text(
        f"Setting up {model['display_name']}'s program.\n\n"
        f"1/4 — What's her Instagram handle? (e.g. @yourmodel){cur}")
    return PROG_HANDLE


async def prog_handle(update: Update, context: ContextTypes.DEFAULT_TYPE):
    handle = _clean_handle(update.message.text or "")
    if not handle:
        await send(update, context, "Please send her Instagram handle, or /cancel.")
        return PROG_HANDLE
    context.user_data["prog"]["ig_handle"] = handle
    await send(update, context,
               "2/4 — Which competitors / creators in her niche should I watch?\n"
               "Send a few handles separated by spaces or commas (e.g. @a, @b, @c).")
    return PROG_COMPETITORS


async def prog_competitors(update: Update, context: ContextTypes.DEFAULT_TYPE):
    handles = parse_handles(update.message.text or "")
    if not handles:
        await send(update, context,
                   "Send at least one competitor handle, or type 'skip' to leave empty.")
        text = (update.message.text or "").strip().lower()
        if text in SKIP_WORDS:
            context.user_data["prog"]["competitors"] = []
        else:
            return PROG_COMPETITORS
    else:
        context.user_data["prog"]["competitors"] = handles
    await send(update, context,
               "3/4 — Describe her niche / what her account is about.\n"
               "(e.g. 'cosplay + gaming, playful, Gen-Z, some spicy teasing')")
    return PROG_NICHE


async def prog_niche(update: Update, context: ContextTypes.DEFAULT_TYPE):
    niche = (update.message.text or "").strip()
    if not niche:
        await send(update, context, "Please describe her niche, or /cancel.")
        return PROG_NICHE
    context.user_data["prog"]["niche"] = niche
    await send(update, context,
               "4/4 — What tone / style should the captions and ideas use?\n"
               "(e.g. 'flirty but classy, short punchy hooks, lots of CTA to DMs')")
    return PROG_TONE


async def prog_tone(update: Update, context: ContextTypes.DEFAULT_TYPE):
    tone = (update.message.text or "").strip()
    if not tone:
        await send(update, context, "Please describe the tone, or /cancel.")
        return PROG_TONE
    data = context.user_data.get("prog") or {}
    data["tone"] = tone
    upsert_program(
        data["model_id"],
        ig_handle=data.get("ig_handle"),
        competitors=json.dumps(data.get("competitors", [])),
        niche=data.get("niche"),
        tone=tone,
        reels_per_week=CONFIG.reels_per_week if CONFIG else 14,
    )
    program = get_program(data["model_id"])
    context.user_data.pop("prog", None)
    await send(update, context,
               "✅ Program saved.\n\n" + program_summary(program, data["model_name"]),
               reply_markup=program_actions(data["model_id"], True))
    return ConversationHandler.END


async def flow_cancel_cb(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data.pop("prog", None)
    q = update.callback_query
    if q:
        await q.answer()
        try:
            await q.edit_message_text("Cancelled.")
        except TelegramError:
            pass
    role = role_of(update.effective_user.id)
    await send(update, context, "Back to your menu.", reply_markup=menu_for(role) if role else None)
    return ConversationHandler.END


# =========================================================================== #
# Apify scraping (optional)
# =========================================================================== #
APIFY_API = "https://api.apify.com/v2"


def _parse_ig_items(items) -> list[dict]:
    """Map raw Apify Instagram items to compact dicts (works for post & reel actors)."""
    posts = []
    if not isinstance(items, list):
        return posts
    for it in items:
        if not isinstance(it, dict):
            continue
        music = ""
        mi = it.get("musicInfo") or {}
        if isinstance(mi, dict):
            song = mi.get("song_name") or mi.get("title") or ""
            artist = mi.get("artist_name") or mi.get("artist") or ""
            music = " — ".join(p for p in [song, artist] if p)
        posts.append({
            "owner": it.get("ownerUsername") or it.get("username") or "",
            "url": it.get("url") or it.get("postUrl") or "",
            "thumbnail": it.get("displayUrl") or it.get("thumbnailUrl") or it.get("imageUrl") or "",
            "video_url": it.get("videoUrl") or "",
            "caption": (it.get("caption") or "")[:400],
            "likes": it.get("likesCount") or it.get("likes") or 0,
            "views": it.get("videoViewCount") or it.get("videoPlayCount") or 0,
            "type": it.get("type") or "",
            "product_type": it.get("productType") or "",
            "music": music,
        })
    return posts


async def _apify_run(actor: str, payload: dict) -> list:
    """POST to an Apify actor's run-sync endpoint. Returns items, or [] on any error."""
    endpoint = f"{APIFY_API}/acts/{actor}/run-sync-get-dataset-items?token={CONFIG.apify_token}"
    try:
        async with httpx.AsyncClient(timeout=180) as client:
            r = await client.post(endpoint, json=payload)
            r.raise_for_status()
            return r.json()
    except Exception as exc:  # noqa: BLE001 — scraping must never break the bot
        log.warning("Apify run failed (%s): %s", actor, exc)
        return []


async def scrape_reels(handles: Sequence[str], results_per: int = 12) -> list[dict]:
    """Fetch REELS for the given handles via the dedicated reel actor. Never raises."""
    if not apify_enabled() or not handles:
        return []
    usernames = [_clean_handle(h) for h in handles]
    payload = {"username": usernames, "resultsLimit": results_per}
    return _parse_ig_items(await _apify_run(CONFIG.apify_reel_actor, payload))


async def scrape_handles(handles: Sequence[str], results_per: int = 12) -> list[dict]:
    """Fallback: fetch recent posts for the given handles via the post actor."""
    if not apify_enabled() or not handles:
        return []
    urls = [f"https://www.instagram.com/{_clean_handle(h)}/" for h in handles]
    payload = {
        "directUrls": urls,
        "resultsType": "posts",
        "resultsLimit": results_per,
        "addParentData": False,
    }
    return _parse_ig_items(await _apify_run(CONFIG.apify_actor, payload))


def _ref_score(p: dict) -> int:
    return (p.get("views") or 0) + (p.get("likes") or 0) * 3


def _is_reel(p: dict) -> bool:
    """True only for video/reel posts — never photos."""
    if "/reel/" in str(p.get("url", "")).lower():
        return True
    if p.get("video_url"):
        return True
    if "video" in str(p.get("type", "")).lower():
        return True
    if "clip" in str(p.get("product_type", "")).lower():
        return True
    return (p.get("views") or 0) > 0


def rank_references(posts: list[dict], limit: int = 20, per_owner: int = 8) -> list[dict]:
    """Real reference REELS only, balanced ACROSS accounts, then by engagement.

    A pure engagement sort lets the single highest-viewed account dominate the whole list,
    so we cap each account and round-robin between them — giving a genuine mix of the
    watch-list. Photos excluded; if nothing qualifies, returns [] so the plan honestly says
    'no live reference found'.
    """
    reels = [p for p in posts if p.get("url") and _is_reel(p)]
    buckets: dict[str, list] = {}
    order: list[str] = []
    for p in sorted(reels, key=_ref_score, reverse=True):
        o = (p.get("owner") or "?").lower()
        if o not in buckets:
            buckets[o] = []
            order.append(o)
        if len(buckets[o]) < per_owner:
            buckets[o].append(p)
    out: list[dict] = []
    i = 0
    while len(out) < limit and any(buckets[o] for o in order):
        o = order[i % len(order)]
        if buckets[o]:
            out.append(buckets[o].pop(0))
        i += 1
    return out


def references_text(refs: list[dict]) -> str:
    """Numbered list of real references for the prompt (1-based)."""
    lines = []
    for i, p in enumerate(refs, start=1):
        cap = (p.get("caption") or "").replace("\n", " ").strip()[:160]
        music = f" · audio: {p['music']}" if p.get("music") else ""
        lines.append(f"{i}. @{p.get('owner','')} — {p.get('views') or 0} views"
                     f"{music}\n   {p.get('url','')}\n   {cap}")
    return "\n".join(lines)


async def _scrape_each(handles: Sequence[str]) -> list[dict]:
    """Scrape each handle separately and concurrently so every account is represented.

    A single combined call lets one account's reels crowd out the rest; scraping per-handle
    guarantees the reference pool spans the whole watch-list.
    """
    if not apify_enabled() or not handles:
        return []
    reel_lists = await asyncio.gather(*[scrape_reels([h]) for h in handles],
                                      return_exceptions=True)
    posts: list[dict] = []
    for rl in reel_lists:
        if isinstance(rl, list):
            posts += rl
    if not any(_is_reel(p) for p in posts):   # reel actor gave nothing usable -> post scraper
        post_lists = await asyncio.gather(*[scrape_handles([h]) for h in handles],
                                          return_exceptions=True)
        for pl in post_lists:
            if isinstance(pl, list):
                posts += pl
    return posts


# =========================================================================== #
# Claude generation (content plan anchored on REAL reference videos)
# =========================================================================== #
_GEN_SYSTEM = (
    "You are a short-form TREND strategist for a creator agency. You are given a set of REAL "
    "reels that are performing RIGHT NOW in the creator's niche. Your job is to turn them into "
    "specific, on-trend videos for THIS creator by directly REMAKING each one — same hook "
    "style, structure, pacing and (where given) the same audio — adapted to her. You never "
    "produce generic, evergreen, 'X tips/things you should…' filler; every idea must visibly "
    "ride a trend that is present in the references. The brief fields are concise and directive "
    "for the team; the Caption is the creator's own casual, lowercase, flirty posting voice, "
    "paste-ready. Always cite the exact reference reel by its number. Every 'why it works' is "
    "tailored to THIS specific creator — grounded in her niche, her audience and what already "
    "works on her own account — and never a generic line that could apply to any creator."
)


def _build_gen_prompt(program: sqlite3.Row, model_name: str, refs_text: str,
                      n_sched: int, n_alt: int) -> str:
    comps = program_competitors(program)
    parts = [
        f"Build {model_name}'s weekly content plan: {n_sched} SCHEDULED videos (2 per day "
        f"across the week) PLUS {n_alt} extra SWAP options she can use to replace any she "
        "doesn't like.",
        "",
        f"Her Instagram: @{program['ig_handle']}" if program["ig_handle"] else "",
        f"Niche: {program['niche'] or 'general lifestyle'}",
        f"Tone / voice for the caption: {program['tone'] or 'casual and friendly'}",
        f"Benchmarked against: {', '.join('@'+c for c in comps) if comps else '(none)'}",
        "",
    ]
    if refs_text:
        parts += [
            "REAL reels performing in her niche RIGHT NOW (each numbered, from SEVERAL different "
            "accounts). Base every idea on ONE of them, cite it in 'reference_index', and REMAKE "
            "its format for her — copy the hook style, structure and pacing, and use its audio. "
            "IMPORTANT: draw across the VARIETY of accounts — do NOT base most ideas on a single "
            "account; spread them so the references used cover many of the accounts below. Use "
            "ONLY these numbers; never invent a video:",
            "",
            refs_text,
            "",
        ]
    else:
        parts += [
            "No live reference reels came back this time. Set reference_index to -1 on every "
            "idea (reference reads 'no live reference found'), but STILL make each idea a "
            "specific, current trend she'd recognise — no generic filler.",
            "",
        ]
    parts += [
        f"Return TWO lists: 'scheduled' with EXACTLY {n_sched} ideas, and 'alternates' with "
        f"EXACTLY {n_alt} ideas.",
        "For scheduled, set day_label to spread 2 per day: 'Mon AM','Mon PM','Tue AM','Tue PM',"
        " … through the week. For alternates, set day_label to 'Swap'.",
        "Each idea has:",
        "- reference_index: the number of the reel it remakes (or -1).",
        "- concept: one line — the SPECIFIC video (clearly a remake of that trend, not generic).",
        "- why: one line — why THIS specific creator should post it. Tie it directly to HER "
        "niche, HER audience and HER angle/strengths (and what already works on her own "
        "account). It MUST be specific to her — never a generic reason that could be copied "
        "onto any other creator. This teaches her team the strategy.",
        "- audio: the trending sound by name (use the reference's audio if given).",
        "- hook: the exact on-screen text — punchy, in the style of the reference's hook.",
        "- caption: paste-ready, in her casual lowercase flirty voice.",
        "- hashtags: one line of 4–8 relevant hashtags.",
        "Rules: every idea must clearly ride a trend from the references; NO generic 'tips/"
        "things' filler; keep concepts specific and current; vary across the week.",
    ]
    return "\n".join(p for p in parts if p is not None)


def _generate_plan_sync(program_data: dict, model_name: str, refs_text: str,
                        n_sched: int, n_alt: int) -> dict:
    """Blocking Anthropic call. Returns {'scheduled': [...], 'alternates': [...]}."""
    import anthropic
    from pydantic import BaseModel

    class Idea(BaseModel):
        day_label: str
        reference_index: int
        concept: str
        why: str
        audio: str
        hook: str
        caption: str
        hashtags: str

    class ContentPlan(BaseModel):
        scheduled: list[Idea]
        alternates: list[Idea]

    client = anthropic.Anthropic(api_key=CONFIG.anthropic_api_key)
    # competitors is stored as a JSON string so program_competitors() can parse it.
    prog_obj = {
        "ig_handle": program_data.get("ig_handle"),
        "niche": program_data.get("niche"),
        "tone": program_data.get("tone"),
        "competitors": json.dumps(program_data.get("competitors") or []),
    }

    class _P:
        def __init__(self, d):
            self._d = d
        def __getitem__(self, k):
            return self._d.get(k)
        def keys(self):
            return self._d.keys()

    prompt = _build_gen_prompt(_P(prog_obj), model_name, refs_text, n_sched, n_alt)
    resp = client.with_options(timeout=600.0).messages.parse(
        model=CONFIG.anthropic_model,
        max_tokens=32000,
        thinking={"type": "adaptive"},
        system=_GEN_SYSTEM,
        messages=[{"role": "user", "content": prompt}],
        output_format=ContentPlan,
    )
    plan = resp.parsed_output
    return {
        "scheduled": [i.model_dump() for i in plan.scheduled],
        "alternates": [i.model_dump() for i in plan.alternates],
    }


async def generate_plan(model_id: int, created_by: int) -> Optional[int]:
    """Scrape real reels -> Claude -> persist a plan (scheduled + swaps). Returns plan_id."""
    program = get_program(model_id)
    model = get_user(model_id)
    if program is None or model is None:
        return None
    n_sched = program["reels_per_week"] or (CONFIG.reels_per_week if CONFIG else 14)
    n_alt = CONFIG.alternates_count if CONFIG else 6

    handles = []
    if program["ig_handle"]:
        handles.append(program["ig_handle"])
    handles += program_competitors(program)
    refs = rank_references(await _scrape_each(handles))   # per-account -> a real mix
    refs_text = references_text(refs)

    program_data = {
        "ig_handle": program["ig_handle"],
        "niche": program["niche"],
        "tone": program["tone"],
        "competitors": program_competitors(program),
    }
    result = await asyncio.to_thread(
        _generate_plan_sync, program_data, model["display_name"], refs_text, n_sched, n_alt)

    def _ref(idea):
        ridx = idea.get("reference_index", -1)
        r = refs[ridx - 1] if isinstance(ridx, int) and 1 <= ridx <= len(refs) else None
        return (r["url"] if r else "no live reference found"), (r.get("thumbnail") if r else None) or None

    week = _week_start(datetime.now(_tz()).date())
    plan_id = create_plan(model_id, week, "", created_by)
    idx = 1
    for kind, ideas in (("week", result.get("scheduled", [])),
                        ("swap", result.get("alternates", []))):
        for idea in ideas:
            ref_url, thumb = _ref(idea)
            add_reel(
                plan_id, idx, kind=kind,
                day_label=idea.get("day_label"),
                concept=idea.get("concept"),
                why=idea.get("why"),
                audio=idea.get("audio"),
                hook=idea.get("hook"),
                caption=idea.get("caption"),
                hashtags=idea.get("hashtags"),
                reference_url=ref_url, thumbnail_url=thumb)
            idx += 1
    return plan_id


# =========================================================================== #
# Auto-discovery: propose fresh competitor / inspiration accounts
# =========================================================================== #
_STOP_WORDS = {
    "with", "that", "this", "very", "some", "more", "most", "your", "into", "they",
    "them", "just", "like", "posts", "content", "account", "style", "vibe", "vibes",
    "from", "what", "when", "their", "about", "lots", "teasing", "spicy", "playful",
}


def _niche_hashtags(niche: str, limit: int = 6) -> list[str]:
    """Crude seed hashtags from the niche text — Claude curates the real result."""
    words = re.findall(r"[a-zA-Z]{4,}", (niche or "").lower())
    out, seen = [], set()
    for w in words:
        if w in _STOP_WORDS or w in seen:
            continue
        seen.add(w)
        out.append(w)
        if len(out) >= limit:
            break
    return out or ["instagram"]


async def scrape_hashtags(tags: Sequence[str], results_per: int = 30) -> list[dict]:
    """Best-effort: fetch top posts under the given hashtags via Apify. Never raises."""
    if not apify_enabled() or not tags:
        return []
    payload = {
        "hashtags": [t.lstrip("#") for t in tags],
        "resultsLimit": results_per,
        "resultsType": "posts",
    }
    endpoint = (f"{APIFY_API}/acts/{CONFIG.apify_hashtag_actor}/run-sync-get-dataset-items"
                f"?token={CONFIG.apify_token}")
    try:
        async with httpx.AsyncClient(timeout=180) as client:
            r = await client.post(endpoint, json=payload)
            r.raise_for_status()
            items = r.json()
    except Exception as exc:  # noqa: BLE001 — discovery must never break the bot
        log.warning("Apify hashtag scrape failed: %s", exc)
        return []
    posts = []
    if not isinstance(items, list):
        return []
    for it in items:
        if not isinstance(it, dict):
            continue
        posts.append({
            "owner": it.get("ownerUsername") or it.get("username") or "",
            "url": it.get("url") or "",
            "caption": (it.get("caption") or "")[:200],
            "likes": it.get("likesCount") or it.get("likes") or 0,
            "views": it.get("videoViewCount") or it.get("videoPlayCount") or 0,
        })
    return posts


def aggregate_owners(posts: list[dict], exclude: set[str], own: str, limit: int = 25) -> list[dict]:
    """Group hashtag posts by account, drop excluded ones, rank by engagement."""
    own_l = (own or "").lower()
    by: dict[str, dict] = {}
    for p in posts:
        o = (p.get("owner") or "").strip()
        if not o or o.lower() in exclude or o.lower() == own_l:
            continue
        d = by.setdefault(o.lower(), {"handle": o, "score": 0, "posts": 0, "sample": ""})
        d["score"] += (p.get("views") or 0) + (p.get("likes") or 0) * 3
        d["posts"] += 1
        if not d["sample"]:
            d["sample"] = (p.get("caption") or "").replace("\n", " ").strip()[:160]
    ranked = sorted(by.values(), key=lambda x: x["score"], reverse=True)
    return ranked[:limit]


_DISCOVER_SYSTEM = (
    "You help an Instagram talent agency curate a watch-list of creators to benchmark a "
    "model against for content ideas. You suggest real, on-niche accounts that are worth "
    "studying. Never suggest the model's own account or accounts already on the watch-list. "
    "Return handles in plain form, without the @ symbol and without spaces."
)


def _discover_sync(niche: str, tone: str, model_name: str, own_handle: Optional[str],
                   exclude: list[str], raw_candidates: list[dict], n: int = 5) -> list[dict]:
    """Blocking Anthropic call. Returns [{handle, reason}]."""
    import anthropic
    from pydantic import BaseModel

    class Suggestion(BaseModel):
        handle: str
        reason: str

    class Discovery(BaseModel):
        suggestions: list[Suggestion]

    client = anthropic.Anthropic(api_key=CONFIG.anthropic_api_key)
    parts = [
        f"Find up to {n} new Instagram accounts to add to {model_name}'s watch-list.",
        f"Her niche: {niche or 'general lifestyle'}",
        f"Her tone/style: {tone or 'authentic'}",
        f"Her own handle (never suggest this): @{own_handle}" if own_handle else "",
        "",
        "Do NOT suggest any of these (already considered): "
        + (", ".join("@" + h for h in exclude) if exclude else "(none yet)"),
        "",
    ]
    if raw_candidates:
        parts.append("These accounts are currently performing well under relevant hashtags. "
                     "Choose the best, genuinely on-niche ones from this list:")
        for c in raw_candidates:
            parts.append(f"- @{c['handle']} (score {c['score']}, {c['posts']} posts) {c['sample']}")
    else:
        parts.append("No live scraped data is available. Suggest accounts from your knowledge of "
                     "this niche. The owner will verify each handle before adding it, so prefer "
                     "well-known or clearly-established creators in the space.")
    parts += ["", f"Return up to {n} suggestions, each with a short reason it's worth studying."]
    prompt = "\n".join(p for p in parts if p is not None)

    resp = client.messages.parse(
        model=CONFIG.anthropic_model,
        max_tokens=4000,
        thinking={"type": "adaptive"},
        system=_DISCOVER_SYSTEM,
        messages=[{"role": "user", "content": prompt}],
        output_format=Discovery,
    )
    return [{"handle": _clean_handle(s.handle), "reason": s.reason}
            for s in resp.parsed_output.suggestions if s.handle]


async def discover_for_model(model_id: int) -> list[int]:
    """Run discovery for one model; store proposals. Returns new candidate ids."""
    program = get_program(model_id)
    model = get_user(model_id)
    if program is None or model is None:
        return []
    own = program["ig_handle"]
    exclude = {c.lower() for c in program_competitors(program)} | list_seen_handles(model_id)
    if own:
        exclude.add(own.lower())

    posts = await scrape_hashtags(_niche_hashtags(program["niche"]))
    raw = aggregate_owners(posts, exclude, own or "")

    result = await asyncio.to_thread(
        _discover_sync, program["niche"], program["tone"], model["display_name"],
        own, sorted(exclude), raw, 5)

    created: list[int] = []
    for s in result:
        h = _clean_handle(s["handle"])
        if not h or h.lower() in exclude:
            continue
        exclude.add(h.lower())
        cid = create_candidate(model_id, h, s["reason"])
        if cid:
            created.append(cid)
    return created


def candidate_kb(candidate_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([[
        InlineKeyboardButton("✅ Add to watch-list", callback_data=f"cand:add:{candidate_id}"),
        InlineKeyboardButton("✖ Skip", callback_data=f"cand:skip:{candidate_id}"),
    ]])


async def _send_candidate_cards(bot, chat_id: int, model_id: int, cand_ids: list[int]) -> None:
    if not cand_ids:
        return
    model = get_user(model_id)
    name = model["display_name"] if model else f"#{model_id}"
    await bot.send_message(
        chat_id=chat_id,
        text=f"🔎 Found {len(cand_ids)} new account(s) to consider for {name}. "
             "Add the ones you like to her watch-list:")
    for cid in cand_ids:
        c = get_candidate(cid)
        if not c or c["status"] != "proposed":
            continue
        await bot.send_message(
            chat_id=chat_id,
            text=f"👤 @{c['handle']}\n💬 {c['reason']}\n(for {name})",
            reply_markup=candidate_kb(cid), disable_web_page_preview=True)


async def cand_action_cb(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    q = update.callback_query
    if not await _owner_guard(update, context):
        return
    _, action, raw = q.data.split(":")
    cand = get_candidate(int(raw))
    if cand is None:
        await q.answer("That suggestion is gone.", show_alert=True)
        return
    if cand["status"] != "proposed":
        await q.answer("Already decided.")
        return
    name = _name(cand["model_id"])
    if action == "add":
        set_candidate_status(cand["id"], "approved")
        added = add_competitor(cand["model_id"], cand["handle"])
        await q.answer("Added ✅")
        msg = (f"✅ Added @{cand['handle']} to {name}'s watch-list."
               if added else f"@{cand['handle']} is already on {name}'s list.")
        try:
            await q.edit_message_text(msg)
        except TelegramError:
            pass
    else:
        set_candidate_status(cand["id"], "rejected")
        await q.answer("Skipped")
        try:
            await q.edit_message_text(f"✖ Skipped @{cand['handle']} — I won't suggest her again.")
        except TelegramError:
            pass


async def discover_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not await _owner_guard(update, context):
        return
    await _discover_pick(update, context)


async def _discover_pick(update, context) -> None:
    if not anthropic_enabled():
        await send(update, context, "Set ANTHROPIC_API_KEY first to enable discovery.",
                   reply_markup=owner_menu())
        return
    models = [m for m in list_by_role(Role.MODEL.value) if get_program(m["telegram_id"])]
    if not models:
        await send(update, context, "No models with a program yet.", reply_markup=owner_menu())
        return
    await send(update, context, "Find fresh accounts to watch for which model?",
               reply_markup=model_picker(models, "disc:run"))


async def disc_run_cb(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    q = update.callback_query
    await q.answer()
    if not await _owner_guard(update, context):
        return
    model_id = int(q.data.split(":")[2])
    name = _name(model_id)
    note = "" if apify_enabled() else " (using niche knowledge — verify handles before adding)"
    try:
        await q.edit_message_text(f"🔎 Looking for fresh accounts for {name}{note}…")
    except TelegramError:
        pass
    try:
        ids = await discover_for_model(model_id)
    except Exception as exc:  # noqa: BLE001
        log.exception("Discovery failed for model %s", model_id)
        await send(update, context, f"❌ Discovery failed: {exc}", reply_markup=owner_menu())
        return
    if not ids:
        await send(update, context,
                   f"No new accounts to suggest for {name} right now — her list may already be "
                   "comprehensive. Try again next week.", reply_markup=owner_menu())
        return
    await _send_candidate_cards(context.bot, update.effective_chat.id, model_id, ids)


# =========================================================================== #
# Owner: generate flow + approval
# =========================================================================== #
async def generate_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not await _owner_guard(update, context):
        return
    await _generate_pick(update, context)


async def generate_menu_cb(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.callback_query.answer()
    if not await _owner_guard(update, context):
        return
    await _generate_pick(update, context)


async def _generate_pick(update, context) -> None:
    if not anthropic_enabled():
        await send(update, context,
                   "⚠️ Claude isn't configured yet. Set ANTHROPIC_API_KEY in your environment "
                   "to enable plan generation.", reply_markup=owner_menu())
        return
    models = [m for m in list_by_role(Role.MODEL.value) if get_program(m["telegram_id"])]
    if not models:
        await send(update, context,
                   "No models with a program yet. Set up a program first.",
                   reply_markup=owner_menu())
        return
    await send(update, context, "Generate a content plan for which model?",
               reply_markup=model_picker(models, "gen:start"))


async def gen_start_cb(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    q = update.callback_query
    await q.answer()
    if not await _owner_guard(update, context):
        return
    model_id = int(q.data.split(":")[2])
    await _run_generation(update, context, model_id, q)


async def _run_generation(update, context, model_id: int, q=None) -> None:
    model = get_user(model_id)
    name = model["display_name"] if model else f"#{model_id}"
    note = "" if apify_enabled() else " (no live references — set APIFY_TOKEN for real links)"
    msg_text = f"✨ Building {name}'s content plan{note}…\nThis takes ~30–90s."
    if q:
        try:
            await q.edit_message_text(msg_text)
        except TelegramError:
            await send(update, context, msg_text)
    else:
        await send(update, context, msg_text)

    try:
        plan_id = await generate_plan(model_id, update.effective_user.id)
    except Exception as exc:  # noqa: BLE001
        log.exception("Generation failed for model %s", model_id)
        await send(update, context, f"❌ Generation failed: {exc}", reply_markup=owner_menu())
        return
    if plan_id is None:
        await send(update, context, "Couldn't generate — is the program set up?",
                   reply_markup=owner_menu())
        return
    await _finish_plan(context.bot, update.effective_chat.id, plan_id)


async def _finish_plan(bot, chat_id: int, plan_id: int) -> Optional[str]:
    """Always build the Notion page and return the link (per the output spec)."""
    plan = get_plan(plan_id)
    model = get_user(plan["model_id"]) if plan else None
    name = model["display_name"] if model else "model"
    n = len(list_reels(plan_id))

    if not notion_enabled():
        await bot.send_message(
            chat_id=chat_id,
            text=(f"⚠️ {name}'s plan is ready, but Notion isn't configured so I can't build the "
                  "page. Set NOTION_TOKEN and NOTION_PARENT_PAGE_ID."),
            reply_markup=plan_ready_keyboard(plan_id))
        return None

    try:
        page_id, page_url = await notion_create_plan_page(plan_id)
        if page_id:
            update_plan(plan_id, notion_page_id=page_id, notion_url=page_url)
    except Exception as exc:  # noqa: BLE001
        log.warning("Notion page failed for plan %s: %s", plan_id, exc)
        await bot.send_message(
            chat_id=chat_id,
            text=f"⚠️ Built {name}'s plan but couldn't write the Notion page: {exc}",
            reply_markup=plan_ready_keyboard(plan_id))
        return None

    await bot.send_message(
        chat_id=chat_id,
        text=f"✅ {name} — Content Plan ready ({n} ideas).\n📄 {page_url}",
        reply_markup=plan_ready_keyboard(plan_id, page_url))
    return page_url


async def plan_action_cb(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    q = update.callback_query
    if not await _owner_guard(update, context):
        return
    _, action, raw = q.data.split(":")
    plan_id = int(raw)
    plan = get_plan(plan_id)
    if plan is None:
        await q.answer("That plan is gone.", show_alert=True)
        return

    if action == "regen":
        await q.answer()
        update_plan(plan_id, status=PlanStatus.DISCARDED.value)
        try:
            await q.edit_message_text("🔄 Regenerating…")
        except TelegramError:
            pass
        await _run_generation(update, context, plan["model_id"])
        return

    if action == "send":
        await q.answer()
        await _send_plan_to_model(context, plan_id, q)


async def _send_plan_to_model(context, plan_id: int, q=None) -> None:
    plan = get_plan(plan_id)
    if plan is None:
        return
    update_plan(plan_id, status=PlanStatus.APPROVED.value)
    model = get_user(plan["model_id"])
    name = model["display_name"] if model else "model"
    url = plan["notion_url"] if "notion_url" in plan.keys() else None
    if not url:  # build it now if it wasn't built at generation time
        try:
            page_id, url = await notion_create_plan_page(plan_id)
            if page_id:
                update_plan(plan_id, notion_page_id=page_id, notion_url=url)
        except Exception as exc:  # noqa: BLE001
            log.warning("Notion page failed for plan %s: %s", plan_id, exc)

    sent = False
    if url:
        sent = await _safe_dm(
            context.bot, plan["model_id"],
            f"🎬 Your content plan for this week is ready — {len(list_reels(plan_id))} ideas:\n"
            f"📄 {url}")
    summary = (f"📤 Sent to {name}." if sent
               else f"⚠️ Couldn't message {name} — she may not have started the bot yet.")
    if q:
        try:
            await q.edit_message_text(summary)
        except TelegramError:
            pass
    else:
        for o in list_by_role(Role.OWNER.value):
            await _safe_dm(context.bot, o["telegram_id"], summary)


# =========================================================================== #
# Model: latest content plan
# =========================================================================== #
async def myreels_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await _show_my_reels(update, context)


async def myreels_menu_cb(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.callback_query.answer()
    await _show_my_reels(update, context)


async def _show_my_reels(update, context) -> None:
    uid = update.effective_user.id
    if role_of(uid) != Role.MODEL.value:
        await send(update, context, "Only models have a content plan.")
        return
    plan = latest_plan_for_model(uid, status=PlanStatus.APPROVED.value)
    if plan is None:
        await send(update, context,
                   "No content plan yet — you'll get one as soon as it's sent. 💛")
        return
    url = plan["notion_url"] if "notion_url" in plan.keys() else None
    n = len(list_reels(plan["id"]))
    if url:
        await send(update, context,
                   f"🎬 Your latest content plan ({n} ideas):\n📄 {url}")
    else:
        await send(update, context, "Your latest plan is being prepared — check back shortly. 💛")


async def reel_status_cb(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    q = update.callback_query
    _, action, raw = q.data.split(":")
    reel_id = int(raw)
    reel = get_reel(reel_id)
    if reel is None:
        await q.answer("That reel is gone.", show_alert=True)
        return
    plan = get_plan(reel["plan_id"])
    uid = update.effective_user.id
    # Only the owning model (or an owner) may toggle.
    if not (is_owner(uid) or (plan and plan["model_id"] == uid)):
        await q.answer("Not your reel.", show_alert=True)
        return
    new_status = ReelStatus.SHOT.value if action == "shot" else ReelStatus.TODO.value
    set_reel_status(reel_id, new_status)
    await q.answer("Marked as shot ✅" if action == "shot" else "Moved back to to-do")
    reel = get_reel(reel_id)
    try:
        await q.edit_message_reply_markup(reply_markup=reel_card_kb(reel_id, new_status))
    except TelegramError:
        pass
    # Notify owners when a model finishes everything.
    if new_status == ReelStatus.SHOT.value and plan:
        reels = list_reels(plan["id"])
        if reels and all(r["status"] == ReelStatus.SHOT.value for r in reels):
            who = _name(plan["model_id"])
            for o in list_by_role(Role.OWNER.value):
                if o["telegram_id"] != uid:
                    await _safe_dm(context.bot,
                                   o["telegram_id"],
                                   f"🎉 {who} has shot all {len(reels)} reels for the week of "
                                   f"{plan['week_start']}!")


# =========================================================================== #
# Notion (optional) — one page per approved plan
# =========================================================================== #
NOTION_API = "https://api.notion.com/v1"
NOTION_VERSION = "2022-06-28"


def notion_enabled() -> bool:
    return bool(CONFIG and CONFIG.notion_token and CONFIG.notion_parent_page_id)


def _notion_headers() -> dict:
    return {
        "Authorization": f"Bearer {CONFIG.notion_token}",
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
    }


def _notion_id(raw: str) -> str:
    matches = re.findall(r"[0-9a-fA-F]{32}", (raw or "").replace("-", ""))
    s = matches[-1] if matches else (raw or "").strip()
    if len(s) == 32:
        return f"{s[0:8]}-{s[8:12]}-{s[12:16]}-{s[16:20]}-{s[20:32]}"
    return s


def _rt(text: Optional[str], link: Optional[str] = None) -> list:
    if not text:
        return []
    item = {"type": "text", "text": {"content": str(text)[:1900]}}
    if link:
        item["text"]["link"] = {"url": link}
    return [item]


def _para(text: str) -> dict:
    return {"object": "block", "type": "paragraph",
            "paragraph": {"rich_text": _rt(text)}}


def _heading(text: str, level: int = 2) -> dict:
    key = f"heading_{level}"
    return {"object": "block", "type": key, key: {"rich_text": _rt(text)}}


def _field(label: str, value: Optional[str], link: Optional[str] = None) -> dict:
    """A '**Label** — value' line; value may carry a link."""
    rich = [{"type": "text", "text": {"content": f"{label} — "}, "annotations": {"bold": True}}]
    rich += _rt(value or "—", link=link)
    return {"object": "block", "type": "paragraph", "paragraph": {"rich_text": rich}}


def _image(url: str) -> dict:
    return {"object": "block", "type": "image",
            "image": {"type": "external", "external": {"url": url}}}


def _bold_line(text: str) -> dict:
    return {"object": "block", "type": "paragraph",
            "paragraph": {"rich_text": [{"type": "text", "text": {"content": text},
                                         "annotations": {"bold": True}}]}}


def _idea_content(r: sqlite3.Row) -> list[dict]:
    """Text blocks for one idea — compact, no big heading, no Shot field."""
    label = f"🎬 Idea {r['idx']}"
    if r["day_label"]:
        label += f" · {r['day_label']}"
    blocks = [_bold_line(label), _field("Concept", r["concept"])]
    why = r["why"] if "why" in r.keys() else None
    if why:
        blocks.append(_field("Why it works", why))
    ref = r["reference_url"] if "reference_url" in r.keys() else None
    if ref and str(ref).startswith("http"):
        blocks.append(_field("Reference", ref, link=ref))
    else:
        blocks.append(_field("Reference", ref or "no live reference found"))
    blocks.append(_field("Audio", r["audio"]))
    blocks.append(_field("Hook", r["hook"]))
    blocks.append(_field("Caption", r["caption"]))
    if r["hashtags"]:
        blocks.append(_field("Hashtags", r["hashtags"]))
    return blocks


def _idea_blocks(r: sqlite3.Row, image_mode: str = "column") -> list[dict]:
    content = _idea_content(r)
    thumb = r["thumbnail_url"] if "thumbnail_url" in r.keys() else None
    if image_mode == "none" or not thumb:
        return content
    if image_mode == "full":
        return [_image(thumb)] + content
    # "column": small thumbnail on the left, the brief on the right
    col_img = {"object": "block", "type": "column", "column": {"children": [_image(thumb)]}}
    col_txt = {"object": "block", "type": "column", "column": {"children": content}}
    return [{"object": "block", "type": "column_list",
             "column_list": {"children": [col_img, col_txt]}}]


def _plan_blocks(plan_id: int, image_mode: str = "column") -> list[dict]:
    reels = list_reels(plan_id)
    week = [r for r in reels if (r["kind"] if "kind" in r.keys() else "week") != "swap"]
    swaps = [r for r in reels if (r["kind"] if "kind" in r.keys() else "week") == "swap"]
    blocks: list[dict] = []
    for r in week:
        blocks += _idea_blocks(r, image_mode)
    if swaps:
        blocks.append(_heading("🔁 Swap options — use these to replace any above", 3))
        for r in swaps:
            blocks += _idea_blocks(r, image_mode)
    return blocks


async def _notion_post(path: str, payload: dict) -> dict:
    async with httpx.AsyncClient(timeout=40) as client:
        r = await client.post(f"{NOTION_API}{path}", headers=_notion_headers(), json=payload)
        r.raise_for_status()
        return r.json()


async def _notion_append(page_id: str, blocks: list[dict]) -> None:
    for i in range(0, len(blocks), 100):
        async with httpx.AsyncClient(timeout=40) as client:
            r = await client.patch(f"{NOTION_API}/blocks/{page_id}/children",
                                   headers=_notion_headers(),
                                   json={"children": blocks[i:i + 100]})
            r.raise_for_status()


async def notion_create_plan_page(plan_id: int):
    """Build the content-plan page. Tries small-image columns, then full images, then text."""
    plan = get_plan(plan_id)
    if plan is None:
        return None, None
    model = get_user(plan["model_id"])
    name = model["display_name"] if model else "Creator"
    try:
        date_str = datetime.fromisoformat(plan["created_at"]).strftime("%d %b %Y")
    except (ValueError, TypeError):
        date_str = plan["week_start"]
    title = f"{name} — Content Plan — {date_str}"

    def _payload(blocks):
        return {
            "parent": {"type": "page_id", "page_id": _notion_id(CONFIG.notion_parent_page_id)},
            "properties": {"title": {"title": [{"type": "text", "text": {"content": title}}]}},
            "children": blocks[:100],
        }

    last = None
    for mode in ("column", "full", "none"):
        blocks = _plan_blocks(plan_id, image_mode=mode)
        try:
            data = await _notion_post("/pages", _payload(blocks))
        except Exception as exc:  # noqa: BLE001 — fall back to a simpler layout
            last = exc
            log.warning("Notion create (mode=%s) failed: %s", mode, exc)
            continue
        rest = blocks[100:]
        if rest:
            try:
                await _notion_append(data["id"], rest)
            except Exception as exc:  # noqa: BLE001
                log.warning("Notion append failed for plan %s: %s", plan_id, exc)
        return data.get("id"), data.get("url")
    if last:
        raise last
    return None, None


# =========================================================================== #
# Weekly scheduler (auto-generate drafts on the configured day)
# =========================================================================== #
async def _safe_dm(bot, chat_id: int, text: str, reply_markup=None) -> bool:
    try:
        await bot.send_message(chat_id=chat_id, text=text, reply_markup=reply_markup,
                               disable_web_page_preview=True)
        return True
    except TelegramError as exc:
        log.warning("DM to %s failed: %s", chat_id, exc)
        return False


async def _run_weekly_check(app: Application) -> int:
    """If it's the generation day & hour and we haven't generated this week, do it."""
    if not anthropic_enabled():
        return 0
    now = datetime.now(_tz())
    if now.weekday() != CONFIG.gen_weekday or now.hour != CONFIG.gen_hour:
        return 0
    week = _week_start(now.date())
    if get_setting("last_auto_week") == week:
        return 0  # already ran this week
    set_setting("last_auto_week", week)

    generated = 0
    owners = list_by_role(Role.OWNER.value)
    for program in list_active_programs():
        model_id = program["model_id"]
        model = get_user(model_id)
        if model is None or not model["is_active"]:
            continue
        if plan_exists_for_week(model_id, week):
            continue
        try:
            plan_id = await generate_plan(model_id, CONFIG.owner_id)
        except Exception as exc:  # noqa: BLE001
            log.warning("Auto-gen failed for %s: %s", model_id, exc)
            for o in owners:
                await _safe_dm(app.bot, o["telegram_id"],
                               f"⚠️ Auto-generation failed for {model['display_name']}: {exc}")
            continue
        if plan_id:
            generated += 1
            for o in owners:
                try:
                    await _finish_plan(app.bot, o["telegram_id"], plan_id)
                except Exception as exc:  # noqa: BLE001
                    log.warning("Could not push plan to owner %s: %s", o["telegram_id"], exc)
    return generated


async def _run_discovery_check(app: Application) -> int:
    """The day before generation, propose fresh accounts to the owner(s)."""
    if not anthropic_enabled():
        return 0
    now = datetime.now(_tz())
    discover_day = (CONFIG.gen_weekday - 1) % 7
    if now.weekday() != discover_day or now.hour != CONFIG.gen_hour:
        return 0
    week = _week_start(now.date())
    if get_setting("last_discover_week") == week:
        return 0
    set_setting("last_discover_week", week)

    owners = list_by_role(Role.OWNER.value)
    total = 0
    for program in list_active_programs():
        model = get_user(program["model_id"])
        if model is None or not model["is_active"]:
            continue
        try:
            ids = await discover_for_model(program["model_id"])
        except Exception as exc:  # noqa: BLE001
            log.warning("Auto-discovery failed for %s: %s", program["model_id"], exc)
            continue
        if ids:
            total += len(ids)
            for o in owners:
                try:
                    await _send_candidate_cards(app.bot, o["telegram_id"], program["model_id"], ids)
                except Exception as exc:  # noqa: BLE001
                    log.warning("Could not send candidates to %s: %s", o["telegram_id"], exc)
    return total


async def _scheduler_loop(app: Application) -> None:
    await asyncio.sleep(45)
    while True:
        try:
            n = await _run_weekly_check(app)
            if n:
                log.info("Weekly check generated %d draft plan(s)", n)
        except Exception as exc:  # noqa: BLE001
            log.warning("Weekly check failed: %s", exc)
        try:
            d = await _run_discovery_check(app)
            if d:
                log.info("Discovery check proposed %d account(s)", d)
        except Exception as exc:  # noqa: BLE001
            log.warning("Discovery check failed: %s", exc)
        await asyncio.sleep(900)  # every 15 minutes


async def gennow_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Owner-only: force the weekly auto-generation to run now (for testing)."""
    if not await _owner_guard(update, context):
        return
    if not anthropic_enabled():
        await send(update, context, "Set ANTHROPIC_API_KEY first.")
        return
    set_setting("last_auto_week", "")  # clear guard so it runs
    await send(update, context, "Running the weekly generation now for all active programs…")
    n = 0
    for program in list_active_programs():
        model = get_user(program["model_id"])
        if model is None or not model["is_active"]:
            continue
        try:
            plan_id = await generate_plan(program["model_id"], update.effective_user.id)
        except Exception as exc:  # noqa: BLE001
            await send(update, context, f"⚠️ {model['display_name']}: {exc}")
            continue
        if plan_id:
            n += 1
            await _finish_plan(context.bot, update.effective_chat.id, plan_id)
    await send(update, context, f"Done — {n} plan(s) generated.",
               reply_markup=owner_menu())


# =========================================================================== #
# Stray text fallback
# =========================================================================== #
async def fallback_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    role = role_of(update.effective_user.id)
    if role == Role.OWNER.value:
        await send(update, context, "Use the menu below.", reply_markup=owner_menu())
    elif role == Role.MODEL.value:
        await send(update, context, "Tap below for your latest plan.", reply_markup=model_menu())
    else:
        await send(update, context, "You're not registered. Ask the agency owner for an invite link.")


# =========================================================================== #
# Application assembly
# =========================================================================== #
def program_conversation() -> ConversationHandler:
    return ConversationHandler(
        entry_points=[CallbackQueryHandler(prog_edit_start, pattern=r"^prog:edit:\d+$")],
        states={
            PROG_HANDLE: [MessageHandler(filters.TEXT & ~filters.COMMAND, prog_handle)],
            PROG_COMPETITORS: [MessageHandler(filters.TEXT & ~filters.COMMAND, prog_competitors)],
            PROG_NICHE: [MessageHandler(filters.TEXT & ~filters.COMMAND, prog_niche)],
            PROG_TONE: [MessageHandler(filters.TEXT & ~filters.COMMAND, prog_tone)],
        },
        fallbacks=[
            CallbackQueryHandler(flow_cancel_cb, pattern=r"^flow:cancel$"),
            CommandHandler("cancel", cancel_cmd),
        ],
        name="program_setup", persistent=True, allow_reentry=True,
    )


async def _post_init(app: Application) -> None:
    me = await app.bot.get_me()
    app.bot_data["bot_username"] = me.username
    await app.bot.set_my_commands([
        BotCommand("start", "Open your menu"),
        BotCommand("generate", "Owner: make a content plan"),
        BotCommand("discover", "Owner: find fresh accounts to watch"),
        BotCommand("programs", "Owner: set up model programs"),
        BotCommand("myreels", "Models: your latest content plan"),
        BotCommand("invite", "Owner: invite a model"),
        BotCommand("people", "Owner: list models"),
        BotCommand("help", "Show help"),
        BotCommand("cancel", "Stop the current step"),
    ])
    log.info("REPEL Marketing is running as @%s", me.username)
    log.info("Claude: %s | Apify: %s | Notion: %s",
             "on" if anthropic_enabled() else "off",
             "on" if apify_enabled() else "off",
             "on" if notion_enabled() else "off")
    asyncio.create_task(_scheduler_loop(app))


async def _on_error(update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
    log.exception("Unhandled error while processing update: %s", context.error)


def build_application(config: Config) -> Application:
    global CONFIG
    CONFIG = config
    db_configure(config.db_path)
    init_db()
    persistence = PicklePersistence(filepath=config.state_path)
    app = (Application.builder().token(config.bot_token).persistence(persistence)
           .post_init(_post_init).build())

    # Conversation first so its text steps win while active.
    app.add_handler(program_conversation())

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("help", help_cmd))
    app.add_handler(CommandHandler("cancel", cancel_cmd))

    app.add_handler(CommandHandler("generate", generate_cmd))
    app.add_handler(CommandHandler("discover", discover_cmd))
    app.add_handler(CommandHandler("programs", programs_cmd))
    app.add_handler(CommandHandler("invite", invite_cmd))
    app.add_handler(CommandHandler("people", people_cmd))
    app.add_handler(CommandHandler("myreels", myreels_cmd))
    app.add_handler(CommandHandler("gennow", gennow_cmd))

    # Menus
    app.add_handler(CallbackQueryHandler(generate_menu_cb, pattern=r"^menu:generate$"))
    app.add_handler(CallbackQueryHandler(programs_menu_cb, pattern=r"^menu:programs$"))
    app.add_handler(CallbackQueryHandler(myreels_menu_cb, pattern=r"^menu:myreels$"))
    app.add_handler(CallbackQueryHandler(invite_cb, pattern=r"^owner:invite:model$"))

    # Programs
    app.add_handler(CallbackQueryHandler(prog_open_cb, pattern=r"^prog:open:\d+$"))

    # Generate + approval
    app.add_handler(CallbackQueryHandler(gen_start_cb, pattern=r"^gen:start:\d+$"))
    app.add_handler(CallbackQueryHandler(plan_action_cb, pattern=r"^plan:(send|regen):\d+$"))

    # Auto-discovery
    app.add_handler(CallbackQueryHandler(disc_run_cb, pattern=r"^disc:run:\d+$"))
    app.add_handler(CallbackQueryHandler(cand_action_cb, pattern=r"^cand:(add|skip):\d+$"))

    # Model reel tracking
    app.add_handler(CallbackQueryHandler(reel_status_cb, pattern=r"^reel:(shot|undo):\d+$"))

    # Cancel button on pickers shown outside the program conversation
    app.add_handler(CallbackQueryHandler(flow_cancel_cb, pattern=r"^flow:cancel$"))

    # Stray text last
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, fallback_text))

    app.add_error_handler(_on_error)
    return app


def main() -> None:
    config = load_config()
    app = build_application(config)
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
