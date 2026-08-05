// commands/owner/owner.js
const db     = require('../../database');
const config = require('../../config');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { resolveNum } = require('../../utils/lidResolver');
const fs   = require('fs');
const path = require('path');

// Lazy-load handler's findParticipant (the single LID-aware source of truth)
let _findParticipant = null;
const getFind = () => {
  if (!_findParticipant) {
    try { _findParticipant = require('../../handler').findParticipant; } catch {}
  }
  return _findParticipant;
};

const BANKAI_AUDIO = path.join(__dirname, '../../assets/bankai.mp3');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const STEVEN_NAMES = [
  '𝕊𝕥𝕖𝕧𝕖𝕟 ✦ 𝕮𝖔𝖓𝖙𝖗𝖔𝖑',
  '▄︻デ══━一 𝕊𝕥𝕖𝕧𝕖𝕟',
  '『 𝕊𝕥𝕖𝕧𝕖𝕟 』⚔',
  '⟦ 𝕊𝕥𝕖𝕧𝕖𝕟 ⟧ ✧',
  '╔═[ 𝕊𝕥𝕖𝕧𝕖𝕟 ]═╗',
];

const STEVEN_MSGS = [
  'لقد أتى الظل... وأخذ الجميع.\n\n« Steven was here »\n\n— 𝕊𝕥𝕖𝕧𝕖𝕟 🫒',
  'من الظلام أتينا... وإلى الظلام عدنا.\n\n— Steven',
  'الظل لا يُحارَب... الظل يُسيطر.\n\n« Executed by Steven »',
  'كنتم هنا... والآن لستم.\n\n— 𝕊𝕥𝕖𝕧𝕖𝕟',
];

// Build owner phone numbers from config (digits only)
const getOwnerNums = () =>
  config.ownerNumber.map(n => n.replace(/\D/g, '')).filter(Boolean);

// ── Shared kick logic for abyss/bankai ────────────────────────────────────────
// HARD GUARANTEE: bot is NEVER in the returned kick list, even when only
// known by LID. We compare every possible identifier the bot could have
// (id user-part, lid user-part, resolved phone) against every identifier
// each participant could have (id, lid, phoneNumber, resolved phone).
const buildKickList = (participants, sock, sessionName = 'session') => {
  const botId     = sock.user?.id  || '';
  const botLid    = sock.user?.lid || '';
  const ownerNums = getOwnerNums();
  const findP     = getFind();

  // Collect ALL bot identifiers (user-part of id, user-part of lid, resolved phone)
  const botUserParts = new Set();
  const stripUser = j => (j || '').split('@')[0].split(':')[0].replace(/\D/g, '');
  if (botId)  botUserParts.add(stripUser(botId));
  if (botLid) botUserParts.add(stripUser(botLid));
  // Try to resolve bot to a real phone via the participant list itself
  try {
    const botResolved = resolveNum(botId, participants, sessionName);
    if (botResolved) botUserParts.add(botResolved.replace(/\D/g, ''));
    if (botLid) {
      const botLidResolved = resolveNum(botLid, participants, sessionName);
      if (botLidResolved) botUserParts.add(botLidResolved.replace(/\D/g, ''));
    }
  } catch {}
  botUserParts.delete(''); // never match on empty string

  const keepJids = [botId];
  if (botLid) keepJids.push(botLid);
  ownerNums.forEach(n => keepJids.push(`${n}@s.whatsapp.net`));

  const isBotParticipant = (p) => {
    const candidates = [
      stripUser(p.id),
      stripUser(p.lid),
      stripUser(p.phoneNumber),
    ];
    try {
      const r = resolveNum(p.id, participants, sessionName);
      if (r) candidates.push(r.replace(/\D/g, ''));
    } catch {}
    return candidates.some(c => c && botUserParts.has(c));
  };

  return participants.filter(p => {
    // 1. Hardest check: never kick the bot, no matter what JID form it takes
    if (isBotParticipant(p)) return false;

    // 2. findParticipant covers bot + owners via LID-aware resolver
    if (findP) {
      try {
        const match = findP([p], keepJids);
        if (match) return false;
      } catch {}
    }

    // 3. Owner check (raw + resolved)
    const pUser  = stripUser(p.id);
    const pLUser = stripUser(p.lid);
    for (const ownerNum of ownerNums) {
      if (pUser  === ownerNum) return false;
      if (pLUser === ownerNum) return false;
      try {
        const pNum = resolveNum(p.id, participants, sessionName);
        if (pNum && pNum.replace(/\D/g, '') === ownerNum) return false;
      } catch {}
    }
    return true;
  }).map(p => p.id);
};

