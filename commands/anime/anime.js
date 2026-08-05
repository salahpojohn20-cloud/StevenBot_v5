// commands/anime/anime.js
const APIs = require('../../utils/api');

// SFW types — `loli` removed per project policy.
const SFW_TYPES  = ['waifu','neko','shinobu','bully','cuddle','cry','hug','awoo','kiss','lick','pat','smug','bonk','yeet','blush','smile','wave','nom','bite','happy','wink','poke','dance'];
// NSFW types — `milf` removed per project policy.
const NSFW_TYPES = ['waifu','neko','hentai','ecchi','feet','yuri','blowjob','ass'];

const anime = {
  name: 'anime', aliases: ['animg'], category: 'anime',
  description: `SFW anime image\nTypes: ${SFW_TYPES.join(', ')}`,
  async execute(sock, msg, args, extra) {
    const type = args[0]?.toLowerCase() || SFW_TYPES[Math.floor(Math.random() * SFW_TYPES.length)];
    if (!SFW_TYPES.includes(type)) return extra.reply(`❌ Unknown type.\n\nAvailable:\n${SFW_TYPES.join(', ')}`);
    await extra.react('🌸');
    try { const buf = await APIs.anime(type, false); await sock.sendMessage(extra.from, { image: buf, caption: `🌸 *${type}*` }, { quoted: msg }); }
    catch (e) { extra.reply('❌ ' + e.message); }
  }
};

const hanime = {
  name: 'hanime', aliases: ['nsfw', 'hentai', 'ecchi'], category: 'anime',
  description: `🔞 NSFW anime\nTypes: ${NSFW_TYPES.join(', ')}`,
  async execute(sock, msg, args, extra) {
    const type = args[0]?.toLowerCase() || NSFW_TYPES[Math.floor(Math.random() * NSFW_TYPES.length)];
    if (!NSFW_TYPES.includes(type)) return extra.reply(`❌ NSFW types:\n${NSFW_TYPES.join(', ')}`);
    await extra.react('🔞');
    try { const buf = await APIs.anime(type, true); await sock.sendMessage(extra.from, { image: buf, caption: `🔞 *${type}*` }, { quoted: msg }); }
    catch (e) { extra.reply('❌ ' + e.message); }
  }
};

// Individual SFW shortcuts
const waifu  = { name: 'waifu',  category: 'anime', description: 'Random waifu',  async execute(s,m,a,e) { await e.react('🌸'); try { const b=await APIs.anime('waifu',false);  await s.sendMessage(e.from,{image:b,caption:'🌸 *Waifu*'},{quoted:m}); } catch(err){e.reply('❌ '+err.message);} } };
const neko   = { name: 'neko',   category: 'anime', description: 'Random neko',   async execute(s,m,a,e) { await e.react('🐱'); try { const b=await APIs.anime('neko',false);   await s.sendMessage(e.from,{image:b,caption:'🐱 *Neko*'},{quoted:m}); } catch(err){e.reply('❌ '+err.message);} } };
const random = {
  name: 'random', aliases: ['animerandom'], category: 'anime', description: 'Random anime reaction',
  async execute(sock, msg, args, extra) {
    const t = SFW_TYPES[Math.floor(Math.random() * SFW_TYPES.length)];
    await extra.react('🎲');
    try { const buf = await APIs.anime(t, false); await sock.sendMessage(extra.from, { image: buf, caption: `🎲 *${t}*` }, { quoted: msg }); }
    catch (e) { extra.reply('❌ ' + e.message); }
  }
};

const hwaifu = { name: 'hwaifu', category: 'anime', description: '🔞 NSFW waifu', async execute(s,m,a,e) { await e.react('🔞'); try { const b=await APIs.anime('waifu',true);  await s.sendMessage(e.from,{image:b,caption:'🔞 *NSFW Waifu*'},{quoted:m}); } catch(err){e.reply('❌ '+err.message);} } };
const hneko  = { name: 'hneko',  category: 'anime', description: '🔞 NSFW neko',  async execute(s,m,a,e) { await e.react('🔞'); try { const b=await APIs.anime('neko',true);   await s.sendMessage(e.from,{image:b,caption:'🔞 *NSFW Neko*'},{quoted:m}); } catch(err){e.reply('❌ '+err.message);} } };

// `loli` and `milf` were intentionally REMOVED from this bot. Do not re-add.
module.exports = [anime, hanime, waifu, neko, random, hwaifu, hneko];
