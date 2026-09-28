# Document Service WhatsApp Bot

WhatsApp Web bot for the document-service workflow.

## Render setup
- Build Command: `npm install`
- Start Command: `npm start`
- Environment variables: `ADMIN_NUMBERS`, `UPI_ID`, `UPI_NAME`, `PUPPETEER_NO_SANDBOX=true`
- `PORT` can be left to Render; the app reads Render's PORT automatically.

The build installs the Chrome browser required by Puppeteer. After deployment, open your Render service URL followed by `/qr` to see the WhatsApp QR page. In WhatsApp: **Linked devices → Link a device**, then scan the QR.

## Important
This uses `whatsapp-web.js`, not the official WhatsApp Cloud API. Use it only for legitimate, consent-based messaging. Avoid spam or unsolicited bulk messaging. Render's ephemeral filesystem means the WhatsApp LocalAuth session and local data can be lost after a restart/redeploy unless persistent storage is configured.

## Commands
User: `start`, `menu`, `cancel`
Admin: `admin`, `stats`, `broadcast <message>`, `discount <0-100>`, `prices`, `price <cat> <plan> <amount>`, `approve <id>`, `reject <id>`, `status`
