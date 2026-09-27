const fs=require('fs'),path=require('path');
const root=process.cwd();
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const write=(p,s)=>fs.writeFileSync(path.join(root,p),s,'utf8');

let p=JSON.parse(read('package.json')); p.dependencies=p.dependencies||{};
if(!p.dependencies['web-push']) p.dependencies['web-push']='^3.6.7';
write('package.json',JSON.stringify(p,null,2)+'\n');

let s=read('server.js');
if(!s.includes("require('web-push')")) s=s.replace("const nodemailer=require('nodemailer');","const nodemailer=require('nodemailer');\nconst webpush=require('web-push');");
if(!s.includes('const pushFile=')) s=s.replace("const hotFile=path.join(dataDir,'hot-deals.json');","const hotFile=path.join(dataDir,'hot-deals.json');\nconst pushFile=path.join(dataDir,'push-subscriptions.json');");
if(!s.includes('function pushReady()')) s=s.replace("loadDiskCache();","loadDiskCache();\nfunction pushReady(){return Boolean(process.env.VAPID_PUBLIC_KEY&&process.env.VAPID_PRIVATE_KEY)}\nfunction setupPush(){if(pushReady()){webpush.setVapidDetails('mailto:techavi@onrender.com',process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);return true}return false}\nsetupPush();\nfunction getPushSubs(){return readJson(pushFile,[])}\nfunction savePushSubs(x){writeJson(pushFile,x)}\nasync function sendPushToUser(userId,payload){if(!pushReady())return 0;const all=getPushSubs();let sent=0,keep=[];for(const sub of all){if(sub.userId!==userId){keep.push(sub);continue}try{await webpush.sendNotification(sub.subscription,JSON.stringify(payload),{TTL:3600});sent++;keep.push(sub)}catch(e){const c=e?.statusCode;if(c!==404&&c!==410)keep.push(sub)}}savePushSubs(keep);return sent}\n");

let old="if(source==='n11')return reef('/n11/v1/search',{query:q,page:1,...opts},signal,apiKey);return null}";
let neu="if(source==='n11')return reef('/n11/v1/search',{query:q,page:1,...opts},signal,apiKey); if(source==='amazon')return reef('/amazon/v1/search',{query:q,marketplace:'com.tr',page:1,...opts},signal,apiKey); if(source==='pazarama')return reef('/pazarama/v1/search',{query:q,page:1,...opts},signal,apiKey); if(source==='ciceksepeti')return reef('/ciceksepeti/v1/search',{query:q,page:1,...opts},signal,apiKey); return null}";
if(s.includes(old)) s=s.replace(old,neu);
s=s.replace("const store=source==='trendyol'?'Trendyol':hb?'Hepsiburada':'n11';","const store=source==='trendyol'?'Trendyol':hb?'Hepsiburada':n11?'n11':source==='amazon'?'Amazon TR':source==='pazarama'?'Pazarama':source==='ciceksepeti'?'Çiçeksepeti':source;");
s=s.replace("['Trendyol','Hepsiburada','n11','Amazon TR','MediaMarkt','Teknosa','Vatan','İtopya','İncehesap'].map(name=>({name,configured:['Trendyol','Hepsiburada','n11'].includes(name)&&has,live:['Trendyol','Hepsiburada','n11'].includes(name)&&has}))","['Trendyol','Hepsiburada','n11','Amazon TR','Pazarama','Çiçeksepeti','MediaMarkt','Teknosa','Vatan','İtopya','İncehesap'].map(name=>({name,configured:['Trendyol','Hepsiburada','n11','Amazon TR','Pazarama','Çiçeksepeti'].includes(name)&&has,live:['Trendyol','Hepsiburada','n11','Amazon TR','Pazarama','Çiçeksepeti'].includes(name)&&has}))");
s=s.replace("const r=await runStores(['hepsiburada','n11'],key,{},undefined,apiKey);","const r=await runStores(['hepsiburada','n11','amazon','pazarama','ciceksepeti'],key,{},undefined,apiKey);");
s=s.replace("['Trendyol','Hepsiburada','n11'],{comparisonReady:true,comparisonLoaded:true,storeResults:{Trendyol:primary,Hepsiburada:r.byStore.hepsiburada||[],n11:r.byStore.n11||[]}}","['Trendyol','Hepsiburada','n11','Amazon TR','Pazarama','Çiçeksepeti'],{comparisonReady:true,comparisonLoaded:true,storeResults:{Trendyol:primary,Hepsiburada:r.byStore.hepsiburada||[],n11:r.byStore.n11||[],'Amazon TR':r.byStore.amazon||[],'Pazarama':r.byStore.pazarama||[],'Çiçeksepeti':r.byStore.ciceksepeti||[]}}");

if(!s.includes("app.get('/api/push/public-key'")){
 const ins="app.get('/api/push/public-key',(req,res)=>{if(!pushReady())return res.status(503).json({error:'Push sistemi henüz yapılandırılmadı.'});res.json({publicKey:process.env.VAPID_PUBLIC_KEY})});\napp.post('/api/push/subscribe',requireUser,(req,res)=>{if(!pushReady())return res.status(503).json({error:'Push sistemi henüz yapılandırılmadı.'});const subscription=req.body?.subscription;if(!subscription?.endpoint||!subscription?.keys?.p256dh||!subscription?.keys?.auth)return res.status(400).json({error:'Geçersiz bildirim aboneliği.'});const all=getPushSubs().filter(x=>x.subscription?.endpoint!==subscription.endpoint);all.push({userId:req.user.id,subscription,createdAt:new Date().toISOString()});savePushSubs(all);res.json({ok:true})});\napp.delete('/api/push/subscribe',requireUser,(req,res)=>{const endpoint=String(req.body?.endpoint||'');savePushSubs(getPushSubs().filter(x=>!(x.userId===req.user.id&&x.subscription?.endpoint===endpoint)));res.json({ok:true})});\napp.post('/api/push/test',requireUser,async(req,res)=>{if(!pushReady())return res.status(503).json({error:'Push sistemi henüz yapılandırılmadı.'});const sent=await sendPushToUser(req.user.id,{title:'TechAvı — Bildirimler aktif!',body:'Telefon bildirim testin başarılı. 🔔',url:APP_URL});res.json({ok:true,sent})});\n";
 s=s.replace("app.get('/api/admin/stats'",ins+"app.get('/api/admin/stats'");
}
write('server.js',s);

