const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const state = {
  products: [],
  allProducts: [],
  user: null,
  selected: null,
  query: "",
  activeStore: "all",
  searchTimer: null,
  controller: null,
  requestId: 0,
  storeCounts: { trendyol: null, hepsiburada: null, n11: null, mediamarkt: null, teknosa: null, vatan: null },
  favorites: new Set(JSON.parse(localStorage.getItem("techavi_favs") || "[]"))
};

function money(v) {
  if (v == null || v === "") return "—";
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("tr-TR", { maximumFractionDigits: 2 }) + " TL" : "—";
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
}
function discount(p) {
  if (p.discount != null && Number(p.discount) > 0) return Math.round(Number(p.discount));
  const old = Number(p.originalPrice), price = Number(p.price);
  return old > price && price > 0 ? Math.round((1 - price / old) * 100) : 0;
}
function toast(text) {
  const el = $("#toast");
  if (!el) return;
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}
function saveFavs() {
  localStorage.setItem("techavi_favs", JSON.stringify([...state.favorites]));
  updateCounts();
}
function updateCounts() {
  $("#favCount").textContent = state.favorites.size;
  $("#dashFav").textContent = state.favorites.size;
}

function productImage(p, cls = "product-image") {
  if (p.image && /^https?:\/\//i.test(p.image)) {
    return `<img class="${cls}" loading="lazy" decoding="async" src="${esc(p.image)}" alt="" onerror="this.style.display='none'">`;
  }
  return "🛍️";
}

function storeName(s) {
  return ({
    trendyol:"Trendyol",
    hepsiburada:"Hepsiburada",
    n11:"n11",
    mediamarkt:"MediaMarkt",
    teknosa:"Teknosa",
    vatan:"Vatan Bilgisayar",
    amazon:"Amazon Türkiye",
    pazarama:"Pazarama",
    ciceksepeti:"Çiçeksepeti"
  }[String(s).toLowerCase()] || s || "Mağaza");
}
function storeKey(s) {
  const x = String(s || "").toLowerCase().trim();
  if (x.includes("trendyol")) return "trendyol";
  if (x.includes("hepsiburada")) return "hepsiburada";
  if (x === "n11" || x.includes("n11")) return "n11";
  if (x.includes("mediamarkt")) return "mediamarkt";
  if (x.includes("teknosa")) return "teknosa";
  if (x.includes("vatan")) return "vatan";
  if (x.includes("amazon")) return "amazon";
  if (x.includes("pazarama")) return "pazarama";
  if (x.includes("ciceksepeti") || x.includes("çiçeksepeti")) return "ciceksepeti";
  return x;
}
function storeKey(s) {
  const x = String(s || "").toLowerCase();
  if (x.includes("trendyol")) return "trendyol";
  if (x.includes("hepsiburada")) return "hepsiburada";
  if (x === "n11" || x.includes("n11")) return "n11";
  if (x.includes("mediamarkt")) return "mediamarkt";
  if (x.includes("teknosa")) return "teknosa";
  if (x.includes("vatan")) return "vatan";
  return x;
}

function renderCard(p) {
  const id = String(p.id || p.product_id || `${p.store}-${p.title}`);
  const d = discount(p);
  return `<article class="card" data-id="${encodeURIComponent(id)}">
    <div class="pic">
      <span class="discount">${d > 0 ? `-%${d}` : esc(storeName(p.store))}</span>
      <button class="heart ${state.favorites.has(id) ? "on" : ""}" data-heart="${esc(id)}">${state.favorites.has(id) ? "♥" : "♡"}</button>
      <div class="image-frame">${productImage(p)}</div>
    </div>
    <div class="info">
      <div class="cat">${esc(p.brand || storeName(p.store))}</div>
      <div class="name" title="${esc(p.title)}">${esc(p.title)}</div>
      <div class="price-line"><span class="price">${money(p.price)}</span>${p.originalPrice && Number(p.originalPrice) > Number(p.price) ? `<span class="old">${money(p.originalPrice)}</span>` : ""}</div>
      <div class="store">● ${esc(storeName(p.store))}${p.stock ? " • Stok bilgisi mevcut" : ""}</div>
      <div class="card-actions">
        ${p.url && p.url !== "#" ? `<a class="store-link" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer" data-store-link>Mağazaya Git ↗</a>` : `<button class="store-link disabled" type="button" disabled>Mağaza bağlantısı yok</button>`}
      </div>
      <div class="bar"><i style="width:${Math.min(100, Math.max(12, d || 12))}%"></i></div>
    </div>
  </article>`;
}

function renderStoreCounts() {
  for (const key of ["trendyol", "hepsiburada", "n11", "mediamarkt", "teknosa", "vatan"]) {
    const value = state.storeCounts[key];
    $(`#count-${key}`).textContent = value == null ? "Arama bekleniyor" : `${Number(value).toLocaleString("tr-TR")} ürün bulundu`;
  }
}

