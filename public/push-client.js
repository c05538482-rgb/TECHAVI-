(() => {
  'use strict';
  const VAPID_URL = '/api/push/public-key';
  const SUB_URL = '/api/push/subscribe';
  const TEST_URL = '/api/push/test';

  function b64ToBytes(base64) {
    const padding = '='.repeat((4 - base64.length % 4) % 4);
    const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
  }

  async function getUser() {
    try { const r = await fetch('/api/auth/me', { credentials: 'include' }); return (await r.json()).user || null; }
    catch (_) { return null; }
  }

  function makeButton() {
    let b = document.getElementById('techaviPushButton');
    if (b) return b;
    b = document.createElement('button');
    b.id = 'techaviPushButton';
    b.type = 'button';
    b.textContent = '🔔 Bildirimleri Aç';
    Object.assign(b.style, {
      position:'fixed', right:'18px', bottom:'18px', zIndex:'99999',
      border:'1px solid rgba(255,255,255,.18)', borderRadius:'999px',
      padding:'11px 16px', background:'rgba(15,20,30,.96)', color:'#fff',
      boxShadow:'0 8px 30px rgba(0,0,0,.35)', cursor:'pointer', fontWeight:'700'
    });
    document.body.appendChild(b);
    return b;
  }

  async function enablePush() {
    const user = await getUser();
    if (!user) { alert('Önce TechAvı hesabına giriş yapmalısın.'); return; }
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) { alert('Bu tarayıcı push bildirimlerini desteklemiyor.'); return; }
    const keyRes = await fetch(VAPID_URL, { credentials:'include' });
    const keyData = await keyRes.json();
    if (!keyData.ok || !keyData.publicKey) { alert('Bildirim sistemi henüz yapılandırılmamış.'); return; }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') { alert('Bildirim izni verilmedi.'); return; }
    const reg = await navigator.serviceWorker.register('/sw.js', { scope:'/' });
    const existing = await reg.pushManager.getSubscription();
    const sub = existing || await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:b64ToBytes(keyData.publicKey) });
    const r = await fetch(SUB_URL, { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body:JSON.stringify({subscription:sub.toJSON()}) });
    const result = await r.json();
    if (!result.ok) throw new Error(result.error || 'Abonelik başarısız');
    const button = makeButton();
    button.textContent = '✅ Bildirimler Açık';
    button.style.opacity = '.75';
    try { await fetch(TEST_URL, { method:'POST', credentials:'include' }); } catch (_) {}
  }


  const extraStores = [
    ['amazon', 'Amazon Türkiye', '🟠'],
    ['pazarama', 'Pazarama', '🟣'],
    ['ciceksepeti', 'Çiçeksepeti', '🌸']
  ];
  function renderExtraStores(payload) {
    const stores = payload?.stores || {};
    const available = extraStores.filter(([id]) => stores[id]);
    if (!available.length) return;
    let panel = document.getElementById('techaviExtraStores');
    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'techaviExtraStores';
      panel.innerHTML = `<div style="font-size:18px;font-weight:800;margin:18px 0 10px">🛒 Yeni Mağazalar</div><div class="techavi-extra-grid"></div>`;
      Object.assign(panel.style, {margin:'10px auto 24px',maxWidth:'1180px',padding:'0 16px'});
      document.body.appendChild(panel);
    }
    const grid = panel.querySelector('.techavi-extra-grid');
    grid.innerHTML = available.map(([id,name,icon]) => {
      const s = stores[id] || {};
      const count = Number(s.count || s.products?.length || 0);
      return `<div style="display:inline-flex;align-items:center;gap:10px;margin:5px;padding:10px 14px;border:1px solid rgba(255,255,255,.12);border-radius:14px;background:rgba(255,255,255,.04)"><span style="font-size:20px">${icon}</span><b>${name}</b><span style="opacity:.7">${count} sonuç</span></div>`;
    }).join('');
  }

  function hookSearchResults() {
    if (window.__techaviFetchHooked) return;
    window.__techaviFetchHooked = true;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      try {
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
        if (url.includes('/api/search')) {
          response.clone().json().then(renderExtraStores).catch(() => {});
        }
      } catch (_) {}
      return response;
    };
  }

  async function boot() {
    hookSearchResults();
    if (!window.isSecureContext) return;
    const user = await getUser();
    if (!user) return;
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
    const button = makeButton();
    if (Notification.permission === 'granted') button.textContent = '🔔 Bildirimleri Yönet';
    button.addEventListener('click', () => enablePush().catch(e => { console.error(e); alert('Bildirim kurulamadı: ' + e.message); }));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
