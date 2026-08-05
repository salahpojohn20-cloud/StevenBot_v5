// commands/admin/admin.js
const db     = require('../../database');
const config = require('../../config');
const { resolveNum, resolveParticipants } = require('../../utils/lidResolver');

const kick = {
  name: 'kick', category: 'admin', description: 'Kick a member', adminOnly: true, groupOnly: true, botAdminNeeded: true,
  async execute(sock, msg, args, extra) {
    const m = msg.message?.extendedTextMessage?.contextInfo;
    const t = (m?.mentionedJid?.[0]) || m?.participant;
    if (!t) return extra.reply('❌ Mention or reply to a user.');
    try {
      await sock.groupParticipantsUpdate(extra.from, [t], 'remove');
      const num = resolveNum(t, extra.groupMetadata?.participants);
      await sock.sendMessage(extra.from, { text: `✅ @${num || t.split('@')[0]} kicked.`, mentions: [t] }, { quoted: msg });
    } catch (e) { extra.reply('❌ ' + e.message); }
  }
};

// Build a clickable @mention JID — must be a phone JID (@s.whatsapp.net),
// NOT a @lid, otherwise WhatsApp won't render it as a tap-to-open link.
const buildMention = (targetJid, participants) => {
  const num = resolveNum(targetJid, participants, config.sessionName);
  if (num && num.length >= 7 && num.length <= 15) {
    return { displayNum: num, mentionJid: `${num}@s.whatsapp.net` };
  }
  return {
    displayNum: (targetJid || '').split('@')[0].split(':')[0],
    mentionJid: targetJid,
  };
};

// Check current admin status of a participant in the group metadata
const isAlreadyAdmin = (targetJid, participants = []) => {
  const tBase = (targetJid || '').split(':')[0];
  const found = participants.find(p => {
    const pId = (p.id || '').split(':')[0];
    const pLid = (p.lid || '').split(':')[0];
    return pId === tBase || pLid === tBase;
  });
  return !!(found && found.admin); // 'admin' or 'superadmin'
};

const promote = {
  name: 'promote', category: 'admin', description: 'Promote to admin', adminOnly: true, groupOnly: true, botAdminNeeded: true,
  async execute(sock, msg, args, extra) {
    const m = msg.message?.extendedTextMessage?.contextInfo;
    const t = (m?.mentionedJid?.[0]) || m?.participant;
    if (!t) return extra.reply('❌ Mention or reply to a user.');
    const parts = extra.groupMetadata?.participants || [];
    const { displayNum, mentionJid } = buildMention(t, parts);
    if (isAlreadyAdmin(t, parts)) {
      return sock.sendMessage(extra.from, {
        text: `⚠️ @${displayNum} is already an admin.`,
        mentions: [mentionJid]
      }, { quoted: msg });
    }
    try {
      await sock.groupParticipantsUpdate(extra.from, [t], 'promote');
      await sock.sendMessage(extra.from, {
        text: `👑 @${displayNum} is now admin!`,
        mentions: [mentionJid]
      }, { quoted: msg });
    } catch (e) { extra.reply('❌ ' + e.message); }
  }
};

const demote = {
  name: 'demote', category: 'admin', description: 'Demote admin to member', adminOnly: true, groupOnly: true, botAdminNeeded: true,
  async execute(sock, msg, args, extra) {
    const m = msg.message?.extendedTextMessage?.contextInfo;
    const t = (m?.mentionedJid?.[0]) || m?.participant;
    if (!t) return extra.reply('❌ Mention or reply to a user.');
    const parts = extra.groupMetadata?.participants || [];
    const { displayNum, mentionJid } = buildMention(t, parts);
    if (!isAlreadyAdmin(t, parts)) {
      return sock.sendMessage(extra.from, {
        text: `⚠️ @${displayNum} is not an admin.`,
        mentions: [mentionJid]
      }, { quoted: msg });
    }
    try {
      await sock.groupParticipantsUpdate(extra.from, [t], 'demote');
      await sock.sendMessage(extra.from, {
        text: `⬇️ @${displayNum} demoted.`,
        mentions: [mentionJid]
      }, { quoted: msg });
    } catch (e) { extra.reply('❌ ' + e.message); }
  }
};