function render() {
  let items = state.allProducts.slice();
  if (state.activeStore !== "all") items = items.filter(p => storeKey(p.store) === state.activeStore);

  $("#resultCount").textContent = state.query ? `• ${items.length} gösterilen ürün` : "";
  $("#sectionTitle").textContent = state.query ? `🔎 "${state.query}" sonuçları` : "🔎 Ürün ara";

  if (!state.query) {
    $("#grid").innerHTML = `<div class="empty-grid"><div><div style="font-size:38px;margin-bottom:10px">⌕</div><b>Bir ürün ara</b><br><span>Örneğin: RTX 5070, LEGO Technic Supra MK4 veya ASUS TUF</span></div></div>`;
    return;
  }

  $("#grid").innerHTML = items.length
    ? items.map(renderCard).join("")
    : `<div class="empty-grid"><div><b>Sonuç bulunamadı.</b><br><span>Farklı bir ürün adı veya model deneyebilirsin.</span></div></div>`;

  $$(".card").forEach(card => card.addEventListener("click", e => {
    if (e.target.closest("[data-heart]")) return;
    if (e.target.closest("[data-store-link]")) return;
    openProduct(decodeURIComponent(card.dataset.id));
  }));
  $$('[data-heart]').forEach(btn => btn.addEventListener("click", e => {
    e.stopPropagation();
    const id = btn.dataset.heart;
    if (state.favorites.has(id)) { state.favorites.delete(id); toast("Favorilerden çıkarıldı."); }
    else { state.favorites.add(id); toast("Favorilere eklendi."); }
    saveFavs();
    render();
  }));
}

function showLoading(q) {
  $("#sectionTitle").textContent = `🔎 "${q}" aranıyor`;
  $("#resultCount").textContent = "• mağazalar kontrol ediliyor...";
  $("#grid").innerHTML = `<div class="loading-grid"><div class="loading-spinner"></div><span>Trendyol, Hepsiburada, n11, MediaMarkt, Teknosa ve Vatan aranıyor…</span></div>`;
}

