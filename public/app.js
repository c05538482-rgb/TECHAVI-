const $ = s => document.querySelector(s);
const state = { user: null, selected: null };

function money(v) {
  return v == null ? "—" : Number(v).toLocaleString("tr-TR", { maximumFractionDigits: 2 }) + " TL";
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[c]));
}

async function api(url, options={}) {
  const r = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "İstek başarısız");
  return j;
}

async function loadMe() {
  const j = await api("/api/auth/me");
  state.user = j.user;
  renderAccount();
}
function renderAccount() {
  const el = $("#account");
  if (!state.user) {
    el.innerHTML = `<button class="ghost" id="loginBtn">Giriş / Kayıt</button>`;
    $("#loginBtn").onclick = () => openAuth("login");
  } else {
    el.innerHTML = `<span>👤 ${esc(state.user.name)}</span>
      <button class="ghost" id="alarmsBtn">🔔 Alarmlar</button>
      <button class="ghost" id="logoutBtn">Çıkış</button>`;
    $("#alarmsBtn").onclick = loadAlarms;
    $("#logoutBtn").onclick = async () => { await api("/api/auth/logout",{method:"POST"}); state.user=null; renderAccount(); };
  }
}

function openAuth(mode="login") {
  $("#authModal").classList.remove("hidden");
  const login = mode === "login";
  $("#authContent").innerHTML = `
    <div class="tabs"><button class="${login?"active":""}" id="tabLogin">Giriş</button><button class="${!login?"active":""}" id="tabRegister">Kayıt</button></div>
    <div id="authFormBox"></div>`;
  $("#tabLogin").onclick=()=>openAuth("login");
  $("#tabRegister").onclick=()=>openAuth("register");
  $("#authFormBox").innerHTML = login ? `
    <form id="loginForm" class="auth-form">
      <input name="email" type="email" placeholder="E-posta" required>
      <input name="password" type="password" placeholder="Şifre" required>
      <button class="primary">Giriş Yap</button>
      <div class="msg" id="authMsg"></div>
    </form>` : `
    <form id="registerForm" class="auth-form">
      <input name="name" placeholder="Adınız" required>
      <input name="email" type="email" placeholder="E-posta" required>
      <input name="password" type="password" minlength="6" placeholder="En az 6 karakter şifre" required>
      <button class="primary">Hesap Oluştur</button>
      <div class="msg" id="authMsg"></div>
    </form>`;

  const form = login ? $("#loginForm") : $("#registerForm");
  form.onsubmit = async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    try {
      const j = await api(login?"/api/auth/login":"/api/auth/register",{method:"POST",body:JSON.stringify(data)});
      state.user=j.user;
      $("#authModal").classList.add("hidden");
      renderAccount();
    } catch(err) { $("#authMsg").textContent=err.message; }
  };
}

function card(p) {
  return `<article class="card">
    <div class="img">${p.image ? `<img src="${esc(p.image)}" loading="lazy" onerror="this.style.display='none'">` : "🛒"}</div>
    <div class="card-body">
      <div class="store">${esc(p.store)}</div>
      <h3>${esc(p.title)}</h3>
      <div class="prices"><strong>${money(p.price)}</strong>${p.originalPrice && p.originalPrice>p.price?`<del>${money(p.originalPrice)}</del>`:""}</div>
      ${p.discount?`<span class="discount">-%${p.discount}</span>`:""}
      <div class="actions">
        <a class="open" href="${esc(p.url)}" target="_blank" rel="noopener">Mağazaya Git</a>
        <button class="alarm" data-p='${esc(JSON.stringify(p))}'>🔔 Alarm</button>
      </div>
    </div>
  </article>`;
}

async function search() {
  const q=$("#query").value.trim();
  if(q.length<2) return;
  $("#status").textContent="Aranıyor…";
  $("#results").innerHTML="";
  try {
    const j=await api("/api/search?q="+encodeURIComponent(q));
    const products=j.products||[];
    ["trendyol","hepsiburada","n11"].forEach(s=>{
      const c=j.stores?.[s]?.count;
      $("#count-"+s).textContent=c!=null?`${c.toLocaleString("tr-TR")} ürün bulundu`:"Sonuç yok";
    });
    $("#resultTitle").textContent=`"${q}" sonuçları`;
    $("#status").textContent=products.length?`${products.length} gösterilen ürün`:"Sonuç bulunamadı";
    $("#results").innerHTML=products.map(card).join("");
    document.querySelectorAll(".alarm").forEach(b=>b.onclick=()=>openAlarm(JSON.parse(b.dataset.p)));
  } catch(e) {
    $("#status").textContent=e.message;
  }
}

function openAlarm(p) {
  if(!state.user){ openAuth("login"); return; }
  state.selected=p;
  $("#alarmProduct").innerHTML=`<b>${esc(p.title)}</b><br>${esc(p.store)} · mevcut: <b>${money(p.price)}</b>`;
  $("#targetPrice").value="";
  $("#alarmMsg").textContent="";
  $("#alarmModal").classList.remove("hidden");
}

$("#saveAlarm").onclick=async()=>{
  const p=state.selected, target=Number($("#targetPrice").value);
  if(!target) return $("#alarmMsg").textContent="Hedef fiyat gir.";
  try{
    await api("/api/alarms",{method:"POST",body:JSON.stringify({
      store:p.store,title:p.title,url:p.url,productId:p.id,targetPrice:target
    })});
    $("#alarmMsg").textContent="✅ Alarm kuruldu.";
  }catch(e){$("#alarmMsg").textContent=e.message;}
};

async function loadAlarms() {
  try {
    const j=await api("/api/alarms");
    $("#alarmsModal").classList.remove("hidden");
    $("#alarmList").innerHTML=j.alarms.length?j.alarms.map(a=>`
      <div class="alarm-row">
        <div><b>${esc(a.title)}</b><br><small>${esc(a.store)} · Hedef: ${money(a.target_price)} · Güncel: ${money(a.current_price)}</small></div>
        <button data-id="${a.id}" class="danger del-alarm">Kapat</button>
      </div>`).join(""):"Henüz alarm yok.";
    document.querySelectorAll(".del-alarm").forEach(b=>b.onclick=async()=>{await api("/api/alarms/"+b.dataset.id,{method:"DELETE"});loadAlarms();});
  }catch(e){alert(e.message);}
}

document.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>$("#"+b.dataset.close).classList.add("hidden"));
$("#searchForm").onsubmit=e=>{e.preventDefault();search();};
$("#query").addEventListener("keydown",e=>{if(e.key==="Enter")search();});
loadMe();
