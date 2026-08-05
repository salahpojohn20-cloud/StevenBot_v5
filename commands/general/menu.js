/**
 * Steven Bot — Menu Command
 * Exact format as requested
 */
const config = require('../../config');
const db     = require('../../database');
const { loadCommands } = require('../../utils/commandLoader');
const axios  = require('axios');

// Steven (Eminence in Steven) character images
const STEVEN_IMAGES = [
  'https://i.imgur.com/6yHmlEm.jpeg',
  'https://i.imgur.com/rGxUNnL.jpeg',
  'https://i.imgur.com/QZUMmJi.jpeg',
  'https://i.imgur.com/TwQKFRG.jpeg',
];

async function fetchImage() {
  for (const url of STEVEN_IMAGES) {
    try {
      const r = await axios.get(url, {
        responseType: 'arraybuffer', timeout: 7000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0' }
      });
      if (r.status === 200 && r.data?.byteLength > 3000) return Buffer.from(r.data);
    } catch {}
  }
  // Fallback to waifu.pics
  try {
    const r = await axios.get('https://api.waifu.pics/sfw/waifu', { timeout: 5000 });
    if (r.data?.url) {
      const img = await axios.get(r.data.url, { responseType: 'arraybuffer', timeout: 8000 });
      return Buffer.from(img.data);
    }
  } catch {}
  return null;
}

const COUNTRIES = [
  ['🇮🇳','india'],    ['🇲🇾','malaysia'],  ['🇹🇭','thailand'],
  ['🇨🇳','china'],    ['🇮🇩','indonesia'], ['🇯🇵','japan'],
  ['🇰🇷','korea'],    ['🇻🇳','vietnam'],
];

module.exports = {
  name: 'menu',
  aliases: ['cmds', 'start', 'commands'],
  category: 'general',
  description: 'Show all commands',

  async execute(sock, msg, args, extra) {
    const cmds    = loadCommands();
    const prefix  = db.getPrefix();
    const botName = db.getBotName();

    // Group by category, skip aliases
    const cats = {};
    cmds.forEach((cmd, k) => {
      if (cmd.name !== k) return;
      if (!cats[cmd.category]) cats[cmd.category] = [];
      cats[cmd.category].push(cmd.name);
    });

    const total  = [...cmds.keys()].filter(k => cmds.get(k).name === k).length;
    const uname  = extra.pushName || 'User';
    const now    = new Date();
    const timeStr = now.toLocaleString('en-GB', { hour:'2-digit', minute:'2-digit', day:'2-digit', month:'short' }).replace(',', ',');

    const order = ['general','ai','admin','owner','media','fun','utility','anime'];
    const ICONS = { general:'🌐', ai:'🤖', admin:'⚔️', owner:'🫒', media:'📥', fun:'🎲', utility:'🛠️', anime:'⛩️' };
    const NAMES = { general:'GENERAL', ai:'AI', admin:'ADMIN', owner:'STEVEN ONLY', media:'DOWNLOADER', fun:'FUN', utility:'TOOLS', anime:'ANIME' };

    // Build two-column layout for commands
    const twoCol = (arr) => {
      const sorted = arr.sort();
      let out = '';
      for (let i = 0; i < sorted.length; i += 2) {
        const a = sorted[i]   ? `${prefix}${sorted[i]}` : '';
        const b = sorted[i+1] ? `${prefix}${sorted[i+1]}` : '';
        out += `┃ ${a.padEnd(14)}${b}\n`;
      }
      return out;
    };

    let txt = `\`\`\`░░ ${botName} ░░\`\`\`\n\n`;
    txt += ` User  : ${uname}\n`;
    txt += ` Time  : ${timeStr}\n`;
    txt += ` Prefix: ${prefix}\n`;
    txt += ` Cmds  : ${total}\n`;
    txt += ` Owner : ${config.ownerName[0]}\n\n`;
    txt += `──────────────────────\n\n`;

    for (const cat of order) {
      if (!cats[cat]?.length) continue;
      txt += `${ICONS[cat]} *【 ${NAMES[cat]} 】*\n`;
      txt += twoCol(cats[cat]);
      txt += `┗━━━━━━━━━━━━━━━━\n\n`;
    }

    // Pies countries
    txt += `🌍 *${prefix}pies <country>* — Available countries:\n`;
    for (let i = 0; i < COUNTRIES.length; i += 3) {
      const row = COUNTRIES.slice(i, i+3).map(([f,n]) => `${f}${n}`).join('  ');
      txt += `┃ ${row}\n`;
    }
    txt += `\n──────────────────────\n\n`;
    txt += `💡 ${prefix}help <cmd>\n\n`;
    txt += `──────────────────────\n\n`;
    txt += `_"Even in the dark, Steven stands strongest."_\n\n`;
    txt += `✨ Created by 𝕊𝕥𝕖𝕧𝕖𝕟 (+201273323087)`;

    await extra.react('🫒');
    const img = await fetchImage();

    if (img) {
      await sock.sendMessage(extra.from, {
        image: img,
        caption: txt,
        mentions: [extra.sender]
      }, { quoted: msg });
    } else {
      await sock.sendMessage(extra.from, {
        text: txt,
        mentions: [extra.sender]
      }, { quoted: msg });
    }
  }
};
