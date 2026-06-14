#!/usr/bin/env python3
"""REPEL — Telegram content-request bot for chatting agencies (single-file build).

Lets chatting managers / an agency request content (customs, content reloads)
from models. A request goes straight to the model's Telegram inbox, where she
taps Accept (and gives an ETA) or Decline (with an optional reason). The owner
and the requesting manager are notified of every step; the model marks the
request delivered when it's done.

Quick start
-----------
  1. On Telegram, message @BotFather -> /newbot -> copy the token.
  2. Set BOT_TOKEN (and optionally OWNER_ID) as environment variables, or put
     them in a file called ".env" next to this script:
         BOT_TOKEN=123456:abc...
         OWNER_ID=
  3. pip install -r requirements.txt
  4. python repel_bot.py
  5. Message your bot /start — the first person to do so becomes the owner and
     can invite models and chatting managers from the menu.
"""

from __future__ import annotations

import logging
import os
import secrets
import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from typing import Iterator, Optional, Sequence

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
log = logging.getLogger("repel")


# =========================================================================== #
# Constants
# =========================================================================== #
class Role(str, Enum):
    OWNER = "owner"
    MANAGER = "manager"
    MODEL = "model"


class RequestType(str, Enum):
    CUSTOM = "custom"
    RELOAD = "reload"


