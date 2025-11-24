// Telegram init
const tg = window.Telegram?.WebApp;
if (tg) {
  tg.expand();
}

// Backend URL (локально)
const API = "http://127.0.0.1:8000";

let currentScenario = null;

// ----- NAVIGATION -----
const screens = {
  home: document.getElementById("screen-home"),
  diary: document.getElementById("screen-diary"),
  diaryAdd: document.getElementById("screen-diary-add"),
  scenarios: document.getElementById("screen-scenarios"),
  chat: document.getElementById("screen-chat"),
  progress: document.getElementById("screen-progress")
};

function showScreen(name){
  Object.values(screens).forEach(s => s.classList.remove("active"));
  screens[name].classList.add("active");

  document.querySelectorAll(".tab").forEach(t=>t.classList.remove("active"));
  const tab = document.querySelector(`.tab[data-nav="${name}"]`);
  if (tab) tab.classList.add("active");
}

// tabbar and cards nav
document.querySelectorAll("[data-nav]").forEach(el=>{
  el.addEventListener("click", ()=>{
    const nav = el.dataset.nav;
    if (nav === "diary") loadDiary();
    showScreen(nav);
  });
});

document.getElementById("btn-add-entry").addEventListener("click", ()=>{
  showScreen("diaryAdd");
});

// ----- DIARY -----
async function loadDiary(){
  const list = document.getElementById("diary-list");
  list.innerHTML = "Загрузка...";

  const initData = tg?.initData || "";
  const r = await fetch(API + "/diary", {
    headers: { "X-Telegram-InitData": initData }
  });
  const data = await r.json();

  if (!data.items.length){
    list.innerHTML = "<div class='hint'>Пока нет записей.</div>";
    return;
  }

  list.innerHTML = data.items.map(i => `
    <div class="entry">
      <div class="entry-top">
        <div>${i.created_at}</div>
        <div>${i.intensity}/10</div>
      </div>
      <div class="entry-emotion">${i.emotion}</div>
      <div class="entry-block"><b>Ситуация:</b> ${i.situation}</div>
      <div class="entry-block"><b>Мысли:</b> ${i.thoughts}</div>
      <div class="entry-block"><b>Тело:</b> ${i.body}</div>
    </div>
  `).join("");
}

document.getElementById("diary-form").addEventListener("submit", async (e)=>{
  e.preventDefault();

  const payload = {
    emotion: document.getElementById("emotion").value.trim(),
    intensity: Number(document.getElementById("intensity").value),
    situation: document.getElementById("situation").value.trim(),
    thoughts: document.getElementById("thoughts").value.trim(),
    body: document.getElementById("body").value.trim()
  };

  const initData = tg?.initData || "";
  await fetch(API + "/diary", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-InitData": initData
    },
    body: JSON.stringify(payload)
  });

  // clear form
  e.target.reset();
  await loadDiary();
  showScreen("diary");
});

// ----- SCENARIOS -> open chat with scenario context -----
document.querySelectorAll("[data-scenario]").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    currentScenario = btn.dataset.scenario;
    clearChat();
    addAiMsg("Выбран сценарий. Напиши, что у тебя происходит — и я помогу.");
    showScreen("chat");
  });
});

// ----- CHAT -----
const chatBox = document.getElementById("chat-box");
const chatInput = document.getElementById("chat-text");
const chatSend = document.getElementById("chat-send");

function addUserMsg(text){
  chatBox.insertAdjacentHTML("beforeend", `<div class="msg user">${text}</div>`);
  chatBox.scrollTop = chatBox.scrollHeight;
}
function addAiMsg(text){
  chatBox.insertAdjacentHTML("beforeend", `<div class="msg ai">${text}</div>`);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function clearChat(){
  chatBox.innerHTML = "";
}

document.getElementById("btn-clear-chat").addEventListener("click", ()=>{
  currentScenario = null;
  clearChat();
  addAiMsg("Чат сброшен. Можешь начать заново.");
});

chatSend.addEventListener("click", sendChat);
chatInput.addEventListener("keydown", (e)=>{
  if (e.key === "Enter") sendChat();
});

async function sendChat(){
  const text = chatInput.value.trim();
  if (!text) return;
  chatInput.value = "";

  addUserMsg(text);
  addAiMsg("Секундочку, думаю...");

  const initData = tg?.initData || "";
  const r = await fetch(API + "/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-InitData": initData
    },
    body: JSON.stringify({
      text,
      scenario: currentScenario
    })
  });

  const data = await r.json();
  // удалить "думаю..."
  chatBox.querySelector(".msg.ai:last-child").remove();
  addAiMsg(data.answer);
}

// initial
showScreen("home");