const broadcast = {
  name: 'broadcast', aliases: ['bc'], category: 'owner', description: 'Broadcast to all groups', ownerOnly: true,
  async execute(sock, msg, args, extra) {
    const text = args.join(' '); if (!text) return extra.reply('❌ Usage: .broadcast <message>');
    const groups = await sock.groupFetchAllParticipating().catch(() => ({}));
    const jids = Object.keys(groups); if (!jids.length) return extra.reply('❌ No groups found.');
    extra.reply(`📢 Broadcasting to ${jids.length} groups...`);
    let sent = 0, failed = 0;
    for (const g of jids) { try { await sock.sendMessage(g, { text: `🫒 *Broadcast*\n\n${text}` }); sent++; await sleep(1200); } catch { failed++; } }
    extra.reply(`✅ Sent: ${sent} | Failed: ${failed}`);
  }
};

const restart = {
  name: 'restart', category: 'owner', description: 'Restart the bot', ownerOnly: true,
  async execute(sock, msg, args, extra) { await extra.reply('🫒 Reloading...'); setTimeout(() => process.exit(0), 1000); }
};

const mode = {
  name: 'mode', category: 'owner', description: 'Set bot mode', ownerOnly: true,
  async execute(sock, msg, args, extra) {
    const modes = ['public', 'private', 'group']; const m = args[0]?.toLowerCase();
    if (!m || !modes.includes(m)) return extra.reply(`🫒 Mode: *${db.getMode()}*\n\n▸ .mode public\n▸ .mode private\n▸ .mode group`);
    db.setBotSetting('mode', m); extra.reply(`✅ Mode: *${m}*`);
  }
};

const block = {
  name: 'block', aliases: ['ban'], category: 'owner', description: 'Ban user from using bot', ownerOnly: true,
  async execute(sock, msg, args, extra) {
    const ctx = msg.message?.extendedTextMessage?.contextInfo;
    const t = ctx?.mentionedJid?.[0] || ctx?.participant;
    const num = args[0]?.replace(/\D/g, '');
    const target = t || (num ? num + '@s.whatsapp.net' : null);
    const dn = (t || '').split('@')[0].split(':')[0] || num;
    if (!target) return extra.reply('❌ Usage: .block @user or .block <number>');
    if (db.banUser && db.banUser(target)) { extra.reply(`🚫 *Banned:* +${dn}`); }
    else extra.reply(`⚠️ +${dn} is already banned.`);
  }
};

const unblock = {
  name: 'unblock', aliases: ['unban'], category: 'owner', description: 'Unban a user from bot', ownerOnly: true,
  async execute(sock, msg, args, extra) {
    const ctx = msg.message?.extendedTextMessage?.contextInfo;
    const t = ctx?.mentionedJid?.[0] || ctx?.participant;
    const num = args[0]?.replace(/\D/g, '');
    const target = t || (num ? num + '@s.whatsapp.net' : null);
    const dn = (t || '').split('@')[0].split(':')[0] || num;
    if (!target) return extra.reply('❌ Usage: .unblock @user or .unblock <number>');
    if (db.unbanUser && db.unbanUser(target)) { extra.reply(`✅ *Unbanned:* +${dn}`); }
    else extra.reply(`⚠️ +${dn} not in ban list.`);
  }
};

const banlist = {
  name: 'banlist', aliases: ['blocklist'], category: 'owner', description: 'Show banned users', ownerOnly: true,
  async execute(sock, msg, args, extra) {
    const list = db.getBanned ? db.getBanned() : [];
    if (!list.length) return extra.reply('📋 No banned users.');
    extra.reply(`🚫 *Banned*\n\n${list.map((n, i) => `${i + 1}. +${n}`).join('\n')}\n\nTotal: ${list.length}`);
  }
};

const setpp = {
  name: 'setpp', aliases: ['pp', 'profilepic'], category: 'owner', description: 'Set bot profile picture', ownerOnly: true,
  async execute(sock, msg, args, extra) {
    try {
      const ctx = msg.message?.extendedTextMessage?.contextInfo;
      const quoted = ctx?.quotedMessage;
      if (!quoted) return extra.reply('❌ Reply to an image and use .setpp');
      const quotedMsg = { message: quoted, key: msg.key };
      const buf = await downloadMediaMessage(quotedMsg, 'image', {});
      if (!buf) return extra.reply('❌ Could not read quoted image.');
      await sock.updateProfilePicture(sock.user.id, buf);
      extra.reply('✅ Profile picture updated!');
    } catch (e) { extra.reply('❌ ' + e.message); }
  }
};

