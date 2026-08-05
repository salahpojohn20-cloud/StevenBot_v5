// commands/general/general.js
const config = require('../../config');
const db     = require('../../database');
const APIs   = require('../../utils/api');
const { resolveNum, resolveJid, resolveParticipants } = require('../../utils/lidResolver');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const QRCode     = require('qrcode');
const axios      = require('axios');
const fs         = require('fs');
const path       = require('path');
const { exec }   = require('child_process');
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const { getTempDir, deleteTempFile } = require('../../utils/tempManager');

const startTime = Date.now();

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * getPhoneNum(participant, allParticipants)
 * Extract the real phone number from a participant object.
 * Handles both old-style (@s.whatsapp.net) and new LID-style participants.
 */
const getPhoneNum = (p, allParticipants = []) => {
  // Baileys newer versions: p.phoneNumber holds the real phone JID
  if (p.phoneNumber && p.phoneNumber.includes('@s.whatsapp.net')) {
    return p.phoneNumber.split('@')[0].replace(/\D/g, '');
  }
  // Use resolver (checks p.id + participant list for LID cross-ref)
  return resolveNum(p.id, allParticipants, config.sessionName);
};

// ─────────────────────────────────────────────────────────────────────────────

const ping = {
  name: 'ping', category: 'general', description: 'Check bot response time',
  async execute(sock, msg, args, extra) {
    const ms = Date.now() - msg.messageTimestamp * 1000;
    extra.reply(`🫒 *Steven active*\n\n⚡ Response: *${Math.abs(ms)}ms*`);
  }
};

const uptime = {
  name: 'uptime', category: 'general', description: 'Show bot uptime',
  async execute(sock, msg, args, extra) {
    const ms = Date.now() - startTime;
    const d = Math.floor(ms/86400000), h = Math.floor(ms/3600000)%24, m = Math.floor(ms/60000)%60, s = Math.floor(ms/1000)%60;
    extra.reply(`🫒 *Uptime:* ${d}d ${h}h ${m}m ${s}s`);
  }
};

const owner = {
  name: 'owner', category: 'general', description: 'Get owner contact',
  async execute(sock, msg, args, extra) {
    const text = `𝑵𝒂𝒎𝒆;𝑺𝑻𝑬𝑽𝑬𝑵 𝑫𝑨𝑵𝑰𝑬𝑳
𝑨𝑮𝑬;17
𝑵𝒖𝒎𝒃𝒆𝒓 ;+201273323087
𝒁𝑨𝑻𝑶𝑵𝑨 𝒍𝑶𝑽𝑬 𝒀𝑶𝑼 𝑭𝑶𝑹𝑬𝑽𝑬𝑹 🫦`;
    await sock.sendMessage(extra.from, { text }, { quoted: msg });
  }
};

const about = {
  name: 'about', aliases: ['creator'], category: 'general', description: 'About Steven Bot',
  async execute(sock, msg, args, extra) {
    extra.reply(`🫒 *Steven Bot v${config.version}*\n\n👑 Creator: ${config.ownerName[0]}\n📱 +${config.ownerNumber[0]}\n\n_Built from scratch. All rights reserved._`);
  }
};

const qr = {
  name: 'qr', category: 'general', description: 'Generate QR code',
  async execute(sock, msg, args, extra) {
    const text = args.join(' '); if (!text) return extra.reply('❌ Usage: .qr <text or URL>');
    try {
      const buf = await QRCode.toBuffer(text, { type: 'png', width: 400, margin: 2 });
      await sock.sendMessage(extra.from, { image: buf, caption: `📱 *QR Code*\n📝 ${text}` }, { quoted: msg });
    } catch (e) { extra.reply('❌ ' + e.message); }
  }
};