const warn = {
  name: 'warn', category: 'admin', description: 'Warn a member', adminOnly: true, groupOnly: true,
  async execute(sock, msg, args, extra) {
    const m = msg.message?.extendedTextMessage?.contextInfo;
    const t = (m?.mentionedJid?.[0]) || m?.participant;
    if (!t) return extra.reply('❌ Mention or reply to a user.');
    const num    = resolveNum(t, extra.groupMetadata?.participants) || t.split('@')[0].split(':')[0];
    const reason = args.slice(1).join(' ') || 'No reason given';
    const w      = db.addWarning(extra.from, num, reason);
    let text     = `⚠️ *Warning*\n👤 @${num}\n📝 ${reason}\n🔢 ${w.count}/${config.maxWarnings}`;
    if (w.count >= config.maxWarnings) {
      text += '\n\n🚫 Max warns reached — kicking...';
      try {
        const botA = await extra.isBotAdminFn();
        if (botA) { await sock.groupParticipantsUpdate(extra.from, [t], 'remove'); db.clearWarnings(extra.from, num); }
      } catch {}
    }
    await sock.sendMessage(extra.from, { text, mentions: [t] }, { quoted: msg });
  }
};

const resetwarn = {
  name: 'resetwarn', aliases: ['clearwarn'], category: 'admin', description: 'Reset user warns', adminOnly: true, groupOnly: true,
  async execute(sock, msg, args, extra) {
    const m = msg.message?.extendedTextMessage?.contextInfo;
    const t = (m?.mentionedJid?.[0]) || m?.participant;
    if (!t) return extra.reply('❌ Mention or reply to a user.');
    const num = resolveNum(t, extra.groupMetadata?.participants) || t.split('@')[0].split(':')[0];
    db.clearWarnings(extra.from, num);
    await sock.sendMessage(extra.from, { text: `✅ Warns cleared for @${num}`, mentions: [t] }, { quoted: msg });
  }
};

const tagall = {
  name: 'tagall', aliases: ['mentionall'], category: 'admin', description: 'Tag all members', adminOnly: true, groupOnly: true,
  async execute(sock, msg, args, extra) {
    const m = extra.groupMetadata;
    if (!m) return extra.reply('❌ Could not fetch members.');

    const customText = args.join(' ') || '📢 Attention!';
    const resolved   = resolveParticipants(m.participants, config.sessionName);
    const mentions   = resolved.map(p => p.phoneJid || p.id);

    // Build formatted mention list — one per line for readability
    const mentionLines = resolved.map(p => {
      const num = p.phoneNum || p.id.split('@')[0].split(':')[0];
      return `@${num}`;
    }).join('\n');

    const text = `🔔 *${customText}*\n\n${mentionLines}`;
    await sock.sendMessage(extra.from, { text, mentions }, { quoted: msg });
  }
};

const hidetag = {
  name: 'hidetag', aliases: ['htag'], category: 'admin', description: 'Silent tag all', adminOnly: true, groupOnly: true,
  async execute(sock, msg, args, extra) {
    const m = extra.groupMetadata;
    if (!m) return extra.reply('❌ Could not fetch members.');
    const text = args.join(' ') || '📢 Notice';
    await sock.sendMessage(extra.from, { text, mentions: m.participants.map(p => p.id) }, { quoted: msg });
  }
};

const mute = {
  name: 'mute', category: 'admin', description: 'Mute group (admins only)', adminOnly: true, groupOnly: true, botAdminNeeded: true,
  async execute(sock, msg, args, extra) {
    try { await sock.groupSettingUpdate(extra.from, 'announcement'); extra.reply('🔇 Group muted.'); }
    catch (e) { extra.reply('❌ ' + e.message); }
  }
};

const unmute = {
  name: 'unmute', category: 'admin', description: 'Unmute group', adminOnly: true, groupOnly: true, botAdminNeeded: true,
  async execute(sock, msg, args, extra) {
    try { await sock.groupSettingUpdate(extra.from, 'not_announcement'); extra.reply('🔊 Group unmuted.'); }
    catch (e) { extra.reply('❌ ' + e.message); }
  }
};

const deleteMsg = {
  name: 'delete', aliases: ['del'], category: 'admin', description: 'Delete a replied message', adminOnly: true,
  async execute(sock, msg, args, extra) {
    const q = msg.message?.extendedTextMessage?.contextInfo;
    if (!q) return extra.reply('❌ Reply to a message to delete it.');
    try { await sock.sendMessage(extra.from, { delete: { remoteJid: extra.from, fromMe: false, id: q.stanzaId, participant: q.participant } }); }
    catch (e) { extra.reply('❌ ' + e.message); }
  }
};

const grouplink = {
  name: 'grouplink', aliases: ['invitelink'], category: 'admin', description: 'Get group invite link', adminOnly: true, groupOnly: true, botAdminNeeded: true,
  async execute(sock, msg, args, extra) {
    try { const c = await sock.groupInviteCode(extra.from); extra.reply(`🔗 *Invite Link:*\nhttps://chat.whatsapp.com/${c}`); }
    catch (e) { extra.reply('❌ ' + e.message); }
  }
};