const autoreact = {
  name: 'autoreact', category: 'owner', description: 'Toggle auto-react', ownerOnly: true,
  async execute(sock, msg, args, extra) {
    const s = args[0]?.toLowerCase();
    if (s === 'on')       { config.autoReact = true;  db.setBotSetting('autoReact', true);  extra.reply('⚡ Auto-react *ON*'); }
    else if (s === 'off') { config.autoReact = false; db.setBotSetting('autoReact', false); extra.reply('⚡ Auto-react *OFF*'); }
    else extra.reply(`⚡ Auto-react: *${config.autoReact ? 'ON' : 'OFF'}*\nUsage: .autoreact on/off`);
  }
};

const anticall = {
  name: 'anticall', category: 'owner', description: 'Toggle auto-reject calls', ownerOnly: true,
  async execute(sock, msg, args, extra) {
    try {
      const handler = require('../../handler');
      const s = args[0]?.toLowerCase();
      if (s === 'on')       { handler.setAntiCall(true);  extra.reply('📵 Anti-call *ON*'); }
      else if (s === 'off') { handler.setAntiCall(false); extra.reply('📵 Anti-call *OFF*'); }
      else extra.reply(`📵 Anti-call: *${handler.antiCallEnabled ? 'ON' : 'OFF'}*\nUsage: .anticall on/off`);
    } catch (e) { extra.reply('❌ ' + e.message); }
  }
};




const addsudo = {
  name: 'addsudo', aliases: ['addsuper', 'addelite'], category: 'owner', description: 'Add sudo/elite user', ownerOnly: true,
  async execute(sock, msg, args, extra) {
    const ctx = msg.message?.extendedTextMessage?.contextInfo;
    let targetJid = ctx?.mentionedJid?.[0] || ctx?.participant || null;
    let num = targetJid
      ? resolveNum(targetJid, extra.groupMetadata?.participants, config.sessionName)
      : null;

    if (!targetJid && args[0]) {
      const c = args[0].replace(/\D/g, '');
      if (c.length >= 7) { targetJid = c + '@s.whatsapp.net'; num = c; }
    }
    if (!targetJid) return extra.reply('❌ Usage: .addsudo @user or .addsudo <number>');

    // Store by phone JID for consistency
    const storeJid = num ? `${num}@s.whatsapp.net` : targetJid;
    if (db.addSudo(storeJid)) {
      // Build clickable @mention
      const mentionJid = num ? `${num}@s.whatsapp.net` : targetJid;
      await sock.sendMessage(extra.from, {
        text: `✅ *Sudo Added!*\n\n👤 @${num || storeJid.split('@')[0]}`,
        mentions: [mentionJid]
      }, { quoted: msg });
    } else {
      extra.reply('⚠️ Already sudo.');
    }
  }
};

const delsudo = {
  name: 'delsudo', aliases: ['removesudo', 'delelite'], category: 'owner', description: 'Remove sudo user', ownerOnly: true,
  async execute(sock, msg, args, extra) {
    const ctx = msg.message?.extendedTextMessage?.contextInfo;
    let targetJid = ctx?.mentionedJid?.[0] || ctx?.participant || null;
    let num = targetJid
      ? resolveNum(targetJid, extra.groupMetadata?.participants, config.sessionName)
      : null;

    if (!targetJid && args[0]) {
      const c = args[0].replace(/\D/g, '');
      if (c.length >= 7) { targetJid = c + '@s.whatsapp.net'; num = c; }
    }
    if (!targetJid) return extra.reply('❌ Usage: .delsudo @user or .delsudo <number>');

    const storeJid = num ? `${num}@s.whatsapp.net` : targetJid;
    if (db.removeSudo(storeJid)) {
      const mentionJid = num ? `${num}@s.whatsapp.net` : targetJid;
      await sock.sendMessage(extra.from, {
        text: `✅ *Sudo Removed*\n\n👤 @${num || storeJid.split('@')[0]}`,
        mentions: [mentionJid]
      }, { quoted: msg });
    } else {
      extra.reply('⚠️ Not in sudo list.');
    }
  }
};