const github = {
  name: 'github', aliases: ['gh'], category: 'general', description: 'GitHub user lookup',
  async execute(sock, msg, args, extra) {
    if (!args[0]) return extra.reply('❌ Usage: .github <username>');
    try {
      const r = await axios.get(`https://api.github.com/users/${args[0]}`, { timeout: 8000 });
      const d = r.data;
      extra.reply(`👨‍💻 *${d.login}*\n\n👤 ${d.name||'N/A'}\n📝 ${d.bio||'No bio'}\n📦 Repos: ${d.public_repos}\n👥 Followers: ${d.followers}\n📍 ${d.location||'N/A'}\n🔗 ${d.html_url}`);
    } catch { extra.reply('❌ User not found.'); }
  }
};

const getpp = {
  name: 'getpp', aliases: ['pfp', 'pp'], category: 'general', description: 'Get profile picture',
  async execute(sock, msg, args, extra) {
    const men    = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.participant;
    const target = (men && men[0]) || quoted || extra.sender;
    try {
      const pp  = await sock.profilePictureUrl(target, 'image');
      const r   = await axios.get(pp, { responseType: 'arraybuffer', timeout: 10000 });

      // Resolve to a real phone so the caption is a clickable @mention,
      // not raw LID digits.
      const num = resolveNum(target, extra.groupMetadata?.participants, config.sessionName);
      const displayNum = (num && num.length >= 7 && num.length <= 15)
        ? num
        : target.split('@')[0].split(':')[0];
      const mentionJid = (num && num.length >= 7 && num.length <= 15)
        ? `${num}@s.whatsapp.net`
        : target;

      await sock.sendMessage(extra.from, {
        image: Buffer.from(r.data),
        caption: `🖼️ @${displayNum}`,
        mentions: [mentionJid]
      }, { quoted: msg });
    } catch { extra.reply('❌ No profile picture or it is private.'); }
  }
};

const groupinfo = {
  name: 'groupinfo', aliases: ['ginfo'], category: 'general', description: 'Group information', groupOnly: true,
  async execute(sock, msg, args, extra) {
    const m = extra.groupMetadata; if (!m) return extra.reply('❌ Could not fetch group info.');
    const admins = m.participants.filter(p => p.admin);
    extra.reply(`🫒 *Group Info*\n\n📛 ${m.subject}\n👥 Members: ${m.participants.length}\n🛡️ Admins: ${admins.length}\n📅 Created: ${new Date(m.creation*1000).toLocaleDateString()}\n📝 ${m.desc||'No description'}`);
  }
};

const groupstats = {
  name: 'groupstats', category: 'general', description: 'Group message stats with top senders', groupOnly: true,
  async execute(sock, msg, args, extra) {
    const gid   = extra.from;
    const key   = `stats_${gid.replace('@g.us', '')}`;
    const stats = db.getBotSetting(key) || { total: 0, today: 0, date: '', users: {} };
    const today = new Date().toDateString();
    const todayCount = stats.date === today ? (stats.today || 0) : 0;
    const rawUsers   = stats.users || {};

    // Build LID → real phone map from participant list
    const participants = extra.groupMetadata?.participants || [];
    const lidToPhone = {};
    participants.forEach(p => {
      const phone = getPhoneNum(p, participants);
      if (!phone) return;
      // Map phone to phone (identity)
      lidToPhone[phone] = phone;
      // Map LID digits to phone if p.id is a LID
      if (p.id && p.id.includes('@lid')) {
        const lidDigits = p.id.split('@')[0].split(':')[0].replace(/\D/g, '');
        if (lidDigits) lidToPhone[lidDigits] = phone;
      }
      // Map p.lid to phone
      if (p.lid) {
        const pLidDigits = p.lid.split('@')[0].split(':')[0].replace(/\D/g, '');
        if (pLidDigits) lidToPhone[pLidDigits] = phone;
      }
    });

    // Consolidate stats: merge LID-keyed and phone-keyed counts
    const resolved = {};
    for (const [num, count] of Object.entries(rawUsers)) {
      const clean   = num.replace(/\D/g, '');
      const realNum = lidToPhone[clean] || clean;
      // Only keep if it looks like a phone number (not a 16-digit LID)
      resolved[realNum] = (resolved[realNum] || 0) + count;
    }

    const topUsers = Object.entries(resolved).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const medals   = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
    const mentions = [];

    let txt = `📊 *Group Message Stats*\n\n📨 Total: *${stats.total || 0}*\n📅 Today: *${todayCount}*\n`;

    if (topUsers.length) {
      txt += `\n🏆 *Top 5 Senders:*\n`;
      topUsers.forEach(([num, count], i) => {
        const jid = `${num}@s.whatsapp.net`;
        mentions.push(jid);
        txt += `${medals[i]} @${num} — ${count} msgs\n`;
      });
      txt += `\n_@mention opens chat_`;
    } else {
      txt += `\n_No data yet. Stats collected from now on._`;
    }

    await sock.sendMessage(extra.from, { text: txt, mentions }, { quoted: msg });
  }
};

