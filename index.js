require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');
const QRCode = require('qrcode');
const puppeteer = require('puppeteer');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');

const DATA_FILE = path.join(__dirname, 'data.json');
const MEDIA_DIR = path.join(__dirname, 'media');
if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });

const ADMINS = new Set((process.env.ADMIN_NUMBERS || '').split(',').map(x => normalizeNumber(x)).filter(Boolean));
const UPI_ID = process.env.UPI_ID || '';
const UPI_NAME = process.env.UPI_NAME || 'Document Service';
const PORT = Number(process.env.PORT || 10000);

const CATEGORIES = {
  '1': { name: 'Jati / Aawas / Niwas', docs: ['Identity Proof / Document Details','Passport Size Photo','Mobile Number','Email Address','Full Father\'s Name & Address Details'], plans: { '1':'Express (48 घंटे)', '2':'Normal (3 दिन)', '3':'Direct Digital' }, prices: { '1':300, '2':200, '3':120 } },
  '2': { name: 'Non-Creamy Layer (NCL)', docs: ['Identity Proof Document','Passport Size Photo','Income Details / Certificate','Caste Details / Certificate','Mobile Number & Email'], plans: { '1':'NCL Service' }, prices: { '1':150 } },
  '3': { name: 'Post Matric Scholarship (PMS)', docs: ['Caste Certificate Details','Income Certificate Details','Residence Certificate Details','Identity Proof','10th/12th Marksheet Details','Bonafide Certificate Details','Fee Receipt Details','Passport Photo','Mobile Number'], plans: { '1':'PMS Service' }, prices: { '1':250 } }
};

const DEFAULT_DATA = { users:{}, settings:{discount:0}, applications:{}, nextAppId:1 };
let data = loadData();
const sessions = new Map();
const startedAt = Date.now();
let latestQr = null;
let clientReady = false;
let clientState = 'starting';

function loadData(){ try { return JSON.parse(fs.readFileSync(DATA_FILE,'utf8')); } catch { return structuredClone(DEFAULT_DATA); } }
function saveData(){ fs.writeFileSync(DATA_FILE, JSON.stringify(data,null,2)); }
function normalizeNumber(v){ return String(v||'').replace(/\D/g,''); }
function jidToNumber(id){ return normalizeNumber(String(id||'').split('@')[0]); }
function isAdmin(msg){ return ADMINS.has(jidToNumber(msg.from)); }
function user(msg){ const n=jidToNumber(msg.from); if(!data.users[n]) data.users[n]={number:n,createdAt:new Date().toISOString(),activeDays:0,banned:false}; data.users[n].lastSeen=new Date().toISOString(); saveData(); return data.users[n]; }
function price(cat,plan){ const p=CATEGORIES[cat].prices[plan]||0; const d=Math.max(0,Math.min(100,Number(data.settings.discount)||0)); return Math.max(0,Math.round(p*(100-d)/100)); }
function menu(){ return `📄 *Document Service*\n\n1️⃣ Jati / Aawas / Niwas\n2️⃣ Non-Creamy Layer (NCL)\n3️⃣ Post Matric Scholarship (PMS)\n\nReply with *1, 2 or 3*.\n\nType *admin* for admin panel (admin numbers only).`; }
function plans(cat){ const c=CATEGORIES[cat]; return Object.keys(c.plans).map(k=>`${k}️⃣ ${c.plans[k]} — ₹${price(cat,k)}`).join('\n'); }
function money(n){ return `₹${Number(n||0)}`; }
function appSummary(a){ return `📄 *Application #${a.id}*\nCategory: ${a.category}\nPlan: ${a.plan}\nAmount: ${money(a.amount)}\n\n${a.docs.map((d,i)=>`${i+1}. *${d.name}*: ${d.value}`).join('\n')}`; }

