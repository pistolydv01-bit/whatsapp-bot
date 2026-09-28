require("dotenv").config();

const http = require("http");
const qrcode = require("qrcode");
const { Client, LocalAuth } = require("whatsapp-web.js");
const puppeteer = require("puppeteer");

const PORT = Number(process.env.PORT || 10000);
const HOST = "0.0.0.0";

let qrDataUrl = null;
let botState = "starting";
let clientInfo = null;
let lastError = null;

const client = new Client({
  authStrategy: new LocalAuth({
    clientId: "document-service-bot"
  }),
  puppeteer: {
    headless: true,
    executablePath: puppeteer.executablePath(),
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-first-run",
      "--no-zygote",
      "--single-process"
    ]
  }
});

client.on("qr", async (qr) => {
  try {
    qrDataUrl = await qrcode.toDataURL(qr, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 360
    });
    botState = "qr_ready";
    lastError = null;
    console.log("==> QR code generated. Scan it from WhatsApp > Linked devices.");
  } catch (err) {
    lastError = err.message;
    console.error("QR generation error:", err);
  }
});

client.on("authenticated", () => {
  botState = "authenticated";
  qrDataUrl = null;
  console.log("==> WhatsApp authenticated.");
});

client.on("ready", () => {
  botState = "ready";
  qrDataUrl = null;
  lastError = null;
  clientInfo = client.info || null;
  console.log("==> WhatsApp bot is READY.");
});

client.on("auth_failure", (msg) => {
  botState = "auth_failure";
  lastError = String(msg);
  console.error("WhatsApp authentication failed:", msg);
});

client.on("disconnected", (reason) => {
  botState = "disconnected";
  clientInfo = null;
  console.log("==> WhatsApp disconnected:", reason);
});

client.on("message", async (message) => {
  try {
    const text = (message.body || "").trim().toLowerCase();

    if (text === "hi" || text === "hello" || text === "/start") {
      await message.reply(
        "👋 Hello! WhatsApp bot is online.\n\n" +
        "Send your document-service command here."
      );
    }
  } catch (err) {
    console.error("Message handler error:", err);
  }
});

function htmlPage() {
  const qr = qrDataUrl
    ? `<img class="qr" src="${qrDataUrl}" alt="WhatsApp QR Code">`
    : `<div class="empty">QR अभी उपलब्ध नहीं है</div>`;

  const details = clientInfo
    ? `<div class="info">Connected as: ${escapeHtml(
        clientInfo.pushname || "WhatsApp account"
      )}</div>`
    : "";

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>WhatsApp Bot</title>
<style>
  *{box-sizing:border-box}
  body{
    margin:0; min-height:100vh; display:flex; justify-content:center;
    align-items:center; background:#111; color:#fff;
    font-family:Arial,sans-serif; padding:20px;
  }
  .card{
    width:min(520px,100%); text-align:center; padding:28px 20px;
    border-radius:18px; background:#1b1b1b; box-shadow:0 10px 40px #0008;
  }
  h1{margin:0 0 14px;font-size:30px}
  .state{font-size:20px;margin:10px 0 22px}
  .qr{
    width:360px; max-width:90vw; background:#fff; padding:10px;
    border-radius:10px;
  }
  .empty{padding:80px 10px;color:#aaa}
  .btn{
    display:inline-block; margin-top:20px; padding:12px 20px;
    border-radius:8px; background:#fff; color:#111; text-decoration:none;
  }
  .hint{margin-top:22px;line-height:1.6;color:#ddd}
  .info{margin-top:15px;color:#9ee493}
  .error{margin-top:15px;color:#ff8f8f;word-break:break-word}
</style>
</head>
<body>
<div class="card">
  <h1>WhatsApp Bot</h1>
  <div class="state">State: <b>${escapeHtml(botState)}</b></div>
  ${qr}
  <a class="btn" href="/">Refresh QR</a>
  <div class="hint">
    WhatsApp → Linked devices → Link a device → Scan this QR.
  </div>
  ${details}
  ${lastError ? `<div class="error">Error: ${escapeHtml(lastError)}</div>` : ""}
</div>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const server = http.createServer((req, res) => {
  if (req.url === "/health" || req.url === "/api/status") {
    const payload = {
      ok: true,
      whatsapp: botState === "ready",
      state: botState,
      qrAvailable: Boolean(qrDataUrl),
      uptime: Math.floor(process.uptime())
    };

    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify(payload, null, 2));
  }

  if (req.url === "/qr") {
    if (!qrDataUrl) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("QR is not available. Current state: " + botState);
    }

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(
      `<!doctype html><html><body style="background:#111;text-align:center;padding:20px">
      <img src="${qrDataUrl}" style="max-width:95vw;background:#fff;padding:10px">
      </body></html>`
    );
  }

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(htmlPage());
});

server.listen(PORT, HOST, () => {
  console.log("========================================");
  console.log("WhatsApp Bot Web Server");
  console.log(`Listening on ${HOST}:${PORT}`);
  console.log("Health: /health");
  console.log("Status: /api/status");
  console.log("========================================");
});

process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection:", err);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});

(async () => {
  try {
    console.log("==> Starting WhatsApp client...");
    await client.initialize();
  } catch (err) {
    botState = "error";
    lastError = err.message;
    console.error("==> Client initialization failed:", err);
  }
})();