const groupstatus = {
  name: 'groupstatus', category: 'admin', description: 'Change group description', adminOnly: true, groupOnly: true, botAdminNeeded: true,
  async execute(sock, msg, args, extra) {
    const desc = args.join(' '); if (!desc) return extra.reply('❌ Usage: .groupstatus <description>');
    try { await sock.groupUpdateDescription(extra.from, desc); extra.reply('✅ Group description updated!'); }
    catch (e) { extra.reply('❌ ' + e.message); }
  }
};

// ── Moderation toggles ────────────────────────────────────────────────────────

const antilink = {
  name: 'antilink', category: 'admin', description: 'Toggle anti-link (deletes WhatsApp group links)', adminOnly: true, groupOnly: true,
  async execute(sock, msg, args, extra) {
    const s  = args[0]?.toLowerCase();
    const gs = db.getGroupSettings(extra.from);
    if (s === 'on')   { db.updateGroupSettings(extra.from, { antilink: true });  extra.reply('🔗 Anti-link *ON* — group links will be deleted.'); }
    else if (s === 'off') { db.updateGroupSettings(extra.from, { antilink: false }); extra.reply('🔗 Anti-link *OFF*.'); }
    else if (s === 'action') {
      const action = args[1]?.toLowerCase();
      if (!['delete', 'kick'].includes(action)) return extra.reply('❌ Action must be: delete | kick');
      db.updateGroupSettings(extra.from, { antilinkAction: action });
      extra.reply(`✅ Anti-link action set to: *${action}*`);
    }
    else extra.reply(`🔗 Anti-link: *${gs.antilink ? 'ON' : 'OFF'}*\nAction: *${gs.antilinkAction || 'delete'}*\n\nUsage:\n.antilink on/off\n.antilink action delete/kick`);
  }
};

const antigroupmention = {
  name: 'antigroupmention', category: 'admin', description: 'Toggle anti @everyone / story mentions', adminOnly: true, groupOnly: true,
  async execute(sock, msg, args, extra) {
    const s = args[0]?.toLowerCase();
    if (s === 'on')       { db.updateGroupSettings(extra.from, { antigroupmention: true });  extra.reply('🛡️ Anti group mention *ON* — @everyone and story mentions will be deleted.'); }
    else if (s === 'off') { db.updateGroupSettings(extra.from, { antigroupmention: false }); extra.reply('🛡️ Anti group mention *OFF*.'); }
    else extra.reply(`🛡️ Anti group mention: *${db.getGroupSettings(extra.from).antigroupmention ? 'ON' : 'OFF'}*\n\nUsage: .antigroupmention on/off`);
  }
};

const antitag = {
  name: 'antitag', category: 'admin', description: 'Toggle anti mass-tag (3+ mentions)', adminOnly: true, groupOnly: true,
  async execute(sock, msg, args, extra) {
    const s = args[0]?.toLowerCase();
    if (s === 'on')       { db.updateGroupSettings(extra.from, { antitag: true });  extra.reply('🏷️ Anti-tag *ON* — mass mentions (3+) will be deleted.'); }
    else if (s === 'off') { db.updateGroupSettings(extra.from, { antitag: false }); extra.reply('🏷️ Anti-tag *OFF*.'); }
    else extra.reply(`🏷️ Anti-tag: *${db.getGroupSettings(extra.from).antitag ? 'ON' : 'OFF'}*\n\nUsage: .antitag on/off`);
  }
};

const autosticker = {
  name: 'autosticker', category: 'admin', description: 'Auto-convert images to stickers', adminOnly: true, groupOnly: true,
  async execute(sock, msg, args, extra) {
    const s = args[0]?.toLowerCase();
    if (s === 'on')       { db.updateGroupSettings(extra.from, { autosticker: true });  extra.reply('🖼️ Auto sticker *ON*.'); }
    else if (s === 'off') { db.updateGroupSettings(extra.from, { autosticker: false }); extra.reply('🖼️ Auto sticker *OFF*.'); }
    else extra.reply(`🖼️ Auto sticker: *${db.getGroupSettings(extra.from).autosticker ? 'ON' : 'OFF'}*`);
  }
};

const welcome = {
  name: 'welcome', category: 'admin', description: 'Toggle welcome messages', adminOnly: true, groupOnly: true,
  async execute(sock, msg, args, extra) {
    const s  = args[0]?.toLowerCase();
    const gs = db.getGroupSettings(extra.from);
    if (s === 'on')       { db.updateGroupSettings(extra.from, { welcome: true });  extra.reply('👋 Welcome *ON*.'); }
    else if (s === 'off') { db.updateGroupSettings(extra.from, { welcome: false }); extra.reply('👋 Welcome *OFF*.'); }
    else extra.reply(`👋 Welcome: *${gs.welcome ? 'ON' : 'OFF'}*`);
  }
};

