/**
 * Steven Bot v3.1 — Termux Ready
 * Fixed pairing code, reconnects, and number formatting
 */
process.env.PUPPETEER_SKIP_DOWNLOAD = 'true';

const { initializeTempSystem } = require('./utils/tempManager');
const { startCleanup }         = require('./utils/cleanup');
initializeTempSystem();
startCleanup();

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  Browsers
} = require('@whiskeysockets/baileys');

const pino     = require('pino');
const qrcode   = require('qrcode-terminal');
const readline = require('readline');
const config   = require('./config');
const db       = require('./database');
const handler  = require('./handler');
const fs       = require('fs');
const path     = require('path');

// ── In-memory message store ───────────────────────────────────────────────────
const msgStore = new Map();
let currentSock = null;
let restartInFlight = false;

function storeMsg(msg) {
  if (!msg?.key?.id) return;
  const jid = msg.key.remoteJid;
  if (!msgStore.has(jid)) msgStore.set(jid, new Map());
  const chat = msgStore.get(jid);
  chat.set(msg.key.id, msg);
  if (chat.size > 50) chat.delete(chat.keys().next().value);
}

// ── Dedup ─────────────────────────────────────────────────────────────────────
const processed = new Set();
setInterval(() => processed.clear(), 5 * 60 * 1000);

const isSystem = (jid) => !jid || jid.includes('@broadcast') || jid.includes('status.broadcast') || jid.includes('@newsletter');

// ── Sleep helper ──────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function scheduleRestart(reason) {
  if (restartInFlight) return;
  restartInFlight = true;
  console.log(`\n🔄 Auto-restarting in 1 second (${reason})...`);
  try { currentSock?.end?.(); } catch {}
  await sleep(1000);
  try { await startBot(); } catch (e) { console.error('Restart failed:', e.message); }
  restartInFlight = false;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function startBot() {
  const sessionFolder = './session';
  fs.mkdirSync(sessionFolder, { recursive: true });
  fs.mkdirSync('./temp',     { recursive: true });
  fs.mkdirSync('./database', { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(`\n📦 WA v${version.join('.')} | Latest: ${isLatest}`);

  const sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: Browsers.ubuntu('Chrome'),
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
    },
    syncFullHistory: false,
    downloadHistory: false,
    markOnlineOnConnect: false,
    getMessage: async (key) => {
      const chat = msgStore.get(key.remoteJid);
      return chat?.get(key.id)?.message || undefined;
    }
  });

  currentSock = sock;
  try { handler.reloadCommands?.(); } catch {}

  // ── Pairing code — with proper delay ──────────────────────────────────────
  if (!sock.authState.creds.registered) {
    // IMPORTANT: must wait for socket to be ready before requesting code
    await sleep(3000);

    // Clean the number — only digits, no +, no spaces
    const rawNum = (config.botNumber || '').replace(/[^0-9]/g, '');
    console.log(`\n⏳ Requesting pairing code for +${rawNum}...`);

    let retries = 0;
    while (retries < 3) {
      try {
        const code = await sock.requestPairingCode(rawNum);
        // Format as XXXX-XXXX for easy reading
        const formatted = code.match(/.{1,4}/g)?.join('-') || code;
        console.log('\n╔══════════════════════════════════════════╗');
        console.log(`║  🔑 YOUR PAIRING CODE: ${formatted.padEnd(17)}║`);
        console.log('╠══════════════════════════════════════════╣');
        console.log(`║  Phone: +${rawNum.padEnd(31)}║`);
        console.log('║                                          ║');
        console.log('║  1. Open WhatsApp on the bot phone       ║');
        console.log('║  2. Tap ⋮ (3 dots) → Linked Devices      ║');
        console.log('║  3. Tap "Link a Device"                  ║');
        console.log('║  4. Tap "Link with phone number instead" ║');
        console.log(`║  5. Enter code: ${formatted.padEnd(24)}║`);
        console.log('╚══════════════════════════════════════════╝\n');
        break;
      } catch (e) {
        retries++;
        console.log(`⚠️  Pairing attempt ${retries} failed: ${e.message}`);
        if (retries < 3) {
          console.log(`   Retrying in 5 seconds...`);
          await sleep(5000);
        } else {
          console.log('\n📱 Falling back to QR code — scan below:\n');
          // Recreate socket with QR enabled
          await sock.end();
          await sleep(1000);
          return startBotWithQR();
        }
      }
    }
  }

  const closeReason = (code) => ({
    401: 'Unauthorized session',
    403: 'Forbidden / logged out',
    408: 'Connection timeout',
    428: 'Restart requested by WA',
    515: 'Restart required by WA',
  }[code] || 'Reconnect');

  // ── Connection updates ────────────────────────────────────────────────────
  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('\n📱 QR Code (scan with WhatsApp):\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const boom = new (require('@hapi/boom').Boom)(lastDisconnect?.error);
      const code = boom?.output?.statusCode;
      const R = DisconnectReason;

      console.log(`\n⚠️  Connection closed. Code: ${code} (${closeReason(code)})`);

      if (code === R.loggedOut || code === R.badSession || code === 401) {
        console.log('❌ Session invalid — clearing saved session and restarting in 1 second...');
        try { fs.rmSync(sessionFolder, { recursive: true, force: true }); } catch {}
        try { fs.mkdirSync(sessionFolder, { recursive: true }); } catch {}
        await sleep(1000);
        return startBot();
      } else if (code === R.restartRequired || code === 515) {
        console.log('🔄 Restart required by WA — restarting in 1 second...');
        await sleep(1000);
        return startBot();
      } else {
        const delay = 1000;
        console.log(`🔄 Reconnecting in ${delay/1000}s...`);
        await sleep(delay);
        return startBot();
      }
    }

    if (connection === 'open') {
      const botNum = config.botNumber;
      console.log('\n✅ 𝕊𝕥𝕖𝕧𝕖𝕟 Bot ONLINE ⚡');
      console.log(`📱 +${botNum} | Prefix: ${db.getPrefix()} | Mode: ${db.getMode()}\n`);

      handler.initAntiCall(sock);

      // (Auto "I'm online" notification to owner removed — was sending on
      // every container restart / reconnect cycle and spamming the owner.)
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // ── Messages ──────────────────────────────────────────────────────────────
  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (!msg.message || !msg.key?.id) continue;
      const from = msg.key.remoteJid;
      if (!from || isSystem(from)) continue;
      if (processed.has(msg.key.id)) continue;
      const age = Date.now() - (msg.messageTimestamp * 1000);
      if (age > 5 * 60 * 1000) continue; // ignore old messages
      processed.add(msg.key.id);
      storeMsg(msg);
      handler.handleMessage(sock, msg).catch(e => {
        if (!e?.message?.includes('rate-overlimit') &&
            !e?.message?.includes('not-authorized') &&
            !e?.message?.includes('forbidden')) {
          console.error('Handler error:', e.message);
        }
      });
    }
  });

  sock.ev.on('group-participants.update', (u) => {
    handler.handleGroupUpdate(sock, u).catch(() => {});
  });

  sock.ev.on('error', (e) => {
    const code = e?.output?.statusCode;
    if ([515, 503, 408, 401, 403].includes(code)) return;
    console.error('Socket error:', e?.message || e);
  });

  return sock;
}

