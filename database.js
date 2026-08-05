const fs     = require('fs');
const path   = require('path');
const config = require('./config');

const DB_PATH = path.join(__dirname, 'database');
const GROUPS  = path.join(DB_PATH, 'groups.json');
const USERS   = path.join(DB_PATH, 'users.json');
const WARNS   = path.join(DB_PATH, 'warnings.json');
const SUDO    = path.join(DB_PATH, 'sudo.json');
const MARRY   = path.join(DB_PATH, 'marriages.json');
const BOT     = path.join(DB_PATH, 'bot.json');

fs.mkdirSync(DB_PATH, { recursive: true });
const init = (f,d) => { if(!fs.existsSync(f)) fs.writeFileSync(f,JSON.stringify(d,null,2)); };
init(GROUPS,{}); init(USERS,{}); init(WARNS,{}); init(SUDO,{numbers:[]});
init(MARRY,{}); init(BOT,{prefix:'.',botName:'𝕊𝕥𝕖𝕧𝕖𝕟 Bot',mode:'public',newsletter:''});

const read  = f => { try { return JSON.parse(fs.readFileSync(f,'utf8')); } catch { return {}; } };
const write = (f,d) => { try { fs.writeFileSync(f,JSON.stringify(d,null,2)); return true; } catch { return false; } };

// ── Number normalization — strips EVERYTHING, digits only ─────────────────────
const normalizeNum = jid => {
  if (!jid) return '';
  return String(jid)
    .replace('@s.whatsapp.net','')
    .replace(/@.*/,'')
    .replace(/:.*/,'')
    .replace(/\D/g,'')
    .trim();
};

// ── Owner check — compares pure digit strings ──────────────────────────────────
const isOwner = jid => {
  const num = normalizeNum(jid);
  if (!num) return false;
  const ownerNums = config.ownerNumber.map(o => normalizeNum(o));
  // Exact match OR one ends with the other (handles country code variations)
  return ownerNums.some(o => o === num || o.endsWith(num) || num.endsWith(o));
};

// ── Group ─────────────────────────────────────────────────────────────────────
const getGroupSettings = gid => {
  const g = read(GROUPS);
  if (!g[gid]) { g[gid] = { ...config.defaultGroupSettings }; write(GROUPS,g); }
  return g[gid];
};
const updateGroupSettings = (gid,s) => {
  const g = read(GROUPS); g[gid] = { ...g[gid], ...s }; return write(GROUPS,g);
};

// ── Users ─────────────────────────────────────────────────────────────────────
const getUser  = uid => { const u=read(USERS); if(!u[uid]){u[uid]={registered:Date.now(),cmds:0};write(USERS,u);} return u[uid]; };
const trackCmd = uid => { const u=read(USERS); if(!u[uid])u[uid]={registered:Date.now(),cmds:0}; u[uid].cmds=(u[uid].cmds||0)+1; u[uid].lastSeen=Date.now(); write(USERS,u); };

// ── Warnings ──────────────────────────────────────────────────────────────────
const getWarnings   = (gid,uid) => { const w=read(WARNS); return w[`${gid}_${uid}`]||{count:0,list:[]}; };
const addWarning    = (gid,uid,reason) => { const w=read(WARNS); const k=`${gid}_${uid}`; if(!w[k])w[k]={count:0,list:[]}; w[k].count++; w[k].list.push({reason,date:Date.now()}); write(WARNS,w); return w[k]; };
const clearWarnings = (gid,uid) => { const w=read(WARNS); delete w[`${gid}_${uid}`]; write(WARNS,w); };

// ── Sudo ──────────────────────────────────────────────────────────────────────
const getSudoList = () => { const s=read(SUDO); return [...new Set([...(s.numbers||[]),...(config.sudoNumbers||[])])]; };

// addSudo stores the FULL JID (e.g. "1234567890@s.whatsapp.net" or "87398809653333@lid")
// so that LID-based users are stored and matched correctly
const addSudo = (jidOrNum) => {
  const s = read(SUDO);
  if (!s.numbers) s.numbers = [];
  // Store as-is (could be phone number, @s.whatsapp.net JID, or @lid JID)
  const toStore = String(jidOrNum).trim();
  // Check if already stored (check both exact and digit match)
  const digits = toStore.replace(/\D/g, '');
  const alreadyExists = s.numbers.some(existing => {
    if (existing === toStore) return true;
    if (existing.replace(/\D/g,'') === digits && digits.length > 6) return true;
    return false;
  });
  if (alreadyExists) return false;
  s.numbers.push(toStore);
  return write(SUDO, s);
};