const sudolist = {
  name: 'sudolist', aliases: ['elitelist'], category: 'owner', description: 'List sudo users', ownerOnly: true,
  async execute(sock, msg, args, extra) {
    const list = db.getSudoList();
    if (!list.length) return extra.reply('🫒 No sudo users.\nUse .addsudo to add.');
    const mentions = list.map(jid => jid.includes('@') ? jid : `${jid}@s.whatsapp.net`);
    const lines = mentions.map((jid, i) => {
      const num = jid.split('@')[0].replace(/\D/g, '');
      return `${i + 1}. @${num}`;
    }).join('\n');
    await sock.sendMessage(extra.from, {
      text: `🫒 *𝕊𝕥𝕖𝕧𝕖𝕟 Elite*\n\n${lines}\n\nTotal: ${list.length}`,
      mentions
    }, { quoted: msg });
  }
};

const adminreq = {
  name: 'adminreq', aliases: ['reqadmin'], category: 'admin', description: 'DM admins requesting bot promotion', groupOnly: true,
  async execute(sock, msg, args, extra) {
    const m = extra.groupMetadata; if (!m) return extra.reply('❌ No group info.');
    const admins = m.participants.filter(p => p.admin).map(p => p.id);
    if (!admins.length) return extra.reply('❌ No admins found.');
    let sent = 0;
    for (const a of admins) { try { await sock.sendMessage(a, { text: `👋 Please make me admin in *${m.subject}* so I can use all features. 🙏` }); sent++; await sleep(1000); } catch {} }
    extra.reply(`📨 Request sent to ${sent}/${admins.length} admins.`);
  }
};

// ── ABYSS: kick everyone — BOT STAYS IN GROUP ─────────────────────────────────
// CRITICAL ORDER:
//   1. Subject + description (cosmetic, fire-and-forget OK)
//   2. AWAIT Steven text (must be delivered before chaos)
//   3. AWAIT voice note (the whole point — must arrive before kicks)
//   4. ONLY THEN start kicking
// We do NOT call groupSettingUpdate('announcement') — it can flip bot perms
// in LID-mode and trigger the bot itself being booted from the group.
// Bot exclusion: buildKickList already guarantees the bot is never in the
// kick list, even when known only by LID. We also re-filter live just before
// each batch to defend against any race.
const abyss = {
  name: 'abyss', category: 'owner', description: '⚔️ Kick everyone. Bot stays.', ownerOnly: true, groupOnly: true,
  async execute(sock, msg, args, extra) {
    const from = extra.from;
    const m    = extra.groupMetadata; if (!m) return extra.reply('❌ No group info.');

    const allJids    = m.participants.map(p => p.id);
    const stevenName = STEVEN_NAMES[Math.floor(Math.random() * STEVEN_NAMES.length)];
    const stevenMsg  = STEVEN_MSGS[Math.floor(Math.random() * STEVEN_MSGS.length)];
    const fire = fn => fn().catch(() => {});

    // 1. Cosmetics — fire-and-forget is fine, they don't gate the kick
    fire(() => sock.groupUpdateSubject(from, stevenName));
    fire(() => sock.groupUpdateDescription(from, 'تم زرفكم من 𝕊𝕥𝕖𝕧𝕖𝕟'));
    await sleep(400);

    // 2. AWAIT the dramatic text so it's actually visible before kicks
    try {
      await sock.sendMessage(from, { text: stevenMsg, mentions: allJids });
    } catch (e) { console.error('[abyss] text failed:', e.message); }

    // 3. AWAIT the voice note — this MUST land before the kick batch starts
    if (fs.existsSync(BANKAI_AUDIO)) {
      try {
        const audioBuf = fs.readFileSync(BANKAI_AUDIO);
        await sock.sendMessage(from, {
          audio: audioBuf,
          mimetype: 'audio/mpeg',
          ptt: false,
        });
      } catch (e) {
        console.error('[abyss] audio failed:', e.message);
      }
    }

    // Small grace period so clients render the audio before chaos
    await sleep(1500);

    // 4. Build kick list with hard bot-exclusion
    let toKick = buildKickList(m.participants, sock, config.sessionName);

    // Defensive double-filter: scrub any JID that matches the bot identifier
    // in any form (id, lid, raw user-part). Belt-and-suspenders.
    const stripU = j => (j || '').split('@')[0].split(':')[0].replace(/\D/g, '');
    const botStripped = new Set([
      stripU(sock.user?.id),
      stripU(sock.user?.lid),
    ].filter(Boolean));
    toKick = toKick.filter(jid => !botStripped.has(stripU(jid)));

    // Kick in batches of 20
    for (let i = 0; i < toKick.length; i += 20) {
      const batch = toKick.slice(i, i + 20).filter(jid => !botStripped.has(stripU(jid)));
      if (!batch.length) continue;
      await sock.groupParticipantsUpdate(from, batch, 'remove').catch(() => {});
      if (i + 20 < toKick.length) await sleep(500);
    }

    // Bot stays — confirm
    await sleep(500);
    fire(() => sock.sendMessage(from, { text: `🫒 تم. ${toKick.length} شخص تم إزاله.\n𝕊𝕥𝕖𝕧𝕖𝕟 باقي. ✨` }));
  }
};