function healthServer(){
  http.createServer(async (req,res)=>{
    try {
      if(req.url === '/qr.png'){
        if(!latestQr){ res.writeHead(404,{'Content-Type':'text/plain'}); return res.end('QR not available. Bot state: '+clientState); }
        const png = await QRCode.toBuffer(latestQr, {width:500, margin:2});
        res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store'}); return res.end(png);
      }
      if(req.url === '/qr'){
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
        return res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>WhatsApp Bot QR</title><style>body{font-family:Arial;text-align:center;background:#111;color:#fff;padding:20px}img{max-width:90%;background:#fff;padding:12px;border-radius:10px}button{padding:12px 18px;margin:12px;font-size:16px}</style></head><body><h2>WhatsApp Bot</h2><p>State: ${clientState}</p>${latestQr ? '<img src="/qr.png?x='+Date.now()+'" alt="WhatsApp QR">' : '<p>QR is not available yet. Refresh this page.</p>'}<br><button onclick="location.reload()">Refresh QR</button><p>WhatsApp → Linked devices → Link a device → Scan this QR.</p></body></html>`);
      }
      res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
      res.end(JSON.stringify({ok:true,whatsapp:clientReady,state:clientState,qrAvailable:Boolean(latestQr),uptime:Math.floor((Date.now()-startedAt)/1000)}));
    } catch(e){ res.writeHead(500,{'Content-Type':'text/plain'}); res.end(String(e)); }
  }).listen(PORT,'0.0.0.0',()=>console.log(`Health/QR server listening on port ${PORT}`));
}

const noSandbox = process.env.PUPPETEER_NO_SANDBOX !== 'false';

// Render-safe Chrome detection. Never pass a non-existent executablePath to whatsapp-web.js.
function findChromeExecutable(){
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_BIN,
    puppeteer.executablePath()
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { if (fs.existsSync(candidate)) return candidate; } catch {}
  }
  return null;
}

let chromePath = findChromeExecutable();
if (!chromePath) {
  console.log('Chrome executable not found. Trying to install Puppeteer Chrome at runtime...');
  try {
    execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--yes','puppeteer','browsers','install','chrome'], {
      stdio: 'inherit',
      env: { ...process.env, PUPPETEER_SKIP_DOWNLOAD: '' }
    });
  } catch (e) {
    console.error('Runtime Chrome install failed:', e.message);
  }
  chromePath = findChromeExecutable();
}

console.log('Puppeteer Chrome executable:', chromePath || 'AUTO/NOT FOUND');

const puppeteerOptions = {
  headless: true,
  args: noSandbox ? ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'] : []
};
if (chromePath) puppeteerOptions.executablePath = chromePath;

const client = new Client({
  authStrategy: new LocalAuth({ clientId:'document-service' }),
  puppeteer: puppeteerOptions
});

client.on('qr', qr => { latestQr = qr; clientState='qr_ready'; console.log('📱 WhatsApp QR generated. Open your Render service URL /qr to scan it.'); });
client.on('authenticated', ()=>{ latestQr=null; clientState='authenticated'; console.log('WhatsApp authenticated.'); });
client.on('ready', ()=>{ latestQr=null; clientReady=true; clientState='ready'; console.log('✅ WhatsApp bot is READY.'); });
client.on('auth_failure', e=>{ clientReady=false; clientState='auth_failure'; console.error('WhatsApp auth failure:',e); });
client.on('disconnected', r=>{ clientReady=false; clientState='disconnected'; console.log('WhatsApp disconnected:',r); });

async function sendMenu(chatId){ await client.sendMessage(chatId, menu()); }
async function startFlow(msg){ user(msg); sessions.set(msg.from,{step:'category'}); await sendMenu(msg.from); }
async function showPlans(msg,cat){ sessions.set(msg.from,{step:'plan',cat}); await client.sendMessage(msg.from,`*${CATEGORIES[cat].name}*\n\n${plans(cat)}\n\nReply with the plan number.\nType *0* to go back.`); }

