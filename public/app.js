// Telegram init
const tg = window.Telegram?.WebApp;
if (tg) {
  tg.expand();
}

// Backend URL (боевой)
const API = "https://mindhelper-miniapp.onrender.com";

let currentScenario = null;

// --- Robot mouth animation ---
let audioCtx = null;
let analyser = null;
let mouthEl = null;
let mouthAnimId = null;

function attachMouthElement(){
  const img = document.getElementById("robot-avatar");
  if (!img) return;

  fetch(img.src)
    .then(r => r.text())
    .then(svgText => {
      const wrap = img.parentElement;
      wrap.innerHTML = svgText + `<div class="robot-caption" id="robot-caption">Я слушаю тебя…</div>`;
      mouthEl = wrap.querySelector("#mouth");
    });
}

function startMouthSync(audioElement){
  if (!mouthEl) return;

  if (!audioCtx){
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
  }

  const source = audioCtx.createMediaElementSource(audioElement);
  source.connect(analyser);
  analyser.connect(audioCtx.destination);

  const data = new Uint8Array(analyser.frequencyBinCount);

  function tick(){
    analyser.getByteTimeDomainData(data);

    let sum = 0;
    for (let i=0;i<data.length;i++){
      const v = (data[i]-128)/128;
      sum += v*v;
    }
    const rms = Math.sqrt(sum/data.length);

    const open = Math.min(3.2, 1 + rms*12);
    mouthEl.setAttribute("transform", `scale(1, ${open}) translate(0, ${-8*(open-1)})`);

    mouthAnimId = requestAnimationFrame(tick);
  }

  tick();
}

function stopMouthSync(){
  if (mouthAnimId) cancelAnimationFrame(mouthAnimId);
  mouthAnimId = null;
  if (mouthEl){
    mouthEl.setAttribute("transform", "scale(1,1)");
  }
}

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

  const caption = document.getElementById("robot-caption");
  if (caption) caption.textContent = "Думаю…";

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

  // MVP: “фейковая” анимация речи (пока нет реального аудио)
  if (caption) caption.textContent = "Говорю…";
  let fakeAudio = new Audio(); // пустышка
  startMouthSync(fakeAudio);

  setTimeout(()=>{
    stopMouthSync();
    if (caption) caption.textContent = "Я слушаю тебя…";
  }, 1500);
}

// initial
showScreen("home");
attachMouthElement();