// ── BANKAI: kick EVERYONE (including owner) + bot leaves last ────────────────
// Unlike .abyss, .bankai is the nuclear option — even the owner gets kicked.
// Only the bot itself is kept until it has finished kicking, then it leaves
// the group too. The text + voice note are awaited so they actually land
// before the chaos starts.
const bankai = {
  name: 'bankai', category: 'owner', description: '💀 Kick EVERYONE (owner too) + bot leaves', ownerOnly: true, groupOnly: true,
  async execute(sock, msg, args, extra) {
    const from = extra.from;
    const m    = extra.groupMetadata; if (!m) return extra.reply('❌ No group info.');

    const allJids    = m.participants.map(p => p.id);
    const stevenName = STEVEN_NAMES[Math.floor(Math.random() * STEVEN_NAMES.length)];
    const stevenMsg  = STEVEN_MSGS[Math.floor(Math.random() * STEVEN_MSGS.length)];
    const fire = fn => fn().catch(() => {});

    // 1. Cosmetics
    fire(() => sock.groupUpdateSubject(from, stevenName));
    fire(() => sock.groupUpdateDescription(from, 'تم زرفكم من 𝕊𝕥𝕖𝕧𝕖𝕟'));
    await sleep(400);

    // 2. AWAIT dramatic text — must be visible before kicks
    try {
      await sock.sendMessage(from, { text: stevenMsg, mentions: allJids });
    } catch (e) { console.error('[bankai] text failed:', e.message); }

    // 3. AWAIT voice note — must land before kicks
    if (fs.existsSync(BANKAI_AUDIO)) {
      try {
        const audioBuf = fs.readFileSync(BANKAI_AUDIO);
        await sock.sendMessage(from, {
          audio: audioBuf,
          mimetype: 'audio/mpeg',
          ptt: false,
        });
      } catch (e) {
        console.error('[bankai] audio failed:', e.message);
      }
    }

    await sleep(1500);

    // 4. Build kick list manually — kick EVERYONE except the bot itself.
    //    DO NOT use buildKickList here: it whitelists the owner, which is
    //    exactly the opposite of what bankai needs. Owners must go too.
    const stripU = j => (j || '').split('@')[0].split(':')[0].replace(/\D/g, '');
    const botStripped = new Set([
      stripU(sock.user?.id),
      stripU(sock.user?.lid),
    ].filter(Boolean));

    // Also resolve bot phone via the participant list in case the bot only
    // appears under its LID identity.
    try {
      const botResolved = resolveNum(sock.user?.id, m.participants, config.sessionName);
      if (botResolved) botStripped.add(botResolved.replace(/\D/g, ''));
      if (sock.user?.lid) {
        const botLidResolved = resolveNum(sock.user.lid, m.participants, config.sessionName);
        if (botLidResolved) botStripped.add(botLidResolved.replace(/\D/g, ''));
      }
    } catch {}

    const isBot = (p) => {
      const cands = [stripU(p.id), stripU(p.lid), stripU(p.phoneNumber)];
      try {
        const r = resolveNum(p.id, m.participants, config.sessionName);
        if (r) cands.push(r.replace(/\D/g, ''));
      } catch {}
      return cands.some(c => c && botStripped.has(c));
    };

    const toKick = m.participants
      .filter(p => !isBot(p))
      .map(p => p.id);

    // 5. Kick in batches of 20 — owner included, bot excluded
    for (let i = 0; i < toKick.length; i += 20) {
      const batch = toKick.slice(i, i + 20);
      await sock.groupParticipantsUpdate(from, batch, 'remove').catch(() => {});
      if (i + 20 < toKick.length) await sleep(500);
    }

    // 6. Bot leaves last — only the bot remained, now it's gone too
    await sleep(800);
    await sock.groupLeave(from).catch(() => {});
  }
};

module.exports = [
  broadcast, restart, mode, block, unblock, banlist, setpp,
  autoreact, anticall,
  addsudo, delsudo, sudolist,
  adminreq, abyss, bankai
];
