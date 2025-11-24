import os, json, uuid
from datetime import datetime
from fastapi import BackgroundTasks

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
import aiosqlite

from openai import OpenAI

load_dotenv()

BOT_TOKEN = os.getenv("BOT_TOKEN", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
os.environ["OPENAI_API_KEY"] = OPENAI_API_KEY

client = OpenAI()

DB_PATH = "psybot.sqlite3"
UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

app = FastAPI()

# ---------- DB ----------
async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
        CREATE TABLE IF NOT EXISTS diary(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            emotion TEXT,
            intensity INTEGER,
            situation TEXT,
            thoughts TEXT,
            body TEXT,
            created_at TEXT
        )
        """)
        await db.commit()

@app.on_event("startup")
async def startup():
    await init_db()

# ---------- HELPERS ----------
SYSTEM_PROMPT = """Ты MindHelper — дружелюбный, очень тактичный ИИ-психолог.
Работаешь в стилях CBT/ACT, даёшь короткие безопасные рекомендации.
Не ставишь диагнозы.
Если видишь риск (суицид, самоповреждение, психоз, тяжелая депрессия/паника),
мягко рекомендуй обратиться к врачу/специалисту.
Отвечай на русском, эмпатично, без морализаторства."""

def build_messages(history, user_text, scenario=None):
    msgs = [{"role": "system", "content": SYSTEM_PROMPT}]
    if scenario:
        msgs.append({"role": "system", "content": f"Сценарий: {scenario}. Учитывай его в ответе."})

    if history:
        for h in history[-10:]:
            if isinstance(h, dict) and "role" in h and "content" in h:
                msgs.append({"role": h["role"], "content": h["content"]})

    msgs.append({"role": "user", "content": user_text})
    return msgs

# ---------- DIARY ----------
@app.get("/diary/list")
async def diary_list(user_id: int):
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            "SELECT emotion,intensity,situation,thoughts,body,created_at "
            "FROM diary WHERE user_id=? ORDER BY id DESC LIMIT 50",
            (user_id,)
        )
        rows = await cur.fetchall()

    items = []
    for r in rows:
        items.append({
            "emotion": r[0],
            "intensity": r[1],
            "situation": r[2],
            "thoughts": r[3],
            "body": r[4],
            "created_at": r[5],
        })
    return items

@app.post("/diary/add")
async def diary_add(payload: dict):
    required = ["user_id", "emotion", "intensity", "situation", "thoughts", "body"]
    for k in required:
        if k not in payload:
            raise HTTPException(400, f"Missing {k}")

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
        INSERT INTO diary(user_id,emotion,intensity,situation,thoughts,body,created_at)
        VALUES(?,?,?,?,?,?,?)
        """, (
            int(payload["user_id"]),
            payload["emotion"],
            int(payload["intensity"]),
            payload["situation"],
            payload["thoughts"],
            payload["body"],
            datetime.utcnow().isoformat()
        ))
        await db.commit()

    return {"ok": True}

# ---------- TEXT CHAT ----------
@app.post("/chat/text")
async def chat_text(payload: dict):
    text = payload.get("message", "")
    scenario = payload.get("scenario") or None
    history = payload.get("history") or []

    if not text:
        raise HTTPException(400, "Empty message")

    msgs = build_messages(history, text, scenario)

    resp = client.chat.completions.create(
        model="gpt-4.1-mini",
        messages=msgs,
        temperature=0.7
    )
    reply = resp.choices[0].message.content
    return {"reply": reply}

# ---------- VOICE CHAT ----------
@app.post("/chat/voice")
async def chat_voice(
    user_id: str = Form(...),
    scenario: str = Form(""),
    history: str = Form("[]"),
    audio: UploadFile = File(...)
):
    # 1) save temp audio
    ext = audio.filename.split(".")[-1]
    tmp_path = os.path.join(UPLOAD_DIR, f"{uuid.uuid4()}.{ext}")
    with open(tmp_path, "wb") as f:
        f.write(await audio.read())

    # Ограничение: если файл меньше 0.15 сек — ошибка
    size = os.path.getsize(tmp_path)
    if size < 3000:  # примерно 0.15s
        return {
            "error": "audio_short",
            "message": "Запись слишком короткая — скажи хотя бы 0.3 секунды 😊"
        }


    # 2) STT (распознаём речь)
    try:
        with open(tmp_path, "rb") as f:
            tr = client.audio.transcriptions.create(
                model="gpt-4o-mini-transcribe",
                file=f,
                language="ru"
            )
        user_text = tr.text.strip()
    except Exception:
        # чаще всего ошибка = слишком короткая запись
        return {
            "error": "audio_too_short",
            "message": "Скажи чуть дольше (хотя бы 0.2 сек) 😊"
        }

    if not user_text:
        return {
            "error": "empty_transcription",
            "message": "Я не расслышал. Попробуй ещё раз 🙏"
        }

    # 3) LLM psychologist
    try:
        hist = json.loads(history)
    except:
        hist = []

    msgs = build_messages(hist, user_text, scenario or None)

    resp = client.chat.completions.create(
        model="gpt-4.1-mini",
        messages=msgs,
        temperature=0.7
    )
    reply_text = resp.choices[0].message.content

    # 4) TTS (женский мягкий голос)
    try:
        speech = client.audio.speech.create(
            model="gpt-4o-mini-tts",
            voice="nova",
            input=reply_text,
            response_format="mp3"   # ✅ правильный параметр
        )
    except Exception:
        return {
            "error": "tts_failed",
            "message": "Не смог озвучить ответ, но вот текст:",
            "user_text": user_text,
            "reply": reply_text
        }

    out_name = f"{uuid.uuid4()}.mp3"
    out_path = os.path.join(UPLOAD_DIR, out_name)
    with open(out_path, "wb") as f:
        f.write(speech.read())

    audio_url = f"/uploads/{out_name}"

    return {
        "user_text": user_text,
        "reply": reply_text,
        "audio_url": audio_url
    }

# ---------- STATIC (ВАЖНО: ПОСЛЕ РОУТОВ) ----------
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")
app.mount("/", StaticFiles(directory="public", html=True), name="public")