async function collectDoc(msg,s){
  const current = s.docs[s.index]; let value='';
  if(msg.hasMedia){ const media=await msg.downloadMedia(); if(!media) return client.sendMessage(msg.from,'❌ Media download failed. Please send again.'); const ext=(media.mimetype||'application/octet-stream').split('/')[1]||'bin'; const filename=`${Date.now()}_${s.index}.${ext}`; const full=path.join(MEDIA_DIR,filename); fs.writeFileSync(full,Buffer.from(media.data,'base64')); value=`[file:${filename}]`; }
  else value=(msg.body||'').trim();
  if(!value) return client.sendMessage(msg.from,'❌ Empty input. Please send the requested text/file.');
  s.collected.push({name:current,value}); s.index++;
  if(s.index < s.docs.length){ sessions.set(msg.from,s); return client.sendMessage(msg.from,`📌 *${s.docs[s.index]}*\n\nSend text, photo or document.`); }
  const id=data.nextAppId++; const a={id,user:jidToNumber(msg.from),category:s.category,plan:s.planName,amount:s.amount,docs:s.collected,status:'awaiting_payment',createdAt:new Date().toISOString()}; data.applications[id]=a; saveData(); sessions.delete(msg.from);
  await client.sendMessage(msg.from,`${appSummary(a)}\n\n━━━━━━━━━━━━━━\n💳 *Payment*\nUPI: *${UPI_ID||'NOT SET'}*\nAmount: *${money(a.amount)}*\n\nSend payment screenshot here after payment.\nType *cancel* to cancel.`);
  if(UPI_ID){ const upi=`upi://pay?pa=${encodeURIComponent(UPI_ID)}&pn=${encodeURIComponent(UPI_NAME)}&am=${encodeURIComponent(a.amount.toFixed? a.amount.toFixed(2):a.amount)}&cu=INR&tn=${encodeURIComponent('Application #'+id)}`; const qrFile=path.join(MEDIA_DIR,`upi_${id}.png`); await QRCode.toFile(qrFile,upi); await client.sendMessage(msg.from,MessageMedia.fromFilePath(qrFile),{caption:`📲 Scan to pay ${money(a.amount)}\nApplication #${id}`}); }
}

async function handlePaymentProof(msg){ const pending=Object.values(data.applications).filter(a=>a.user===jidToNumber(msg.from)&&a.status==='awaiting_payment').sort((a,b)=>b.id-a.id)[0]; if(!pending) return false; if(!msg.hasMedia) { await client.sendMessage(msg.from,'📸 Please send the payment screenshot as an image/document.'); return true; }
 const media=await msg.downloadMedia(); const ext=(media.mimetype||'image/jpeg').split('/')[1]||'jpg'; const file=path.join(MEDIA_DIR,`payment_${pending.id}.${ext}`); fs.writeFileSync(file,Buffer.from(media.data,'base64')); pending.status='payment_submitted'; pending.paymentProof=file; saveData();
 await client.sendMessage(msg.from,`✅ Payment proof received for Application #${pending.id}.\nAdmin verification pending.`);
 for(const admin of ADMINS){ try { await client.sendMessage(admin+'@c.us',`💳 *Payment Proof*\nApplication #${pending.id}\nUser: ${pending.user}\nAmount: ${money(pending.amount)}\n\nReply: *approve ${pending.id}* or *reject ${pending.id}*`); await client.sendMessage(admin+'@c.us',MessageMedia.fromFilePath(file),{caption:`Payment proof — Application #${pending.id}`}); } catch(e){} }
 return true;
}
async function adminPanel(msg){ if(!isAdmin(msg)) return client.sendMessage(msg.from,'⛔ Admin access denied.'); const users=Object.keys(data.users).length; const pending=Object.values(data.applications).filter(a=>a.status==='payment_submitted').length; await client.sendMessage(msg.from,`🛠️ *Admin Panel*\n\n📊 Users: ${users}\n💳 Pending payments: ${pending}\n🏷️ Discount: ${data.settings.discount||0}%\nUPI: ${UPI_ID||'NOT SET'}\n\nCommands:\n*stats* — user stats\n*broadcast <message>* — broadcast\n*discount <0-100>* — set discount\n*approve <id>* — approve payment\n*reject <id>* — reject payment\n*prices* — show prices\n*price <cat> <plan> <amount>* — change price\n*status* — bot status`); }
async function broadcast(text){ let ok=0,bad=0; for(const n of Object.keys(data.users)){ if(data.users[n].banned) continue; try{ await client.sendMessage(n+'@c.us',text); ok++; }catch{bad++;} await new Promise(r=>setTimeout(r,250)); } return {ok,bad}; }

