const { Client, LocalAuth } = require('whatsapp-web.js');
const puppeteer = require('puppeteer');
const express = require('express');
const qrcode = require('qrcode');

const app = express();
const port = process.env.PORT || 10000;

// Web Server Setup for Render Health Checks
app.get('/health', (req, res) => res.status(200).send('OK'));
app.get('/api/status', (req, res) => res.json({ status: 'running' }));

app.listen(port, '0.0.0.0', () => {
    console.log('========================================');
    console.log(`WhatsApp Bot Web Server`);
    console.log(`Listening on 0.0.0.0:${port}`);
    console.log('Health: /health');
    console.log('Status: /api/status');
    console.log('========================================');
});

// WhatsApp Client Setup
console.log('==> Starting WhatsApp client...');

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        executablePath: puppeteer.executablePath(),
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ]
    }
});

client.on('qr', (qr) => {
    console.log('QR Code received, scan it with your phone:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('WhatsApp Bot is ready and connected!');
});

client.on('auth_failure', (msg) => {
    console.error('Authentication failure:', msg);
});

client.initialize().catch((err) => {
    console.error('==> Client initialization failed:', err);
});
