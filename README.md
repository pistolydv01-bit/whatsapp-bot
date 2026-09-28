# Document Service WhatsApp Bot

This is a WhatsApp version of the supplied Telegram document-service bot.

## Included
- WhatsApp Web QR login
- 3 document-service categories
- Plan/pricing menu
- Global discount
- Text/photo/document collection
- Application records in `data.json`
- UPI payment QR generation
- Payment screenshot submission to admins
- Admin approve/reject
- User statistics
- Text broadcast
- Bot status
- Health endpoint

## Important
This uses `whatsapp-web.js`, which automates WhatsApp Web. It is not the official WhatsApp Cloud API. It can log out or be restricted by WhatsApp, so do not use it for spam or unsolicited bulk messaging. The broadcast feature is intended for users who have already interacted with/registered with the bot.

## Android / Termux
1. Install Node.js in Termux.
2. Extract this folder.
3. Copy `.env.example` to `.env`.
4. Put your own admin WhatsApp number(s) in `ADMIN_NUMBERS` and your UPI ID in `UPI_ID`.
5. Run `npm install`.
6. Run `npm start`.
7. Pair/scan the WhatsApp Web QR shown by the program.
8. Send `start` to the WhatsApp account running the bot.

The first run creates a `.wwebjs_auth` folder. Keep it so you do not have to pair again every time.

## Commands
User: `start`, `menu`
Admin: `admin`, `stats`, `broadcast <message>`, `discount <0-100>`, `prices`, `price <cat> <plan> <amount>`, `approve <id>`, `reject <id>`, `status`

## Note about the 6-line video
The short demo is showing how little code a framework can need for a basic bot. A production-style bot with payments, document collection, admin controls, persistence and media handling necessarily needs more code.