client.on('message', async msg => {
  try {
    if(msg.fromMe) return;
    const body=(msg.body||'').trim(); const low=body.toLowerCase(); const u=user(msg);
    if(u.banned){ await client.sendMessage(msg.from,'⛔ You are blocked.'); return; }
    if(low==='start' || low==='/start' || low==='menu'){ return startFlow(msg); }
    if(low==='admin'){ return adminPanel(msg); }
    if(isAdmin(msg) && low.startsWith('broadcast ')){ const r=await broadcast(body.slice(10).trim()); return client.sendMessage(msg.from,`📢 Broadcast complete.\n✅ ${r.ok}\n❌ ${r.bad}`); }
    if(isAdmin(msg) && low.startsWith('discount ')){ const n=Number(body.split(/\s+/)[1]); if(Number.isFinite(n)&&n>=0&&n<=100){data.settings.discount=n;saveData();return client.sendMessage(msg.from,`✅ Discount set to ${n}%`);} return client.sendMessage(msg.from,'Usage: discount 10'); }
    if(isAdmin(msg) && low==='stats'){ const apps=Object.values(data.applications); return client.sendMessage(msg.from,`📊 Users: ${Object.keys(data.users).length}\nApplications: ${apps.length}\nPending payments: ${apps.filter(a=>a.status==='payment_submitted').length}\nCompleted: ${apps.filter(a=>a.status==='completed').length}`); }
    if(isAdmin(msg) && low==='prices'){ return client.sendMessage(msg.from,Object.entries(CATEGORIES).map(([k,c])=>`${k}. ${c.name}\n${Object.entries(c.prices).map(([p,v])=>`  ${p}: ₹${price(k,p)}`).join('\n')}`).join('\n\n')); }
    if(isAdmin(msg) && low.startsWith('price ')){ const parts=body.split(/\s+/); if(parts.length===4 && CATEGORIES[parts[1]] && CATEGORIES[parts[1]].prices[parts[2]]!==undefined && Number.isFinite(Number(parts[3]))){CATEGORIES[parts[1]].prices[parts[2]]=Number(parts[3]);return client.sendMessage(msg.from,'✅ Price changed for this running session.');} return client.sendMessage(msg.from,'Usage: price 1 1 300'); }
    if(isAdmin(msg) && low==='status'){ return client.sendMessage(msg.from,`🤖 Status: ${clientState.toUpperCase()}\nUptime: ${Math.floor((Date.now()-startedAt)/1000)} sec\nUsers: ${Object.keys(data.users).length}`); }
    if(isAdmin(msg) && low.startsWith('approve ')){ const id=Number(body.split(/\s+/)[1]); const a=data.applications[id]; if(!a)return client.sendMessage(msg.from,'Application not found.'); a.status='completed'; a.completedAt=new Date().toISOString();saveData(); await client.sendMessage(a.user+'@c.us',`✅ *Payment Approved*\nApplication #${id} is approved.\nOur team will process it as per the selected service.`); return client.sendMessage(msg.from,'✅ Approved.'); }
    if(isAdmin(msg) && low.startsWith('reject ')){ const id=Number(body.split(/\s+/)[1]); const a=data.applications[id]; if(!a)return client.sendMessage(msg.from,'Application not found.'); a.status='rejected';saveData();await client.sendMessage(a.user+'@c.us',`❌ Payment for Application #${id} was rejected. Please contact admin.`);return client.sendMessage(msg.from,'❌ Rejected.'); }
    if(low==='cancel'){ sessions.delete(msg.from); return client.sendMessage(msg.from,'❌ Current application cancelled. Type *start* to begin again.'); }
    if(await handlePaymentProof(msg)) return;
    const s=sessions.get(msg.from);
    if(!s){ return client.sendMessage(msg.from,'Type *start* to open the service menu.'); }
    if(s.step==='category'){
      if(CATEGORIES[body]) return showPlans(msg,body);
      return client.sendMessage(msg.from,'Please reply with 1, 2 or 3.');
    }
    if(s.step==='plan'){
      if(body==='0') return startFlow(msg);
      const c=CATEGORIES[s.cat]; if(!c.plans[body]) return client.sendMessage(msg.from,'Invalid plan. Reply with the plan number.');
      const docs=c.docs; const next={step:'docs',cat:s.cat,planName:c.plans[body],amount:price(s.cat,body),docs,index:0,collected:[]}; sessions.set(msg.from,next); return client.sendMessage(msg.from,`📌 *${docs[0]}*\n\nSend text, photo or document.`);
    }
    if(s.step==='docs') return collectDoc(msg,s);
  } catch(e){ console.error(e); try{await client.sendMessage(msg.from,'⚠️ Something went wrong. Please type start and try again.');}catch{} }
});

healthServer();
client.initialize();