const goodbye = {
  name: 'goodbye', category: 'admin', description: 'Toggle goodbye messages', adminOnly: true, groupOnly: true,
  async execute(sock, msg, args, extra) {
    const s = args[0]?.toLowerCase();
    if (s === 'on')       { db.updateGroupSettings(extra.from, { goodbye: true });  extra.reply('👋 Goodbye *ON*.'); }
    else if (s === 'off') { db.updateGroupSettings(extra.from, { goodbye: false }); extra.reply('👋 Goodbye *OFF*.'); }
    else extra.reply(`👋 Goodbye: *${db.getGroupSettings(extra.from).goodbye ? 'ON' : 'OFF'}*`);
  }
};

const setwelcome = {
  name: 'setwelcome', category: 'admin', description: 'Set welcome message. Variables: @user #memberCount', adminOnly: true, groupOnly: true,
  async execute(sock, msg, args, extra) {
    const text = args.join(' '); if (!text) return extra.reply('❌ Usage: .setwelcome <message>\nVariables: @user #memberCount\n\nThen turn it on with: .welcome on');
    // IMPORTANT: only persist the template — leave the toggle as-is.
    // Auto-enabling here used to surprise users who only wanted to draft a
    // message. Use `.welcome on` to actually enable.
    db.updateGroupSettings(extra.from, { welcomeMessage: text });
    const gs = db.getGroupSettings(extra.from);
    extra.reply(`✅ Welcome template saved.\n\n${text}\n\n${gs.welcome ? '✅ Welcome is *ON*.' : '⚠️ Welcome is *OFF*. Run *.welcome on* to enable.'}`);
  }
};

const setgoodbye = {
  name: 'setgoodbye', category: 'admin', description: 'Set goodbye message', adminOnly: true, groupOnly: true,
  async execute(sock, msg, args, extra) {
    const text = args.join(' '); if (!text) return extra.reply('❌ Usage: .setgoodbye <message>\n\nThen turn it on with: .goodbye on');
    db.updateGroupSettings(extra.from, { goodbyeMessage: text });
    const gs = db.getGroupSettings(extra.from);
    extra.reply(`✅ Goodbye template saved.\n\n${text}\n\n${gs.goodbye ? '✅ Goodbye is *ON*.' : '⚠️ Goodbye is *OFF*. Run *.goodbye on* to enable.'}`);
  }
};

// `clean` exists once, here in admin/. The duplicate that previously lived in
// general/general.js has been removed to avoid command-table collisions.
const clean = {
  name: 'clean', category: 'admin', description: 'Guidance on message cleanup', adminOnly: true,
  async execute(sock, msg, args, extra) {
    extra.reply('🧹 *Clean Commands*\n\n▸ *.delete* — Reply to any message to delete it\n▸ *.cleancache* — Free disk space (owner only)\n\n_WhatsApp only allows deleting your own messages or messages where bot is admin._');
  }
};

const adminreq = {
  name: 'adminreq', aliases: ['reqadmin', 'requestadmin'], category: 'admin', description: 'DM all group admins requesting bot promotion', groupOnly: true,
  async execute(sock, msg, args, extra) {
    const m = extra.groupMetadata;
    if (!m) return extra.reply('❌ Could not fetch group info.');
    const admins    = m.participants.filter(p => p.admin).map(p => p.id);
    if (!admins.length) return extra.reply('❌ No admins found in this group.');
    const groupName = m.subject;
    const botName   = db.getBotName ? db.getBotName() : config.botName;
    let sent = 0;
    for (const admin of admins) {
      try {
        await sock.sendMessage(admin, {
          text: `👋 Hi! I'm *${botName}*.\n\nPlease make me an admin in *${groupName}* so I can use all my features (kick, mute, delete messages, etc.).\n\nThank you! 🙏`
        });
        sent++;
        await new Promise(r => setTimeout(r, 1000));
      } catch {}
    }
    extra.reply(`📨 Admin request sent to ${sent}/${admins.length} admins via DM.\n\n⚠️ Note: WhatsApp does not allow bots to promote themselves — only group admins can do that.`);
  }
};

module.exports = [
  kick, promote, demote, warn, resetwarn,
  tagall, hidetag, mute, unmute, deleteMsg,
  grouplink, groupstatus,
  antilink, antigroupmention, antitag, autosticker,
  welcome, goodbye, setwelcome, setgoodbye,
  clean, adminreq
];
