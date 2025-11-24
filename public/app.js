// v7 cache bust — TG must reload

const API_BASE = window.location.origin;

let tg = window.Telegram?.WebApp;
let userId = null;

// INIT TELEGRAM
if (tg) {
  tg.ready();
  tg.expand();
  try {
    const initDataUnsafe = tg.initDataUnsafe;
    if (initDataUnsafe?.user?.id) userId = initDataUnsafe.user.id;
  } catch (e) {
    console.log("TG Init Error:", e);
  }
}

// DEV MODE for web
if (!userId) {
  userId = 999999;
  console.log("DEV MODE enabled");
}

// NAVIGATION
const screens = document.querySelectorAll(".screen");

function showScreen(id) {
  screens.forEach(s => s.classList.remove("active"));
  const el = document.getElementById(`screen-${id}`);
  if (el) el.classList.add("active");

  document.querySelectorAll(".tab").forEach(t => {
    if (t.dataset.nav === id) t.classList.add("active");
    else t.classList.remove("active");
  });
}

function bindNavButtons() {
  document.querySelectorAll("[data-nav]").forEach(btn => {
    btn.addEventListener("click", () => {
      const nav = btn.dataset.nav;
      if (!nav) return;
      if (nav === "diary") loadDiary();
      showScreen(nav);
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  bindNavButtons();
  if (tg) showScreen("chat");
  else showScreen("home");
});

// DIARY
const diaryListEl = document.getElementById("diary-list");
const btnAddEntry = document.getElementById("btn-add-entry");
if (btnAddEntry) btnAddEntry.addEventListener("click", () => showScreen("diary-add"));

async function loadDiary() {
  if (!diaryListEl) return;
  diaryListEl.innerHTML = `<div class="hint">Загрузка...</div>`;
  try {
    const resp = await fetch(`${API_BASE}/diary/list?user_id=${userId}`);
    const data = await resp.json();
    if (!data.length) {
      diaryListEl.innerHTML = `<div class="hint">Записей пока нет</div>`;
      return;
    }
    diaryListEl.innerHTML = "";
    data.forEach(item => {
      const div = document.createElement("div");
      div.className = "list-item";
      div.innerHTML = `
        <div class="item-emotion">${item.emotion} (${item.intensity}/10)</div>
        <div class="item-small">${item.situation}</div>
        <div class="item-date">${new Date(item.created_at).toLocaleString()}</div>
      `;
      diaryListEl.appendChild(div);
    });
  } catch (e) {
    console.log(e);
    diaryListEl.innerHTML = `<div class="hint">Ошибка загрузки</div>`;
  }
}

// DIARY ADD
const diaryForm = document.getElementById("diary-form");
if (diaryForm) {
  diaryForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      user_id: userId,
      emotion: document.getElementById("emotion").value,
      intensity: document.getElementById("intensity").value,
      situation: document.getElementById("situation").value,
      thoughts: document.getElementById("thoughts").value,
      body: document.getElementById("body").value
    };
    try {
      const resp = await fetch(`${API_BASE}/diary/add`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(payload)
      });
      if (resp.ok) {
        showScreen("diary");
        loadDiary();
      } else alert("Ошибка сохранения");
    } catch (e) {
      alert("Ошибка связи с сервером");
    }
  });
}

// SCENARIOS
document.querySelectorAll("[data-scenario]").forEach(btn => {
  btn.addEventListener("click", () => {
    const prompt = btn.dataset.scenario;
    openChat(prompt);
  });
});

// CHAT
const chatBox = document.getElementById("chat-box");
const chatInput = document.getElementById("chat-text");
const chatSend  = document.getElementById("chat-send");
const voiceBtn  = document.getElementById("voice-btn");
const btnClearChat = document.getElementById("btn-clear-chat");
const robotCaption = document.getElementById("robot-caption");

let chatHistory = [];
let currentScenario = null;