const removeSudo = (jidOrNum) => {
  const s = read(SUDO);
  if (!s.numbers) return false;
  const toRemove = String(jidOrNum).trim();
  const digits   = toRemove.replace(/\D/g,'');
  const before   = s.numbers.length;
  s.numbers = s.numbers.filter(existing => {
    if (existing === toRemove) return false;
    if (digits.length > 6 && existing.replace(/\D/g,'') === digits) return false;
    return true;
  });
  if (s.numbers.length === before) return false;
  return write(SUDO, s);
};

// isSudo checks: exact JID match, LID number match, or phone digits match
const isSudo = (jid) => {
  if (!jid) return false;
  const list    = getSudoList();
  const jidClean = String(jid).trim();
  const jidDigits = jidClean.replace(/\D/g,'');
  const jidBase   = jidClean.split(':')[0]; // strip :XX device suffix

  return list.some(stored => {
    const storedClean  = String(stored).trim();
    const storedDigits = storedClean.replace(/\D/g,'');
    const storedBase   = storedClean.split(':')[0];

    // Exact match
    if (jidBase === storedBase) return true;
    // Both contain @lid — compare numeric parts
    if (jidClean.includes('@lid') && storedClean.includes('@lid')) {
      return jidDigits === storedDigits;
    }
    // Phone number digits match (both must be 8+ digits to avoid false positives)
    if (jidDigits.length >= 8 && storedDigits.length >= 8) {
      if (jidDigits === storedDigits) return true;
      if (jidDigits.endsWith(storedDigits) || storedDigits.endsWith(jidDigits)) return true;
    }
    return false;
  });
};

// ── Marriages ─────────────────────────────────────────────────────────────────
const getMarriage    = num => { const m=read(MARRY); return m[num]||null; };
const setMarriage    = (n1,n2) => { const m=read(MARRY); m[n1]=n2; m[n2]=n1; return write(MARRY,m); };
const deleteMarriage = num => { const m=read(MARRY); const s=m[num]; if(s){delete m[num];delete m[s];} return write(MARRY,m); };
const getProposals   = () => { const m=read(MARRY); return m._proposals||{}; };
const setProposal    = (from,to) => { const m=read(MARRY); if(!m._proposals)m._proposals={}; m._proposals[`${from}→${to}`]=Date.now(); return write(MARRY,m); };
const clearProposal  = key => { const m=read(MARRY); if(m._proposals)delete m._proposals[key]; return write(MARRY,m); };

// ── Bot settings ──────────────────────────────────────────────────────────────
const getBotSetting = k   => { const b=read(BOT); return b[k]; };
const setBotSetting = (k,v) => { const b=read(BOT); b[k]=v; return write(BOT,b); };
const getPrefix     = () => getBotSetting('prefix') || config.prefix || '.';
const getBotName    = () => getBotSetting('botName') || config.botName || '𝕊𝕥𝕖𝕧𝕖𝕟 Bot';
const getMode       = () => getBotSetting('mode') || 'public';

// ── Banned Users (bot-level block) ──────────────────────────────────────────
const BANNED_FILE = path.join(DB_PATH, 'banned.json');
init(BANNED_FILE, []);
const getBanned  = () => read(BANNED_FILE) || [];
const banUser    = (num) => { const b=getBanned(); const clean=normalizeNum(num); if(!b.includes(clean)){b.push(clean);write(BANNED_FILE,b);return true;} return false; };
const unbanUser  = (num) => { let b=getBanned(); const clean=normalizeNum(num); const prev=b.length; b=b.filter(n=>n!==clean); write(BANNED_FILE,b); return b.length < prev; };
const isBanned   = (jid) => { const num=normalizeNum(jid); return getBanned().includes(num); };

module.exports = {
  normalizeNum, isOwner,
  getGroupSettings, updateGroupSettings,
  getUser, trackCmd,
  getWarnings, addWarning, clearWarnings,
  getSudoList, addSudo, removeSudo, isSudo,
  getMarriage, setMarriage, deleteMarriage, getProposals, setProposal, clearProposal,
  getBotSetting, setBotSetting, getPrefix, getBotName, getMode,
  getBanned, banUser, unbanUser, isBanned
};

// Moderator check (alias for sudo in our bot)
const isModerator = (numOrJid) => isSudo(numOrJid);
module.exports.isModerator = isModerator;
