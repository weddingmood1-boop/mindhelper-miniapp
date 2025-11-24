import os
import hmac
import hashlib
from urllib.parse import parse_qsl

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import aiosqlite
from openai import OpenAI
from dotenv import load_dotenv

# ---- env ----
load_dotenv()  # берём ключи из корневого .env

BOT_TOKEN = os.getenv("BOT_TOKEN")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
os.environ["OPENAI_API_KEY"] = OPENAI_API_KEY

client = OpenAI(api_key=OPENAI_API_KEY)

DB_PATH = "psybot.sqlite3"

app = FastAPI()

# чтобы фронт мог ходить на бэкенд локально
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# раздаём фронт
app.mount("/", StaticFiles(directory="public", html=True), name="public")


# ---- Telegram initData validation ----
def validate_init_data(init_data: str, bot_token: str) -> dict:
    """
    Проверка подписи initData по правилам Telegram.
    https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
    """
    if not init_data:
        raise HTTPException(401, "Missing initData")

    data = dict(parse_qsl(init_data, strict_parsing=True))
    hash_recv = data.pop("hash", None)
    if not hash_recv:
        raise HTTPException(401, "No hash in initData")

    check_string = "\n".join([f"{k}={v}" for k, v in sorted(data.items())])

    secret = hmac.new(
        key=b"WebAppData",
        msg=bot_token.encode(),
        digestmod=hashlib.sha256
    ).digest()

    hash_calc = hmac.new(
        key=secret,
        msg=check_string.encode(),
        digestmod=hashlib.sha256
    ).hexdigest()

    if hash_calc != hash_recv:
        raise HTTPException(401, "Invalid initData")

    # user info в JSON строке
    user_json = data.get("user")
    return {"raw": data, "user": user_json}


async def get_user_id(init_data: str) -> int:
    valid = validate_init_data(init_data, BOT_TOKEN)
    # user приходит как JSON-строка, но чтобы не парсить в MVP:
    # возьмём id через простой поиск
    uj = valid["raw"].get("user", "")
    # выглядит примерно так: {"id":123,"first_name":"..."}
    # вытащим id грубо
    import json
    user = json.loads(uj)
    return int(user["id"])


# ---- models ----
class DiaryIn(BaseModel):
    emotion: str
    intensity: int
    situation: str
    thoughts: str
    body: str

class ChatIn(BaseModel):
    text: str
    scenario: str | None = None


# ---- diary endpoints ----
@app.get("/diary")
async def diary_get(x_telegram_initdata: str = Header(default="")):
    user_id = await get_user_id(x_telegram_initdata)

    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute("""
            SELECT emotion, intensity, situation, thoughts, body, created_at
            FROM diary_entries
            WHERE user_id=?
            ORDER BY created_at DESC
            LIMIT 30
        """, (user_id,))
        rows = await cur.fetchall()

    items = [
        {
            "emotion": r[0],
            "intensity": r[1],
            "situation": r[2],
            "thoughts": r[3],
            "body": r[4],
            "created_at": r[5]
        }
        for r in rows
    ]
    return {"items": items}


@app.post("/diary")
async def diary_post(payload: DiaryIn, x_telegram_initdata: str = Header(default="")):
    user_id = await get_user_id(x_telegram_initdata)

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            INSERT INTO diary_entries (user_id, emotion, intensity, situation, thoughts, body)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (
            user_id,
            payload.emotion,
            payload.intensity,
            payload.situation,
            payload.thoughts,
            payload.body
        ))
        await db.commit()

    return {"ok": True}


# ---- chat endpoint ----
@app.post("/chat")
async def chat_post(payload: ChatIn, x_telegram_initdata: str = Header(default="")):
    user_id = await get_user_id(x_telegram_initdata)

    # упрощённый MVP prompt
    system = """
Ты MindHelper — бережный ИИ-психолог.
Формат ответа: эмпатия → разбор → 1 практика → маленький шаг.
Не подтверждай бредовые/параноидные идеи, будь нейтрален.
"""

    if payload.scenario:
        system += f"\nСценарий: {payload.scenario}. Веди диалог в рамке сценария."

    resp = client.responses.create(
        model="gpt-4.1-mini",
        input=[
            {"role":"system","content": system},
            {"role":"user","content": payload.text}
        ]
    )

    return {"answer": resp.output_text}