function appendMessage(role, text) {
  if (!chatBox) return;
  const wrap = document.createElement("div");
  wrap.className = "msg " + (role === "user" ? "me" : "bot");
  wrap.innerText = text;
  chatBox.appendChild(wrap);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function openChat(scenario = null) {
  currentScenario = scenario;
  showScreen("chat");
}

if (btnClearChat) {
  btnClearChat.addEventListener("click", () => {
    chatHistory = [];
    if (chatBox) chatBox.innerHTML = "";
    if (robotCaption) robotCaption.innerText = "Я слушаю тебя…";
  });
}

if (chatSend) chatSend.addEventListener("click", sendTextMessage);
if (chatInput) chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendTextMessage();
});

async function sendTextMessage() {
  const text = chatInput.value.trim();
  if (!text) return;
  chatInput.value = "";

  appendMessage("user", text);
  if (robotCaption) robotCaption.innerText = "Думаю…";

  chatHistory.push({role: "user", content: text});

  const payload = {
    user_id: userId,
    message: text,
    scenario: currentScenario,
    history: chatHistory
  };

  try {
    const resp = await fetch(`${API_BASE}/chat/text`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(payload)
    });
    const data = await resp.json();
    appendMessage("assistant", data.reply);
    if (robotCaption) robotCaption.innerText = "Я слушаю тебя…";
    chatHistory.push({role: "assistant", content: data.reply});
  } catch (e) {
    appendMessage("assistant", "Ошибка связи с сервером.");
    if (robotCaption) robotCaption.innerText = "Ошибка";
  }
}

// VOICE
let mediaRecorder = null;
let chunks = [];
let isRecording = false;

async function startRecording(){
  if (isRecording) return;
  isRecording = true;
  chunks = [];
  voiceBtn?.classList.add("recording");
  if (robotCaption) robotCaption.innerText = "Слушаю тебя… говори";

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  mediaRecorder.onstop = async () => {
    stream.getTracks().forEach(t => t.stop());
    voiceBtn?.classList.remove("recording");
    const blob = new Blob(chunks, { type: "audio/webm" });
    await sendVoice(blob);
  };

  mediaRecorder.start();
}

function stopRecording(){
  if (!isRecording) return;
  isRecording = false;
  if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
  if (robotCaption) robotCaption.innerText = "Думаю…";
}

async function sendVoice(blob) {
  if (!blob) return;
  if (window._voiceSending) return;
  window._voiceSending = true;

  appendMessage("user", "🎙 Голосовое сообщение отправлено");

  const form = new FormData();
  form.append("audio", blob, "voice.webm");
  form.append("user_id", String(userId));
  form.append("scenario", currentScenario || "");
  form.append("history", JSON.stringify(chatHistory));

  let data = null;
  try {
    const resp = await fetch(`${API_BASE}/chat/voice`, { method: "POST", body: form });
    data = await resp.json();
  } catch (e) {
    appendMessage("assistant", "Ошибка связи с сервером");
    if (robotCaption) robotCaption.innerText = "Я слушаю тебя…";
    window._voiceSending = false;
    return;
  }

  if (data.error) {
    appendMessage("assistant", data.message || "Ошибка голосового сообщения");
    if (robotCaption) robotCaption.innerText = "Я слушаю тебя…";
    window._voiceSending = false;
    return;
  }

  appendMessage("assistant", data.reply);
  chatHistory.push({ role: "assistant", content: data.reply });

  if (data.audio_url) {
    const audio = new Audio(data.audio_url);
    audio.onplay = () => { if (robotCaption) robotCaption.innerText = "Говорю…"; };
    audio.onended = () => { if (robotCaption) robotCaption.innerText = "Я слушаю тебя…"; };
    audio.play().catch(()=>{});
  } else {
    if (robotCaption) robotCaption.innerText = "Я слушаю тебя…";
  }

  window._voiceSending = false;
}

if (voiceBtn){
  voiceBtn.addEventListener("mousedown", startRecording);
  voiceBtn.addEventListener("touchstart", (e)=>{ e.preventDefault(); startRecording(); });
  voiceBtn.addEventListener("mouseup", stopRecording);
  voiceBtn.addEventListener("mouseleave", stopRecording);
  voiceBtn.addEventListener("touchend", stopRecording);
}