const myactivity = {
  name: 'myactivity', category: 'general', description: 'Your command usage stats',
  async execute(sock, msg, args, extra) {
    const participants = extra.groupMetadata?.participants || [];

    // Best resolution: find myself in participant list
    let sNum = '';
    if (extra.sender) {
      const me = participants.find(p => {
        const sBase = extra.sender.split(':')[0];
        return p.id.split(':')[0] === sBase ||
               (p.lid || '').split(':')[0] === sBase ||
               p.id === extra.sender;
      });
      if (me) sNum = getPhoneNum(me, participants);
    }

    // Fallback to resolver
    if (!sNum || sNum.length < 5) sNum = resolveNum(extra.sender, participants, config.sessionName);
    if (!sNum || sNum.length < 5) sNum = (extra.senderNum || '').replace(/\D/g, '');
    if (!sNum || sNum.length < 5) sNum = (extra.sender || '').replace(/\D/g, '').slice(-10);

    const u    = db.getUser(sNum);
    const days = u.registered ? Math.floor((Date.now() - u.registered) / 86400000) : 0;

    // Render the resolved phone as a clickable @mention (must point at a
    // phone JID, never a LID, otherwise WhatsApp won't make it tappable).
    const mentionJid = (sNum && sNum.length >= 7 && sNum.length <= 15)
      ? `${sNum}@s.whatsapp.net`
      : extra.sender;

    const txt = `📊 *Your Activity*\n\n📱 @${sNum}\n🤖 Commands used: *${u.cmds || 0}*\n📅 Joined: ${u.registered ? new Date(u.registered).toLocaleDateString() : 'Today'}\n⏱️ Days active: ${days}`;
    await sock.sendMessage(extra.from, { text: txt, mentions: [mentionJid] }, { quoted: msg });
  }
};

const viewonce = {
  name: 'viewonce', aliases: ['vo', 'vv'], category: 'general', description: 'Re-send a view-once message',
  async execute(sock, msg, args, extra) {
    const ctx = msg.message?.extendedTextMessage?.contextInfo;
    if (!ctx?.quotedMessage) return extra.reply('❌ Reply to a view-once message.');
    const q        = ctx.quotedMessage;
    const voInner  = q?.viewOnceMessage?.message || q?.viewOnceMessageV2?.message || q?.viewOnceMessageV2Extension?.message;
    const srcMsg   = voInner || q;
    const mediaMsg = srcMsg?.imageMessage || srcMsg?.videoMessage;
    if (!mediaMsg) return extra.reply('❌ No image/video found. Reply directly to the view-once.');
    const isVid = !!(srcMsg?.videoMessage);
    try {
      const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
      const stream = await downloadContentFromMessage(mediaMsg, isVid ? 'video' : 'image');
      const chunks = []; for await (const chunk of stream) chunks.push(chunk);
      const buf = Buffer.concat(chunks);
      if (!buf || buf.length === 0) return extra.reply('❌ Media expired or could not be downloaded.');
      if (isVid) { await sock.sendMessage(extra.from, { video: buf, caption: '👁️ *View Once Video*', mimetype: 'video/mp4' }, { quoted: msg }); }
      else        { await sock.sendMessage(extra.from, { image: buf, caption: '👁️ *View Once Image*' }, { quoted: msg }); }
    } catch (e) { extra.reply('❌ ' + e.message); }
  }
};