async function searchProducts(q) {
  const clean = q.trim();
  state.query = clean;
  state.activeStore = "all";
  renderStoreCounts();

  if (state.controller) state.controller.abort();
  const myId = ++state.requestId;

  if (clean.length < 2) {
    state.allProducts = [];
    state.storeCounts = { trendyol: null, hepsiburada: null, n11: null, mediamarkt: null, teknosa: null, vatan: null };
    renderStoreCounts();
    render();
    return;
  }

  showLoading(clean);
  const controller = new AbortController();
  state.controller = controller;

  try {
    const r = await fetch(`/api/search?q=${encodeURIComponent(clean)}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" }
    });
    const j = await r.json().catch(() => ({}));
    if (myId !== state.requestId) return;
    if (!r.ok) throw new Error(j.error || "Arama başarısız.");

    state.allProducts = Array.isArray(j.products) ? j.products : [];
    state.storeCounts = {
      trendyol: j.stores?.trendyol?.count ?? 0,
      hepsiburada: j.stores?.hepsiburada?.count ?? 0,
      n11: j.stores?.n11?.count ?? 0,
      mediamarkt: j.stores?.mediamarkt?.count ?? 0,
      teknosa: j.stores?.teknosa?.count ?? 0,
      vatan: j.stores?.vatan?.count ?? 0
    };
    renderStoreCounts();
    render();

    const errors = Object.values(j.errors || {});
    if (errors.length === 3) toast("Mağazalardan veri alınamadı. ReefAPI bağlantısını kontrol et.");
    else if (errors.length) toast("Bazı mağazalar bu aramada yanıt vermedi.");
  } catch (e) {
    if (e.name === "AbortError") return;
    if (myId !== state.requestId) return;
    state.allProducts = [];
    $("#resultCount").textContent = "";
    $("#grid").innerHTML = `<div class="empty-grid"><div><b>Arama sırasında hata oluştu.</b><br><span>${esc(e.message)}</span></div></div>`;
  } finally {
    if (myId === state.requestId) state.controller = null;
  }
}

function scheduleSearch() {
  const q = $("#search").value;
  clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(() => searchProducts(q), 550);
}

function setupSuggestions() {
  // Suggestions are intentionally local in V2; no extra ReefAPI request is made while typing.
  $("#suggestions").classList.add("hidden");
}

function normalizeForMatch(s) {
  return String(s || "").toLocaleLowerCase("tr-TR")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ").trim();
}
function matchScore(a, b) {
  const A = new Set(normalizeForMatch(a).split(" ").filter(x => x.length > 1));
  const B = new Set(normalizeForMatch(b).split(" ").filter(x => x.length > 1));
  if (!A.size || !B.size) return 0;
  let hit = 0; for (const x of A) if (B.has(x)) hit++;
  return hit / Math.max(A.size, B.size);
}
function getOffers(p) {
  const offers = [p];
  const targetKey = normalizeForMatch(p.title);
  for (const other of state.allProducts) {
    if (other === p || storeKey(other.store) === storeKey(p.store)) continue;
    const score = matchScore(targetKey, other.title);
    const sameBrand = p.brand && other.brand && normalizeForMatch(p.brand) === normalizeForMatch(other.brand);
    if (score >= 0.55 || (sameBrand && score >= 0.45)) offers.push(other);
  }
  const map = new Map();
  for (const o of offers) { const k = storeKey(o.store); if (!map.has(k)) map.set(k, o); }
  return [...map.values()].sort((a,b) => Number(a.price ?? Infinity) - Number(b.price ?? Infinity));
}

function detailShell(p, id) {
  const offers = getOffers(p);
  return `<div class="detail">
    <div class="detail-head">
      <div class="detail-emoji"><div class="image-frame">${productImage(p, "detail-image")}</div></div>
      <div class="detail-main">
        <div class="cat">${esc(storeName(p.store))}</div>
        <h2>${esc(p.title)}</h2>
        <div class="detail-price">${money(p.price)}</div>
        <div class="store">${p.url && p.url !== "#" ? `<a href="${esc(p.url)}" target="_blank" rel="noopener" style="color:#49e5b4">Mağazayı aç ↗</a>` : "Canlı mağaza verisi"}</div>
        <div class="actions"><button class="primary" id="alarmOpen">🔔 Fiyat Alarmı</button><button id="favOpen">${state.favorites.has(id) ? "♥ Favoride" : "♡ Favorile"}</button></div>
      </div>
    </div>
    <div class="analysis"><b>📊 Fiyat Analizi</b><p>${discount(p) ? `Görünen liste fiyatına göre %${discount(p)} indirim.` : "Bu sonuç için liste fiyatı bulunamadı."}</p></div>
    <div class="offer-head"><h3>Mağaza / Satıcı karşılaştırması</h3><span>${offers.length} mağaza sonucu</span></div>
    <div class="stores">${offers.map((o,i) => `<div class="store-row ${i===0 ? "cheapest" : ""}"><span><strong>${i===0 ? "🥇 " : ""}${esc(storeName(o.store))}</strong></span><b>${money(o.price)}</b></div>`).join("")}</div>
  </div>`;
}

function openProduct(id) {
  const p = state.allProducts.find(x => String(x.id) === String(id));
  if (!p) return;
  $("#modalBody").innerHTML = detailShell(p, id);
  $("#modal").classList.remove("hidden");
  document.body.classList.add("modal-open");

  $("#favOpen").onclick = () => {
    if (state.favorites.has(id)) { state.favorites.delete(id); toast("Favorilerden çıkarıldı."); }
    else { state.favorites.add(id); toast("Favorilere eklendi."); }
    saveFavs();
    $("#favOpen").textContent = state.favorites.has(id) ? "♥ Favoride" : "♡ Favorile";
    render();
  };
  $("#alarmOpen").onclick = () => openAlarm(p);
}

function closeModal() {
  $("#modal").classList.add("hidden");
  document.body.classList.remove("modal-open");
}

async function api(url, options = {}) {
  const r = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "İstek başarısız.");
  return j;
}

async function loadMe() {
  try { const j = await api("/api/auth/me"); state.user = j.user || null; }
  catch { state.user = null; }
  renderAccount();
}
function renderAccount() {
  $("#loginBtn").textContent = state.user ? `👤 ${state.user.name}` : "Giriş Yap";
}

function openAuth(mode = "login") {
  const login = mode === "login";
  $("#modalBody").innerHTML = `<div class="auth-box"><div class="auth-tabs"><button id="tabLogin" class="${login ? "active" : ""}">Giriş Yap</button><button id="tabRegister" class="${!login ? "active" : ""}">Kayıt Ol</button></div><div id="authForm"></div></div>`;
  $("#modal").classList.remove("hidden");
  document.body.classList.add("modal-open");
  renderAuthForm(mode);
  $("#tabLogin").onclick = () => { renderAuthForm("login"); $("#tabLogin").classList.add("active"); $("#tabRegister").classList.remove("active"); };
  $("#tabRegister").onclick = () => { renderAuthForm("register"); $("#tabRegister").classList.add("active"); $("#tabLogin").classList.remove("active"); };
}
function renderAuthForm(mode) {
  const reg = mode === "register";
  $("#authForm").innerHTML = reg
    ? `<input id="authName" placeholder="Ad Soyad"><input id="authEmail" type="email" placeholder="E-posta"><input id="authPassword" type="password" placeholder="Şifre (en az 6 karakter)"><button id="authSubmit" class="primary">Kayıt Ol</button><div id="authMsg" class="msg"></div>`
    : `<input id="authEmail" type="email" placeholder="E-posta"><input id="authPassword" type="password" placeholder="Şifre"><button id="authSubmit" class="primary">Giriş Yap</button><div id="authMsg" class="msg"></div>`;
  $("#authSubmit").onclick = async () => {
    const body = { email: $("#authEmail").value.trim(), password: $("#authPassword").value };
    if (reg) body.name = $("#authName").value.trim();
    try {
      const j = await api(`/api/auth/${reg ? "register" : "login"}`, { method: "POST", body: JSON.stringify(body) });
      state.user = j.user; $("#modal").classList.add("hidden"); document.body.classList.remove("modal-open"); renderAccount(); toast(reg ? "Hesabın oluşturuldu." : "Giriş yapıldı."); await loadAlarms(true);
    } catch (e) { $("#authMsg").textContent = e.message; }
  };
}

function openAlarm(p) {
  if (!state.user) { openAuth("login"); toast("Fiyat alarmı için önce giriş yapmalısın."); return; }
  state.selected = p;
  $("#modalBody").innerHTML = `<div class="auth-box alarm-box"><h2>🔔 Fiyat Alarmı</h2><p><b>${esc(p.title)}</b><br>${esc(storeName(p.store))} · mevcut: <b>${money(p.price)}</b></p><div class="alarm-form"><label for="targetPrice">Hedef fiyat</label><input id="targetPrice" type="number" inputmode="decimal" min="1" step="0.01" placeholder="Örn. 1.500" autocomplete="off"><button id="saveAlarm" class="primary">Alarmı Kur</button></div><div id="alarmMsg" class="msg"></div></div>`;
  const targetInput = $("#targetPrice");
  requestAnimationFrame(() => { targetInput.focus(); targetInput.select(); });
  $("#saveAlarm").onclick = async () => {
    const raw = String(targetInput.value || "").replace(/\s/g, "").replace(",", ".");
    const target = Number(raw);
    if (!Number.isFinite(target) || target <= 0) return $("#alarmMsg").textContent = "Geçerli bir hedef fiyat gir.";
    try {
      await api("/api/alarms", { method: "POST", body: JSON.stringify({ store: storeKey(p.store), title: p.title, url: p.url, productId: p.id, targetPrice: target }) });
      $("#alarmMsg").textContent = "✅ Alarm kuruldu.";
      await loadAlarms(true);
    } catch (e) { $("#alarmMsg").textContent = e.message; }
  };
}

async function loadAlarms(silent = false) {
  if (!state.user) { if (!silent) openAuth("login"); return; }
  try {
    const j = await api("/api/alarms");
    $("#alarmCount").textContent = j.alarms.filter(a => a.active).length;
    $("#dashAlarm").textContent = j.alarms.filter(a => a.active).length;
    if (!silent) {
      $("#modalBody").innerHTML = `<div class="auth-box"><h2>🔔 Alarmlarım</h2>${j.alarms.length ? j.alarms.map(a => `<div class="store-row"><span><b>${esc(a.title)}</b><small style="display:block;color:#718090">${esc(a.store)} · Hedef: ${money(a.target_price)} · Güncel: ${money(a.current_price)}</small></span><button class="danger" data-alarm-del="${a.id}">Kapat</button></div>`).join("") : `<div class="analysis">Henüz alarm yok.</div>`}</div>`;
      $$("[data-alarm-del]").forEach(b => b.onclick = async () => { await api(`/api/alarms/${b.dataset.alarmDel}`, { method: "DELETE" }); loadAlarms(false); });
      $("#modal").classList.remove("hidden"); document.body.classList.add("modal-open");
    }
  } catch (e) { if (!silent) toast(e.message); }
}

function showFavorites() {
  const items = state.allProducts.filter(p => state.favorites.has(String(p.id)));
  $("#modalBody").innerHTML = `<div class="auth-box"><h2>♡ Favoriler</h2>${items.length ? items.map(renderCard).join("") : `<div class="analysis">Bu aramada favorilediğin ürün yok. Favoriler cihazında saklanır.</div>`}</div>`;
  $("#modal").classList.remove("hidden");
}

function setStoreFilter(key) {
  state.activeStore = state.activeStore === key ? "all" : key;
  $$(".store-card").forEach(b => b.classList.toggle("active", b.dataset.store === state.activeStore));
  render();
}

function init() {
  updateCounts();
  renderStoreCounts();
  loadMe();
  setupSuggestions();

  $("#search").addEventListener("input", scheduleSearch);
  $("#search").addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); clearTimeout(state.searchTimer); searchProducts($("#search").value); }
  });
  $("#favBtn").onclick = showFavorites;
  $("#alarmBtn").onclick = () => loadAlarms(false);
  $("#loginBtn").onclick = () => state.user ? loadAlarms(false) : openAuth("login");
  $("#ctaBtn").onclick = () => state.products?.[0] ? openAlarm(state.products[0]) : toast("Önce bir ürün ara.");
  $(".close").onclick = closeModal;
  $("#modal").onclick = e => { if (e.target.id === "modal") closeModal(); };
  $$(".store-card").forEach(b => b.onclick = () => setStoreFilter(b.dataset.store));
  $$("[data-page]").forEach(b => b.onclick = () => toast("Bu bölüm canlı arama altyapısı hazır olduğunda doldurulacak."));
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeModal();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); $("#search").focus(); }
  });
  render();
}

init();
