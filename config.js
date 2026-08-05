// ─────────────────────────────────────────────────────────────────────────────
//  𝕊𝕥𝕖𝕧𝕖𝕟 Bot — config.js
//  All sensitive values can be overridden via environment variables.
//  Example: OWNER_NUMBER=201273323087 BOT_NUMBER=201118104987 node index.js
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  // ── Identity (override via env vars) ──────────────────────────────────────
  ownerNumber: (process.env.OWNER_NUMBER || '201273323087').split(',').map(n => n.trim()),
  ownerName:   (process.env.OWNER_NAME   || '𝕊𝕥𝕖𝕧𝕖𝕟').split(',').map(n => n.trim()),
  botNumber:   process.env.BOT_NUMBER    || '201118104987',
  sudoNumbers: [],

  // ── Bot branding ───────────────────────────────────────────────────────────
  botName:     process.env.BOT_NAME || '𝕊𝕥𝕖𝕧𝕖𝕟 BOT V5',
  prefix:      process.env.PREFIX   || '.',
  sessionName: process.env.SESSION  || 'session',
  version:     '5.0.0',

  packname:    '𝕊𝕥𝕖𝕧𝕖𝕟 BOT V5',
  author:      '𝕊𝕥𝕖𝕧𝕖𝕟',

  // ── Behaviour flags ────────────────────────────────────────────────────────
  selfMode:      false,
  autoReact:     false,
  autoReactMode: 'bot',   // 'bot' = only command messages | 'all' = every message
  autoTyping:    false,
  autoBio:       false,

  // ── Default group protection settings ─────────────────────────────────────
  defaultGroupSettings: {
    antilink:              false,  antilinkAction:          'delete',
    antitag:               false,  antitagAction:           'delete',
    antigroupmention:      false,  antigroupmentionAction:  'delete',
    antiall:               false,
    autosticker:           false,
    welcome:               false,  welcomeMessage: '',
    goodbye:               false,  goodbyeMessage: '',
  },

  // ── System messages ────────────────────────────────────────────────────────
  messages: {
    wait:           '🫒 *Processing...*',
    success:        '✅ *Done!*',
    error:          '❌ *An error occurred.*',
    ownerOnly:      '🫒 *This command is for the owner only.*',
    sudoOnly:       '⭐ *This command is for sudo/elite users only.*',
    adminOnly:      '🛡️ *Admin only command.*',
    groupOnly:      '👥 *This command only works in groups.*',
    privateOnly:    '💬 *This command only works in private chat.*',
    botAdminNeeded: '🤖 *Make me an admin first.*',
  },

  maxWarnings:   3,
  timezone:      'Asia/Beirut',
  newsletterJid: '',
};