// ── QR fallback ───────────────────────────────────────────────────────────────
async function startBotWithQR() {
  const sessionFolder = './session';
  const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: true,   // show QR in terminal
    browser: Browsers.ubuntu('Chrome'),
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
    },
    syncFullHistory: false,
    getMessage: async () => undefined
  });

  currentSock = sock;
  try { handler.reloadCommands?.(); } catch {}

  sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      console.log('\n✅ Connected via QR!\n');
      handler.initAntiCall(sock);
      // (Auto "connected via QR" message to owner removed — same reason as above.)
    }
    if (connection === 'close') {
      const code = new (require('@hapi/boom').Boom)(lastDisconnect?.error)?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) { console.log('Logged out.'); process.exit(1); }
      await sleep(5000);
      return startBot();
    }
  });

  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (!msg.message || isSystem(msg.key?.remoteJid)) continue;
      storeMsg(msg);
      handler.handleMessage(sock, msg).catch(() => {});
    }
  });
  sock.ev.on('group-participants.update', (u) => handler.handleGroupUpdate(sock, u).catch(() => {}));
}

// ── Start ──────────────────────────────────────────────────────────────────────
require('./utils/watermark').printCreatorInfo();
console.log('\n🚀 Starting 𝕊𝕥𝕖𝕧𝕖𝕟 Bot...\n');
startBot().catch(e => { console.error('Fatal:', e.message); process.exit(1); });

process.on('uncaughtException', (e) => {
  if (e.code === 'ENOSPC') { require('./utils/cleanup').cleanupOldFiles(); return; }
  console.error('Uncaught:', e.message);
  scheduleRestart('uncaughtException').catch(() => {});
});
process.on('unhandledRejection', (e) => {
  if (e?.code === 'ENOSPC') { require('./utils/cleanup').cleanupOldFiles(); return; }
  if (e?.message?.includes('rate-overlimit') || e?.message?.includes('not-authorized')) return;
  console.error('Unhandled:', e?.message || e);
  scheduleRestart('unhandledRejection').catch(() => {});
});
// (debug patch applied above)