class RequestStatus(str, Enum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    DENIED = "denied"
    DELIVERED = "delivered"
    CANCELLED = "cancelled"


# Edit this list to match the content categories your agency works with.
RELOAD_CONTENT_TYPES = ["Nudes", "Lewds / teasing", "Feet", "Photos (SFW)", "Video", "Other"]
SKIP_WORDS = {"skip", "-", "none", "no", "n/a", "na"}

TYPE_LABELS = {RequestType.CUSTOM.value: "Custom", RequestType.RELOAD.value: "Content reload"}
ROLE_LABELS = {Role.OWNER.value: "Owner", Role.MANAGER.value: "Manager", Role.MODEL.value: "Model"}
STATUS_LABELS = {
    RequestStatus.PENDING.value: "⏳ Pending",
    RequestStatus.ACCEPTED.value: "✅ Accepted",
    RequestStatus.DENIED.value: "❌ Declined",
    RequestStatus.DELIVERED.value: "📦 Delivered",
    RequestStatus.CANCELLED.value: "🚫 Cancelled",
}


# =========================================================================== #
# Configuration
# =========================================================================== #
@dataclass(frozen=True)
class Config:
    bot_token: str
    owner_id: int
    db_path: str
    state_path: str


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
    return Config(
        bot_token=token,
        owner_id=owner_id,
        db_path=os.getenv("DB_PATH", "repel.db").strip() or "repel.db",
        state_path=os.getenv("STATE_PATH", "repel_state.pickle").strip() or "repel_state.pickle",
    )


# =========================================================================== #
# Database (SQLite)
# =========================================================================== #
_DB_PATH = "repel.db"


def db_configure(path: str) -> None:
    global _DB_PATH
    _DB_PATH = path


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


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
CREATE TABLE IF NOT EXISTS requests (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_id  INTEGER NOT NULL,
    model_id      INTEGER NOT NULL,
    type          TEXT    NOT NULL,
    content_type  TEXT,
    details       TEXT,
    status        TEXT    NOT NULL,
    eta           TEXT,
    decline_reason TEXT,
    created_at    TEXT    NOT NULL,
    updated_at    TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_requests_requester ON requests(requester_id);
CREATE INDEX IF NOT EXISTS idx_requests_model     ON requests(model_id);
CREATE INDEX IF NOT EXISTS idx_requests_status    ON requests(status);
"""


def init_db() -> None:
    with _conn() as c:
        c.executescript(SCHEMA)


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


def create_invite(role: str, label: Optional[str], created_by: int) -> str:
    code = secrets.token_urlsafe(8)
    with _conn() as c:
        c.execute(
            "INSERT INTO invites (code, role, label, created_by, created_at) VALUES (?, ?, ?, ?, ?)",
            (code, role, label, created_by, _now()))
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


def create_request(requester_id: int, model_id: int, type_: str,
                   content_type: Optional[str], details: Optional[str]) -> int:
    now = _now()
    with _conn() as c:
        cur = c.execute(
            "INSERT INTO requests (requester_id, model_id, type, content_type, details, "
            "status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (requester_id, model_id, type_, content_type, details,
             RequestStatus.PENDING.value, now, now))
        return int(cur.lastrowid)


def get_request(request_id: int) -> Optional[sqlite3.Row]:
    with _conn() as c:
        return c.execute("SELECT * FROM requests WHERE id = ?", (request_id,)).fetchone()


def update_request(request_id: int, **fields) -> None:
    if not fields:
        return
    fields["updated_at"] = _now()
    assignments = ", ".join(f"{key} = ?" for key in fields)
    values: list = list(fields.values()) + [request_id]
    with _conn() as c:
        c.execute(f"UPDATE requests SET {assignments} WHERE id = ?", values)


def list_requests_by_requester(requester_id: int, limit: int = 15) -> list[sqlite3.Row]:
    with _conn() as c:
        return list(c.execute(
            "SELECT * FROM requests WHERE requester_id = ? ORDER BY id DESC LIMIT ?",
            (requester_id, limit)).fetchall())


def list_requests_for_model(model_id: int, statuses: Sequence[str], limit: int = 25) -> list[sqlite3.Row]:
    placeholders = ", ".join("?" for _ in statuses)
    with _conn() as c:
        return list(c.execute(
            f"SELECT * FROM requests WHERE model_id = ? AND status IN ({placeholders}) "
            "ORDER BY id DESC LIMIT ?",
            [model_id, *statuses, limit]).fetchall())


def list_recent_requests(limit: int = 15) -> list[sqlite3.Row]:
    with _conn() as c:
        return list(c.execute(
            "SELECT * FROM requests ORDER BY id DESC LIMIT ?", (limit,)).fetchall())


# =========================================================================== #
# Inline keyboards
# =========================================================================== #
def _rows(buttons, per_row: int = 1):
    return [list(buttons[i:i + per_row]) for i in range(0, len(buttons), per_row)]


def owner_menu() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("📝 New request", callback_data="menu:new")],
        [InlineKeyboardButton("➕ Invite model", callback_data="owner:invite:model"),
         InlineKeyboardButton("➕ Invite manager", callback_data="owner:invite:manager")],
        [InlineKeyboardButton("👥 People", callback_data="owner:people"),
         InlineKeyboardButton("📋 All requests", callback_data="owner:feed")],
    ])


def manager_menu() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("📝 New request", callback_data="menu:new")],
        [InlineKeyboardButton("📋 My requests", callback_data="menu:myrequests")],
    ])


def model_menu() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([[InlineKeyboardButton("📥 My queue", callback_data="menu:queue")]])


def model_picker(models) -> InlineKeyboardMarkup:
    buttons = [InlineKeyboardButton(m["display_name"], callback_data=f"nr:model:{m['telegram_id']}")
               for m in models]
    rows = _rows(buttons, per_row=2)
    rows.append([InlineKeyboardButton("✖ Cancel", callback_data="nr:cancel")])
    return InlineKeyboardMarkup(rows)


def type_picker() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("🎬 Custom", callback_data="nr:type:custom"),
         InlineKeyboardButton("🔁 Content reload", callback_data="nr:type:reload")],
        [InlineKeyboardButton("✖ Cancel", callback_data="nr:cancel")],
    ])


def content_picker() -> InlineKeyboardMarkup:
    buttons = [InlineKeyboardButton(name, callback_data=f"nr:content:{i}")
               for i, name in enumerate(RELOAD_CONTENT_TYPES)]
    rows = _rows(buttons, per_row=2)
    rows.append([InlineKeyboardButton("✖ Cancel", callback_data="nr:cancel")])
    return InlineKeyboardMarkup(rows)


def confirm_picker() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("✅ Send request", callback_data="nr:confirm"),
         InlineKeyboardButton("✖ Cancel", callback_data="nr:cancel")],
    ])


def accept_decline(request_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([[
        InlineKeyboardButton("✅ Accept", callback_data=f"req:accept:{request_id}"),
        InlineKeyboardButton("❌ Decline", callback_data=f"req:decline:{request_id}"),
    ]])


def mark_delivered(request_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([[
        InlineKeyboardButton("📦 Mark delivered", callback_data=f"req:deliver:{request_id}")]])


def decline_skip() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([[
        InlineKeyboardButton("Skip reason", callback_data="req:declineskip")]])


# =========================================================================== #
# Message text builders (plain text — no parse_mode, so names never break)
# =========================================================================== #
def _name(telegram_id: int) -> str:
    user = get_user(telegram_id)
    return user["display_name"] if user else f"user {telegram_id}"


def _fmt_dt(iso: str) -> str:
    try:
        return datetime.fromisoformat(iso).strftime("%b %d, %H:%M")
    except (ValueError, TypeError):
        return iso


def request_card(req: sqlite3.Row, *, audience: str = "owner") -> str:
    lines = [f"#{req['id']} • {TYPE_LABELS.get(req['type'], req['type'])}"]
    if audience == "model":
        lines.append(f"From: {_name(req['requester_id'])}")
    elif audience == "manager":
        lines.append(f"Model: {_name(req['model_id'])}")
    else:
        lines.append(f"Model: {_name(req['model_id'])}")
        lines.append(f"From: {_name(req['requester_id'])}")
    if req["content_type"]:
        lines.append(f"Content: {req['content_type']}")
    if req["details"]:
        lines.append(f"Details: {req['details']}")
    lines.append(f"Status: {STATUS_LABELS.get(req['status'], req['status'])}")
    if req["eta"]:
        lines.append(f"ETA: {req['eta']}")
    if req["decline_reason"]:
        lines.append(f"Reason: {req['decline_reason']}")
    lines.append(f"Created: {_fmt_dt(req['created_at'])}")
    return "\n".join(lines)


def request_list(requests_, *, audience: str, empty: str) -> str:
    if not requests_:
        return empty
    return ("\n" + "—" * 12 + "\n").join(request_card(r, audience=audience) for r in requests_)


def new_request_for_model(req: sqlite3.Row) -> str:
    return ("🆕 New request for you\n\n" + request_card(req, audience="model")
            + "\n\nTap Accept and I'll ask for an ETA, or Decline.")


def summary_for_confirm(model_name: str, type_label: str,
                        content_type: Optional[str], details: Optional[str]) -> str:
    lines = ["Please confirm this request:", "", f"Model: {model_name}", f"Type: {type_label}"]
    if content_type:
        lines.append(f"Content: {content_type}")
    if details:
        lines.append(f"Details: {details}")
    return "\n".join(lines)


# =========================================================================== #
# Shared helpers
# =========================================================================== #
def role_of(telegram_id: int) -> Optional[str]:
    user = get_user(telegram_id)
    if user is None or not user["is_active"]:
        return None
    return user["role"]


def is_owner(telegram_id: int, context: ContextTypes.DEFAULT_TYPE) -> bool:
    return role_of(telegram_id) == Role.OWNER.value


def display_name(update: Update) -> str:
    user = update.effective_user
    return (user.full_name or user.username or str(user.id)).strip()


async def send(update: Update, context: ContextTypes.DEFAULT_TYPE, text: str, reply_markup=None):
    return await context.bot.send_message(
        chat_id=update.effective_chat.id, text=text, reply_markup=reply_markup)


def menu_for(role: str):
    if role == Role.OWNER.value:
        return owner_menu()
    if role == Role.MANAGER.value:
        return manager_menu()
    if role == Role.MODEL.value:
        return model_menu()
    return None


# =========================================================================== #
# Onboarding: /start, /help, /cancel, fallback
# =========================================================================== #
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    tg_user = update.effective_user
    name = display_name(update)
    config = context.bot_data["config"]
    existing = get_user(tg_user.id)

    if existing is None:
        await _register_new_user(update, context, name, config)
        return

    if config.owner_id and tg_user.id == config.owner_id and existing["role"] != Role.OWNER.value:
        set_role(tg_user.id, Role.OWNER.value)
        existing = get_user(tg_user.id)

    touch_user(tg_user.id, name, tg_user.username)
    if not existing["is_active"]:
        await send(update, context, "Your access has been deactivated. Contact the agency owner.")
        return
    await _show_home(update, context, existing["role"], name)


async def _register_new_user(update, context, name, config) -> None:
    tg_user = update.effective_user
    args = context.args or []

    if (config.owner_id and tg_user.id == config.owner_id) or count_users() == 0:
        create_user(tg_user.id, Role.OWNER.value, name, tg_user.username)
        await send(
            update, context,
            f"👑 Welcome, {name}. You're set up as the agency owner.\n\n"
            "Invite your models and chatting managers from the menu below — each gets a "
            "one-time link.",
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
                   "That invite link is invalid or has already been used. Ask the owner for a new one.")
        return
    if not consume_invite(code, tg_user.id):
        await send(update, context, "That invite link has just been used. Ask the owner for a new one.")
        return
    role = invite["role"]
    create_user(tg_user.id, role, name, tg_user.username)
    await _show_home(update, context, role, name,
                     prefix=f"✅ You're registered as a {ROLE_LABELS.get(role, role)}.\n\n")


async def _show_home(update, context, role: str, name: str, prefix: str = "") -> None:
    if role == Role.OWNER.value:
        body = "👑 Owner menu — you can see and manage everything."
    elif role == Role.MANAGER.value:
        body = f"Hi {name}! Use the menu to request customs or content reloads from your models."
    else:
        body = (f"Hi {name}! Requests from your team land right here. You'll get a message to "
                "Accept/Decline and add an ETA. Tap below to see your queue.")
    await send(update, context, prefix + body, reply_markup=menu_for(role))


async def help_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    role = role_of(update.effective_user.id)
    if role is None:
        await send(update, context, "You're not registered. Ask the agency owner for an invite link.")
        return
    common_lines = ["/start — open your menu", "/help — show this help", "/cancel — stop the current step"]
    if role == Role.OWNER.value:
        extra = ["/invite model | manager — create an invite link", "/people — list everyone",
                 "/feed — recent requests", "/newrequest — raise a request yourself"]
    elif role == Role.MANAGER.value:
        extra = ["/newrequest — request a custom or content reload", "/myrequests — your requests & status"]
    else:
        extra = ["/queue — your pending & accepted requests"]
    await send(update, context,
               "\n".join([f"You're a {ROLE_LABELS.get(role, role)}.", "", *extra, "", *common_lines]),
               reply_markup=menu_for(role))


async def cancel_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data.clear()
    role = role_of(update.effective_user.id)
    await send(update, context, "Okay, cancelled.", reply_markup=menu_for(role) if role else None)
    return ConversationHandler.END


async def fallback_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    role = role_of(update.effective_user.id)
    if role in (Role.MANAGER.value, Role.OWNER.value):
        await send(update, context,
                   "Want to send that as a request? Tap below and I'll walk you through it.",
                   reply_markup=manager_menu() if role == Role.MANAGER.value else owner_menu())
    elif role == Role.MODEL.value:
        await send(update, context, "Tap below to see your current requests.", reply_markup=model_menu())
    else:
        await send(update, context, "You're not registered. Ask the agency owner for an invite link.")


# =========================================================================== #
# Owner / admin
# =========================================================================== #
async def _bot_username(context: ContextTypes.DEFAULT_TYPE) -> str:
    cached = context.bot_data.get("bot_username")
    if cached:
        return cached
    me = await context.bot.get_me()
    context.bot_data["bot_username"] = me.username
    return me.username


async def _owner_guard(update: Update, context: ContextTypes.DEFAULT_TYPE) -> bool:
    if is_owner(update.effective_user.id, context):
        return True
    if update.callback_query:
        await update.callback_query.answer("Owner only.", show_alert=True)
    else:
        await send(update, context, "That command is for the agency owner only.")
    return False


async def _make_invite(update, context, role: str) -> None:
    code = create_invite(role, label=None, created_by=update.effective_user.id)
    username = await _bot_username(context)
    link = f"https://t.me/{username}?start={code}"
    label = ROLE_LABELS.get(role, role)
    await send(update, context,
               f"➕ One-time {label} invite created.\n\nSend this link to the {label.lower()} — "
               f"it works once:\n{link}")


async def invite_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not await _owner_guard(update, context):
        return
    args = [a.lower() for a in (context.args or [])]
    role = Role.MODEL.value if "model" in args else (Role.MANAGER.value if "manager" in args else None)
    if role is None:
        await send(update, context, "Usage: /invite model   — or —   /invite manager")
        return
    await _make_invite(update, context, role)


async def invite_cb(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    q = update.callback_query
    await q.answer()
    if not await _owner_guard(update, context):
        return
    role = q.data.split(":")[2]
    if role in (Role.MODEL.value, Role.MANAGER.value):
        await _make_invite(update, context, role)


def _people_text_and_kb():
    lines, buttons = [], []
    for role in (Role.MANAGER.value, Role.MODEL.value):
        people = list_by_role(role, active_only=False)
        lines.append(f"\n{ROLE_LABELS[role]}s ({sum(1 for p in people if p['is_active'])} active):")
        if not people:
            lines.append("  — none yet")
        for p in people:
            tag = f" @{p['username']}" if p["username"] else ""
            status = "" if p["is_active"] else "  (inactive)"
            lines.append(f"  • {p['display_name']}{tag}{status}")
            if p["is_active"]:
                buttons.append([InlineKeyboardButton(
                    f"🚫 Deactivate {p['display_name']}",
                    callback_data=f"owner:deact:{p['telegram_id']}")])
    text = "👥 People" + ("\n" + "\n".join(lines) if lines else "")
    return text, InlineKeyboardMarkup(buttons) if buttons else None


async def people_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not await _owner_guard(update, context):
        return
    text, kb = _people_text_and_kb()
    await send(update, context, text, reply_markup=kb)


async def people_cb(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.callback_query.answer()
    if not await _owner_guard(update, context):
        return
    text, kb = _people_text_and_kb()
    await send(update, context, text, reply_markup=kb)


async def deactivate_cb(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    q = update.callback_query
    await q.answer()
    if not await _owner_guard(update, context):
        return
    target_id = int(q.data.split(":")[2])
    user = get_user(target_id)
    if user is None:
        await q.answer("No such user.", show_alert=True)
        return
    set_active(target_id, False)
    await q.answer(f"{user['display_name']} deactivated.")
    text, kb = _people_text_and_kb()
    await q.edit_message_text(text, reply_markup=kb)


async def feed_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not await _owner_guard(update, context):
        return
    await _send_feed(update, context)


async def feed_cb(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.callback_query.answer()
    if not await _owner_guard(update, context):
        return
    await _send_feed(update, context)


async def _send_feed(update, context) -> None:
    rows = list_recent_requests(limit=12)
    body = request_list(rows, audience="owner", empty="No requests yet.")
    await send(update, context, "📋 Recent requests\n\n" + body)


# =========================================================================== #
# Requests: notifications
# =========================================================================== #
async def _notify(context, req: sqlite3.Row, header: str, *, exclude=()) -> None:
    text = header + "\n\n" + request_card(req, audience="owner")
    recipients = {req["requester_id"]}
    for owner_user in list_by_role(Role.OWNER.value):
        recipients.add(owner_user["telegram_id"])
    for chat_id in recipients - set(exclude):
        try:
            await context.bot.send_message(chat_id=chat_id, text=text)
        except TelegramError as exc:
            log.warning("Could not notify %s about request %s: %s", chat_id, req["id"], exc)


# =========================================================================== #
# Requests: new-request wizard (managers and owner)
# =========================================================================== #
NR_MODEL, NR_TYPE, NR_CONTENT, NR_OTHER, NR_DETAILS, NR_CONFIRM = range(6)
MA_ETA, MA_REASON = range(2)


async def nr_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.callback_query:
        await update.callback_query.answer()
    if role_of(update.effective_user.id) not in (Role.MANAGER.value, Role.OWNER.value):
        await send(update, context, "Only managers can raise requests.")
        return ConversationHandler.END
    models = list_by_role(Role.MODEL.value)
    if not models:
        await send(update, context, "There are no models registered yet. Ask the owner to invite one.")
        return ConversationHandler.END
    context.user_data["nr"] = {}
    await send(update, context, "Who is this request for?", reply_markup=model_picker(models))
    return NR_MODEL


async def nr_model(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    model_id = int(q.data.split(":")[2])
    model = get_user(model_id)
    if model is None or not model["is_active"]:
        await q.edit_message_text("That model is no longer available. Start again with /newrequest.")
        return ConversationHandler.END
    context.user_data["nr"] = {"model_id": model_id, "model_name": model["display_name"]}
    await q.edit_message_text(f"Request for {model['display_name']}.\nWhat kind?",
                              reply_markup=type_picker())
    return NR_TYPE


async def nr_type(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    req_type = q.data.split(":")[2]
    context.user_data["nr"]["type"] = req_type
    if req_type == RequestType.RELOAD.value:
        await q.edit_message_text("Which content?", reply_markup=content_picker())
        return NR_CONTENT
    await q.edit_message_text("Describe the custom — what should she create?\n(Send it as a message.)")
    return NR_DETAILS


async def nr_content(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    idx = int(q.data.split(":")[2])
    choice = RELOAD_CONTENT_TYPES[idx]
    if choice.lower().startswith("other"):
        await q.edit_message_text("Type the content type you want reloaded:")
        return NR_OTHER
    context.user_data["nr"]["content_type"] = choice
    await q.edit_message_text(
        f"Content: {choice}.\nAny extra details? (e.g. quantity, theme)\nSend a message, or type 'skip'.")
    return NR_DETAILS


async def nr_other(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = (update.message.text or "").strip()
    if not text:
        await send(update, context, "Please type the content type, or /cancel.")
        return NR_OTHER
    context.user_data["nr"]["content_type"] = text
    await send(update, context,
               "Got it. Any extra details? (e.g. quantity, theme)\nSend a message, or type 'skip'.")
    return NR_DETAILS


async def nr_details(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = (update.message.text or "").strip()
    data = context.user_data["nr"]
    is_custom = data["type"] == RequestType.CUSTOM.value
    if is_custom:
        if not text:
            await send(update, context, "Please describe the custom, or /cancel.")
            return NR_DETAILS
        data["details"] = text
    else:
        data["details"] = None if text.lower() in SKIP_WORDS else (text or None)
    summary = summary_for_confirm(data["model_name"], TYPE_LABELS[data["type"]],
                                  data.get("content_type"), data.get("details"))
    await send(update, context, summary, reply_markup=confirm_picker())
    return NR_CONFIRM


async def nr_confirm(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    data = context.user_data.get("nr") or {}
    if "model_id" not in data:
        await q.edit_message_text("Something went wrong. Start again with /newrequest.")
        return ConversationHandler.END
    req_id = create_request(
        requester_id=update.effective_user.id, model_id=data["model_id"], type_=data["type"],
        content_type=data.get("content_type"), details=data.get("details"))
    req = get_request(req_id)
    context.user_data.pop("nr", None)

    delivered = True
    try:
        await context.bot.send_message(chat_id=data["model_id"],
                                       text=new_request_for_model(req),
                                       reply_markup=accept_decline(req_id))
    except Forbidden:
        delivered = False
    except TelegramError as exc:
        delivered = False
        log.warning("Failed to deliver request %s to model: %s", req_id, exc)

    if delivered:
        await q.edit_message_text(
            f"✅ Sent to {data['model_name']} (request #{req_id}). You'll be notified when she responds.")
    else:
        await q.edit_message_text(
            f"⚠️ Request #{req_id} saved, but I couldn't message {data['model_name']} — she may not "
            "have started the bot yet. Ask her to open her invite link.")
    await _notify(context, req, "🆕 New request raised", exclude=(update.effective_user.id,))
    return ConversationHandler.END


# =========================================================================== #
# Requests: model actions (accept + ETA, decline + reason, deliver)
# =========================================================================== #
def _owns_request(update: Update, req) -> bool:
    return req is not None and req["model_id"] == update.effective_user.id


async def req_accept(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    req_id = int(q.data.split(":")[2])
    req = get_request(req_id)
    if not _owns_request(update, req):
        await q.answer("This request isn't yours.", show_alert=True)
        return ConversationHandler.END
    if req["status"] != RequestStatus.PENDING.value:
        await q.answer("Already handled.")
        return ConversationHandler.END
    await q.answer()
    await q.edit_message_reply_markup(reply_markup=None)
    context.user_data["ma"] = {"id": req_id, "msg": (q.message.chat_id, q.message.message_id)}
    await send(update, context,
               "Great! When will it be ready?\nSend an ETA, e.g. 'Tomorrow 8pm', 'Fri', 'Jun 20'.")
    return MA_ETA


async def ma_eta(update: Update, context: ContextTypes.DEFAULT_TYPE):
    eta = (update.message.text or "").strip()
    ma = context.user_data.get("ma") or {}
    req_id = ma.get("id")
    req = get_request(req_id) if req_id else None
    if not _owns_request(update, req) or req["status"] != RequestStatus.PENDING.value:
        context.user_data.pop("ma", None)
        await send(update, context, "That request is no longer pending.")
        return ConversationHandler.END
    if not eta:
        await send(update, context, "Please send an ETA, or /cancel.")
        return MA_ETA
    update_request(req_id, status=RequestStatus.ACCEPTED.value, eta=eta)
    req = get_request(req_id)
    await _refresh_model_message(context, ma.get("msg"), req, mark_delivered(req_id))
    context.user_data.pop("ma", None)
    await send(update, context, f"✅ Accepted. ETA noted: {eta}. I'll let the team know.",
               reply_markup=menu_for(Role.MODEL.value))
    await _notify(context, req, "✅ Request accepted")
    return ConversationHandler.END


async def req_decline(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    req_id = int(q.data.split(":")[2])
    req = get_request(req_id)
    if not _owns_request(update, req):
        await q.answer("This request isn't yours.", show_alert=True)
        return ConversationHandler.END
    if req["status"] != RequestStatus.PENDING.value:
        await q.answer("Already handled.")
        return ConversationHandler.END
    await q.answer()
    await q.edit_message_reply_markup(reply_markup=None)
    prompt = await send(update, context, "Okay. Want to add a reason? Send a message, or tap Skip.",
                        reply_markup=decline_skip())
    context.user_data["ma"] = {
        "id": req_id,
        "msg": (q.message.chat_id, q.message.message_id),
        "prompt": (prompt.chat_id, prompt.message_id),
    }
    return MA_REASON


async def _finish_decline(update, context, reason):
    ma = context.user_data.get("ma") or {}
    req_id = ma.get("id")
    req = get_request(req_id) if req_id else None
    if not _owns_request(update, req) or req["status"] != RequestStatus.PENDING.value:
        context.user_data.pop("ma", None)
        return ConversationHandler.END
    update_request(req_id, status=RequestStatus.DENIED.value, decline_reason=reason)
    req = get_request(req_id)
    await _refresh_model_message(context, ma.get("msg"), req, None)
    prompt = ma.get("prompt")
    if prompt:
        try:
            await context.bot.edit_message_reply_markup(chat_id=prompt[0], message_id=prompt[1],
                                                        reply_markup=None)
        except TelegramError as exc:
            log.debug("Could not clear decline prompt for request %s: %s", req_id, exc)
    context.user_data.pop("ma", None)
    await _notify(context, req, "❌ Request declined")
    return ConversationHandler.END


async def ma_reason(update: Update, context: ContextTypes.DEFAULT_TYPE):
    reason = (update.message.text or "").strip() or None
    result = await _finish_decline(update, context, reason)
    await send(update, context, "Declined. The team has been notified.",
               reply_markup=menu_for(Role.MODEL.value))
    return result


async def ma_reason_skip(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.callback_query.answer()
    result = await _finish_decline(update, context, None)
    await send(update, context, "Declined. The team has been notified.",
               reply_markup=menu_for(Role.MODEL.value))
    return result


async def deliver_cb(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    req_id = int(q.data.split(":")[2])
    req = get_request(req_id)
    if not _owns_request(update, req):
        await q.answer("This request isn't yours.", show_alert=True)
        return
    if req["status"] != RequestStatus.ACCEPTED.value:
        await q.answer("This request can't be marked delivered.")
        return
    await q.answer("Marked delivered 📦")
    update_request(req_id, status=RequestStatus.DELIVERED.value)
    req = get_request(req_id)
    await q.edit_message_text(request_card(req, audience="model"))
    await _notify(context, req, "📦 Request delivered")


async def _refresh_model_message(context, msg, req, reply_markup) -> None:
    if not msg:
        return
    chat_id, message_id = msg
    try:
        await context.bot.edit_message_text(chat_id=chat_id, message_id=message_id,
                                            text=request_card(req, audience="model"),
                                            reply_markup=reply_markup)
    except TelegramError as exc:
        log.debug("Could not refresh model message for request %s: %s", req["id"], exc)


# =========================================================================== #
# Requests: listings
# =========================================================================== #
async def my_requests_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await _show_my_requests(update, context)


async def queue_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await _show_queue(update, context)


async def menu_cb(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    action = q.data.split(":")[1]
    if action == "myrequests":
        await _show_my_requests(update, context)
    elif action == "queue":
        await _show_queue(update, context)


async def _show_my_requests(update, context) -> None:
    role = role_of(update.effective_user.id)
    if role not in (Role.MANAGER.value, Role.OWNER.value):
        await send(update, context, "Nothing here for your role.")
        return
    rows = list_requests_by_requester(update.effective_user.id)
    body = request_list(rows, audience="manager", empty="You haven't raised any requests yet.")
    await send(update, context, "📋 Your requests\n\n" + body)


async def _show_queue(update, context) -> None:
    if role_of(update.effective_user.id) != Role.MODEL.value:
        await send(update, context, "Only models have a request queue.")
        return
    pending = list_requests_for_model(update.effective_user.id, [RequestStatus.PENDING.value])
    accepted = list_requests_for_model(update.effective_user.id, [RequestStatus.ACCEPTED.value])
    if not pending and not accepted:
        await send(update, context, "📥 Your queue is empty. Nice!")
        return
    await send(update, context, "📥 Your queue")
    for req in pending:
        await context.bot.send_message(chat_id=update.effective_chat.id,
                                       text=request_card(req, audience="model"),
                                       reply_markup=accept_decline(req["id"]))
    for req in accepted:
        await context.bot.send_message(chat_id=update.effective_chat.id,
                                       text=request_card(req, audience="model"),
                                       reply_markup=mark_delivered(req["id"]))


# =========================================================================== #
# Requests: conversation factories
# =========================================================================== #
def new_request_conversation() -> ConversationHandler:
    return ConversationHandler(
        entry_points=[
            CommandHandler("newrequest", nr_start),
            CallbackQueryHandler(nr_start, pattern=r"^menu:new$"),
        ],
        states={
            NR_MODEL: [CallbackQueryHandler(nr_model, pattern=r"^nr:model:\d+$")],
            NR_TYPE: [CallbackQueryHandler(nr_type, pattern=r"^nr:type:(custom|reload)$")],
            NR_CONTENT: [CallbackQueryHandler(nr_content, pattern=r"^nr:content:\d+$")],
            NR_OTHER: [MessageHandler(filters.TEXT & ~filters.COMMAND, nr_other)],
            NR_DETAILS: [MessageHandler(filters.TEXT & ~filters.COMMAND, nr_details)],
            NR_CONFIRM: [
                CallbackQueryHandler(nr_confirm, pattern=r"^nr:confirm$"),
                CallbackQueryHandler(nr_cancel, pattern=r"^nr:cancel$"),
            ],
        },
        fallbacks=[
            CallbackQueryHandler(nr_cancel, pattern=r"^nr:cancel$"),
            CommandHandler("cancel", nr_cancel),
            CommandHandler("start", _exit_to_start),
            CommandHandler("help", _exit_to_start),
        ],
        name="new_request", persistent=True, allow_reentry=True,
    )


async def _exit_to_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data.pop("nr", None)
    context.user_data.pop("ma", None)
    await start(update, context)
    return ConversationHandler.END


async def nr_cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data.pop("nr", None)
    role = role_of(update.effective_user.id)
    if update.callback_query:
        await update.callback_query.answer()
        await update.callback_query.edit_message_text("Cancelled.")
    else:
        await send(update, context, "Cancelled.")
    if role:
        await send(update, context, "Back to your menu.", reply_markup=menu_for(role))
    return ConversationHandler.END


def model_action_conversation() -> ConversationHandler:
    return ConversationHandler(
        entry_points=[
            CallbackQueryHandler(req_accept, pattern=r"^req:accept:\d+$"),
            CallbackQueryHandler(req_decline, pattern=r"^req:decline:\d+$"),
        ],
        states={
            MA_ETA: [MessageHandler(filters.TEXT & ~filters.COMMAND, ma_eta)],
            MA_REASON: [
                CallbackQueryHandler(ma_reason_skip, pattern=r"^req:declineskip$"),
                MessageHandler(filters.TEXT & ~filters.COMMAND, ma_reason),
            ],
        },
        fallbacks=[
            CommandHandler("cancel", _ma_cancel),
            CommandHandler("start", _exit_to_start),
            CommandHandler("help", _exit_to_start),
        ],
        name="model_action", persistent=True, allow_reentry=True,
    )


async def _ma_cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data.pop("ma", None)
    await send(update, context, "Cancelled — the request is unchanged.",
               reply_markup=menu_for(Role.MODEL.value))
    return ConversationHandler.END


# =========================================================================== #
# Application assembly
# =========================================================================== #
async def _post_init(app: Application) -> None:
    me = await app.bot.get_me()
    app.bot_data["bot_username"] = me.username
    await app.bot.set_my_commands([
        BotCommand("start", "Open your menu"),
        BotCommand("newrequest", "Request a custom or content reload"),
        BotCommand("myrequests", "Your requests & their status"),
        BotCommand("queue", "Models: your request queue"),
        BotCommand("invite", "Owner: create an invite link"),
        BotCommand("people", "Owner: list everyone"),
        BotCommand("feed", "Owner: recent requests"),
        BotCommand("help", "Show help"),
        BotCommand("cancel", "Stop the current step"),
    ])
    log.info("REPEL is running as @%s", me.username)


async def _on_error(update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
    log.exception("Unhandled error while processing update: %s", context.error)


def build_application(config: Config) -> Application:
    db_configure(config.db_path)
    init_db()
    persistence = PicklePersistence(filepath=config.state_path)
    app = (Application.builder().token(config.bot_token).persistence(persistence)
           .post_init(_post_init).build())
    app.bot_data["config"] = config

    # Conversations first so they can intercept /start, /cancel, /help while active.
    app.add_handler(new_request_conversation())
    app.add_handler(model_action_conversation())

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("help", help_cmd))
    app.add_handler(CommandHandler("cancel", cancel_cmd))

    app.add_handler(CommandHandler("invite", invite_cmd))
    app.add_handler(CommandHandler("people", people_cmd))
    app.add_handler(CommandHandler("feed", feed_cmd))
    app.add_handler(CallbackQueryHandler(invite_cb, pattern=r"^owner:invite:(model|manager)$"))
    app.add_handler(CallbackQueryHandler(people_cb, pattern=r"^owner:people$"))
    app.add_handler(CallbackQueryHandler(feed_cb, pattern=r"^owner:feed$"))
    app.add_handler(CallbackQueryHandler(deactivate_cb, pattern=r"^owner:deact:\d+$"))

    app.add_handler(CommandHandler("myrequests", my_requests_cmd))
    app.add_handler(CommandHandler("queue", queue_cmd))
    app.add_handler(CallbackQueryHandler(deliver_cb, pattern=r"^req:deliver:\d+$"))
    app.add_handler(CallbackQueryHandler(menu_cb, pattern=r"^menu:(myrequests|queue)$"))

    # Stray-text fallback last, same group, so an active conversation always wins.
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, fallback_text))

    app.add_error_handler(_on_error)
    return app


def main() -> None:
    config = load_config()
    app = build_application(config)
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