write('public/sw.js',`self.addEventListener('push',event=>{let d={title:'TechAvı',body:'Yeni fiyat bildirimi',url:'/'};try{if(event.data)d=Object.assign(d,event.data.json())}catch{}event.waitUntil(self.registration.showNotification(d.title,{body:d.body,icon:'/favicon.ico',badge:'/favicon.ico',data:{url:d.url||'/'}}))});
self.addEventListener('notificationclick',event=>{event.notification.close();const url=event.notification.data?.url||'/';event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{for(const c of list){if('focus' in c){c.navigate(url);return c.focus()}}return clients.openWindow(url)}))});
`);

let a=read('public/app.js');
if(!a.includes('function enablePushNotifications')){
 const add=`async function enablePushNotifications(){if(!currentUser)return toast('Önce giriş yapmalısın.');if(!('serviceWorker'in navigator)||!('PushManager'in window))return toast('Bu tarayıcı web bildirimlerini desteklemiyor.');try{const permission=await Notification.requestPermission();if(permission!=='granted')return toast('Bildirim izni verilmedi.');const reg=await navigator.serviceWorker.register('/sw.js');const pk=await fetch('/api/push/public-key').then(r=>r.json());if(!pk.publicKey)throw new Error(pk.error||'Push anahtarı alınamadı.');const sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(pk.publicKey)});const r=await fetch('/api/push/subscribe',{method:'POST',headers:authHeaders(),body:JSON.stringify({subscription:sub})});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||'Bildirim aboneliği kaydedilemedi.');toast('🔔 Telefon bildirimleri açıldı.')}catch(e){toast(e.message||'Bildirimler açılamadı.')}}\nfunction urlBase64ToUint8Array(s){const p='='.repeat((4-s.length%4)%4),b=(s+p).replace(/-/g,'+').replace(/_/g,'/'),r=atob(b),o=new Uint8Array(r.length);for(let i=0;i<r.length;i++)o[i]=r.charCodeAt(i);return o}\n`;
 a=a.replace("async function logout()",add+"\nasync function logout()");
}
a=a.replace("const stores=['Trendyol','Hepsiburada','n11'];","const stores=['Trendyol','Hepsiburada','n11','Amazon TR','Pazarama','Çiçeksepeti'];");
a=a.replace("for(const store of ['Trendyol','Hepsiburada','n11']){","for(const store of ['Trendyol','Hepsiburada','n11','Amazon TR','Pazarama','Çiçeksepeti']){");
a=a.replace("source:store==='trendyol'?'trendyol':store==='Hepsiburada'?'hepsiburada':'n11'","source:store==='Trendyol'?'trendyol':store==='Hepsiburada'?'hepsiburada':store==='n11'?'n11':store==='Amazon TR'?'amazon':store==='Pazarama'?'pazarama':'ciceksepeti'");
a=a.replace("`<button id=\"reefSettings\" class=\"secondary\">🔑 API Anahtarım</button><button id=\"logoutBtn\">Çıkış Yap</button>`","`<button id=\"reefSettings\" class=\"secondary\">🔑 API Anahtarım</button><button id=\"pushEnable\" class=\"secondary\">🔔 Telefon Bildirimlerini Aç</button><button id=\"pushTest\" class=\"secondary\">🧪 Bildirimi Test Et</button><button id=\"logoutBtn\">Çıkış Yap</button>`");
a=a.replace("if(logged){$('#logoutBtn').onclick=logout;$('#adminOpen').onclick=showAdmin;$('#reefSettings').onclick=()=>openReefSetup(false);return}","if(logged){$('#logoutBtn').onclick=logout;$('#adminOpen').onclick=showAdmin;$('#reefSettings').onclick=()=>openReefSetup(false);$('#pushEnable').onclick=enablePushNotifications;$('#pushTest').onclick=async()=>{try{const r=await fetch('/api/push/test',{method:'POST',headers:authHeaders()});const j=await r.json();if(!r.ok)throw new Error(j.error);toast(j.sent?'🧪 Test bildirimi gönderildi.':'Önce telefon bildirimlerini aç.')}catch(e){toast(e.message||'Test başarısız.')}};return}");
a=a.replace("async function init(){products=[];","async function init(){if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});products=[];");
a=a.replace("document.addEventListener('keydown'","$('#pushQuick')?.addEventListener('click',()=>{if(!currentUser){authModal();toast('Bildirimleri açmak için önce giriş yap.');return}enablePushNotifications()});\ndocument.addEventListener('keydown'");
write('public/app.js',a);

let h=read('public/index.html');
if(!h.includes('pushDashboard')) h=h.replace('<section class="dashboard"><div class="dash-title"><span>🏪</span>','<section id="pushDashboard" class="dashboard"><div class="dash-title"><span>🔔</span><div><b>Telefon Bildirimleri</b><small>Fiyat alarmın tetiklenince Chrome bildirim gönderir.</small></div><button id="pushQuick" class="primary">Bildirimleri Aç</button></div></section><section class="dashboard"><div class="dash-title"><span>🏪</span>');
write('public/index.html',h);
console.log('TechAvı patch uygulandı.');