const tts = {
  name: 'tts', category: 'general', description: 'Text to speech (sent as voice note)',
  async execute(sock, msg, args, extra) {
    const text = args.join(' '); if (!text) return extra.reply('❌ Usage: .tts <text>');
    const tempDir = getTempDir();
    const ts = Date.now();
    const inF  = path.join(tempDir, `tts_${ts}.mp3`);
    const outF = path.join(tempDir, `tts_${ts}.ogg`);
    try {
      const lang = text.match(/[\u0600-\u06FF]/) ? 'ar' : 'en';
      // Google TTS limits ~200 chars per request — chunk longer text
      const chunks = text.match(/[\s\S]{1,180}/g) || [text];
      const buffers = [];
      for (const chunk of chunks) {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(chunk)}&tl=${lang}&client=tw-ob`;
        const r   = await axios.get(url, {
          responseType: 'arraybuffer', timeout: 15000,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' }
        });
        buffers.push(Buffer.from(r.data));
      }
      fs.writeFileSync(inF, Buffer.concat(buffers));

      // Convert MP3 → OGG/Opus so WhatsApp renders a real PTT (push-to-talk)
      // bubble — `audio/mpeg` was previously rendered as a music attachment
      // on most clients, even with ptt:true.
      await new Promise((res, rej) => exec(
        `"${FFMPEG}" -i "${inF}" -c:a libopus -b:a 64k -ar 48000 -ac 1 -application voip "${outF}" -y`,
        (e) => e ? rej(e) : res()
      ));
      const ogg = fs.readFileSync(outF);
      await sock.sendMessage(extra.from, {
        audio: ogg,
        mimetype: 'audio/ogg; codecs=opus',
        ptt: true
      }, { quoted: msg });
    } catch (e) {
      // Last-resort fallback: send the raw MP3 as PTT (some clients still
      // render it correctly).
      try {
        if (fs.existsSync(inF)) {
          const mp3 = fs.readFileSync(inF);
          await sock.sendMessage(extra.from, {
            audio: mp3, mimetype: 'audio/mp4', ptt: true
          }, { quoted: msg });
          return;
        }
      } catch {}
      extra.reply('❌ TTS failed: ' + e.message);
    } finally {
      deleteTempFile(inF); deleteTempFile(outF);
    }
  }
};

const sticker = {
  name: 'sticker', aliases: ['s', 'stiker', 'stc'], category: 'general', description: 'Convert image/video/sticker',
  async execute(sock, msg, args, extra) {
    const ctx = msg.message?.extendedTextMessage?.contextInfo;
    let targetMsg = msg;
    let mediaMsg = null;
    let kind = null; // 'image' | 'video' | 'sticker'

    // Resolve which media we're converting — quoted has priority, then current
    const pickMedia = (m) => {
      if (!m) return null;
      // unwrap common wrappers (ephemeral, view-once, etc.)
      const inner = m.ephemeralMessage?.message
                 || m.viewOnceMessageV2?.message
                 || m.viewOnceMessage?.message
                 || m.documentWithCaptionMessage?.message
                 || m;
      if (inner.stickerMessage) return { node: inner.stickerMessage, kind: 'sticker' };
      if (inner.imageMessage)   return { node: inner.imageMessage,   kind: 'image'   };
      if (inner.videoMessage)   return { node: inner.videoMessage,   kind: 'video'   };
      return null;
    };

    if (ctx?.quotedMessage) {
      const picked = pickMedia(ctx.quotedMessage);
      if (picked) {
        targetMsg = {
          key: { remoteJid: extra.from, id: ctx.stanzaId, fromMe: false, participant: ctx.participant },
          message: ctx.quotedMessage
        };
        mediaMsg = picked.node; kind = picked.kind;
      }
    }
    if (!mediaMsg) {
      const picked = pickMedia(msg.message);
      if (picked) { mediaMsg = picked.node; kind = picked.kind; }
    }

    if (!mediaMsg) return extra.reply('❌ Send or reply to an image/video/GIF/sticker with .sticker');

    // Chunk-based download via downloadContentFromMessage. Far more reliable
    // than downloadMediaMessage on long-lived sessions because it doesn't
    // rely on the original key/contextInfo object being intact.
    const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
    let buf;
    try {
      const stream = await downloadContentFromMessage(mediaMsg, kind);
      const chunks = []; for await (const chunk of stream) chunks.push(chunk);
      buf = Buffer.concat(chunks);
    } catch (e) {
      // Fallback to legacy downloader (helps for some forwarded media)
      try {
        buf = await downloadMediaMessage(targetMsg, kind === 'sticker' ? 'sticker' : kind, {}, {
          reuploadRequest: m => sock.updateMediaMessage(m)
        });
      } catch (e2) {
        return extra.reply('❌ Could not download media: ' + (e2.message || e.message));
      }
    }
    if (!buf || !Buffer.isBuffer(buf) || buf.length === 0) {
      return extra.reply('❌ Could not download media (empty buffer).');
    }

    // If the source is already a sticker just re-send the webp directly —
    // no re-encoding needed, preserves animated frames.
    if (kind === 'sticker') {
      try { await sock.sendMessage(extra.from, { sticker: buf }, { quoted: msg }); return; }
      catch (e) { return extra.reply('❌ ' + e.message); }
    }

    const tempDir = getTempDir(); const ts = Date.now();
    const inExt = kind === 'video' ? 'mp4' : 'jpg';
    const inF = path.join(tempDir, `stk_in_${ts}.${inExt}`);
    const outF = path.join(tempDir, `stk_out_${ts}.webp`);
    try {
      fs.writeFileSync(inF, buf);
      const cmd = kind === 'video'
        ? `"${FFMPEG}" -i "${inF}" -vf "scale=512:512:force_original_aspect_ratio=decrease,fps=15,pad=512:512:-1:-1:color=0x00000000" -vcodec libwebp -loop 0 -preset picture -an -vsync 0 -t 6 "${outF}" -y`
        : `"${FFMPEG}" -i "${inF}" -vf "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:-1:-1:color=0x00000000" -vcodec libwebp "${outF}" -y`;
      await new Promise((res, rej) => exec(cmd, e => e ? rej(e) : res()));
      const webp = fs.readFileSync(outF);
      await sock.sendMessage(extra.from, { sticker: webp }, { quoted: msg });
    } catch (e) { extra.reply('❌ Sticker failed: ' + e.message); }
    finally { deleteTempFile(inF); deleteTempFile(outF); }
  }
};

const take = {
  name: 'take', aliases: ['steal'], category: 'general', description: 'Steal/rename a sticker',
  async execute(sock, msg, args, extra) {
    const ctx        = msg.message?.extendedTextMessage?.contextInfo;
    const quotedMsg  = ctx?.quotedMessage;
    const stickerMsg = quotedMsg?.stickerMessage || msg.message?.stickerMessage;
    if (!stickerMsg) return extra.reply('❌ Reply to a sticker with .take');
    try {
      const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
      const stream = await downloadContentFromMessage(stickerMsg, 'sticker');
      const chunks = []; for await (const chunk of stream) chunks.push(chunk);
      const buf = Buffer.concat(chunks);
      if (!buf || buf.length === 0) return extra.reply('❌ Could not download sticker.');
      await sock.sendMessage(extra.from, { sticker: buf }, { quoted: msg });
    } catch (e) { extra.reply('❌ ' + e.message); }
  }
};

const stealpp = {
  name: 'stealpp', aliases: ['savepfp'], category: 'general', description: "Save someone's pfp as sticker",
  async execute(sock, msg, args, extra) {
    const men    = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.participant;
    const target = (men && men[0]) || quoted || extra.sender;
    try {
      const pp  = await sock.profilePictureUrl(target, 'image');
      const r   = await axios.get(pp, { responseType: 'arraybuffer', timeout: 12000 });
      const buf = Buffer.from(r.data);
      if (!buf || buf.length === 0) return extra.reply('❌ Could not fetch picture.');
      const tempDir = getTempDir(); const ts = Date.now();
      const inF = path.join(tempDir, `pp_${ts}.jpg`); const outF = path.join(tempDir, `pp_${ts}.webp`);
      fs.writeFileSync(inF, buf);
      await new Promise((res, rej) => exec(`"${FFMPEG}" -i "${inF}" -vf "scale=512:512:force_original_aspect_ratio=decrease" -vcodec libwebp "${outF}" -y`, e => e ? rej(e) : res()));
      const webp = fs.readFileSync(outF);
      await sock.sendMessage(extra.from, { sticker: webp }, { quoted: msg });
      deleteTempFile(inF); deleteTempFile(outF);
    } catch (e) { extra.reply('❌ ' + e.message); }
  }
};

const whois = {
  name: 'whois', aliases: ['userinfo'], category: 'general', description: 'Get info about a user',
  async execute(sock, msg, args, extra) {
    const men    = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.participant;
    const target = (men && men[0]) || quoted || extra.sender;

    const participants = extra.groupMetadata?.participants || [];

    // Try to find this person in participant list first
    let displayNum = '';
    const found = participants.find(p => {
      const tBase = target.split(':')[0];
      return p.id.split(':')[0] === tBase ||
             (p.lid || '').split(':')[0] === tBase;
    });
    if (found) {
      displayNum = getPhoneNum(found, participants);
    }
    if (!displayNum) displayNum = resolveNum(target, participants, config.sessionName);
    if (!displayNum) displayNum = target.split('@')[0].split(':')[0];

    // Build the @mention JID (must be phone JID for WhatsApp to make it clickable)
    const mentionJid = displayNum.length >= 7 && displayNum.length <= 15
      ? `${displayNum}@s.whatsapp.net`
      : target;

    const isOwnerUser = db.isOwner ? db.isOwner(target) : false;
    const isSudoUser  = db.isSudo  ? db.isSudo(target)  : false;
    const role = isOwnerUser ? '👑 Owner' : isSudoUser ? '⭐ Sudo' : extra.isAdmin ? '🛡️ Admin' : '👤 Member';
    const warns = extra.isGroup ? db.getWarnings(extra.from, displayNum) : { count: 0 };

    let ppBuf = null;
    try {
      const pp = await sock.profilePictureUrl(target, 'image');
      const r  = await axios.get(pp, { responseType: 'arraybuffer', timeout: 8000 });
      ppBuf    = Buffer.from(r.data);
    } catch {}

    const txt = `🔍 *User Info*\n\n📱 @${displayNum}\n🏷️ Role: ${role}\n⚠️ Warnings: ${warns.count}/${config.maxWarnings}`;
    if (ppBuf) { await sock.sendMessage(extra.from, { image: ppBuf, caption: txt, mentions: [mentionJid] }, { quoted: msg }); }
    else        { await sock.sendMessage(extra.from, { text: txt, mentions: [mentionJid] }, { quoted: msg }); }
  }
};

// NOTE: `.clean` used to live here as a duplicate of admin/admin.js's clean.
// It's been removed — see admin/admin.js for the single canonical owner.

const cleancache = {
  name: 'cleancache', aliases: ['cleantemp'], category: 'general', description: 'Free disk space by deleting temp files', ownerOnly: true,
  async execute(sock, msg, args, extra) {
    const tempDir = getTempDir();
    let deleted = 0, freed = 0;
    try {
      for (const f of fs.readdirSync(tempDir)) {
        const fp = path.join(tempDir, f);
        try { const st = fs.statSync(fp); freed += st.size; fs.unlinkSync(fp); deleted++; } catch {}
      }
    } catch {}
    const mb = (freed / 1024 / 1024).toFixed(2);
    extra.reply(`🧹 *Cache Cleaned!*\n\n🗑️ Files deleted: *${deleted}*\n💾 Space freed: *${mb} MB*`);
  }
};

module.exports = [
  ping, uptime, owner, about, qr, github, getpp,
  groupinfo, groupstats, myactivity,
  viewonce, tts,
  sticker, take, stealpp, whois,
  cleancache
];
