// commands/media/media.js
const APIs   = require('../../utils/api');
const yts    = require('yt-search');
const axios  = require('axios');
const { execFile, exec } = require('child_process');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const ytdl   = require('@distube/ytdl-core');
const { igdl } = require('ruhend-scraper');

const sendVideo = async (sock, msg, extra, videoUrl, caption) => {
  try { const buf = await APIs.downloadBuffer(videoUrl); await sock.sendMessage(extra.from, { video: buf, mimetype: 'video/mp4', caption }, { quoted: msg }); }
  catch { await sock.sendMessage(extra.from, { video: { url: videoUrl }, mimetype: 'video/mp4', caption }, { quoted: msg }); }
};

const tiktok = {
  name: 'tiktok', aliases: ['tt', 'ttdl'], category: 'media', description: 'Download TikTok video (no watermark)',
  async execute(sock, msg, args, extra) {
    const url = args.join(' ').trim();
    if (!url || (!url.includes('tiktok.com') && !url.includes('vm.tiktok'))) return extra.reply('❌ Usage: .tiktok <TikTok URL>');
    await extra.react('🔄');
    try { const d = await APIs.tiktokDownload(url); await sendVideo(sock, msg, extra, d.videoUrl, `🎵 *TikTok*\n👤 ${d.author || 'Unknown'}\n📝 ${(d.title || '').slice(0, 80)}`); }
    catch (e) { extra.reply('❌ TikTok failed: ' + e.message); }
  }
};

// ── Instagram URL validation (adapted from reference bot) ──────────────────
const IG_PATTERNS = [
  /https?:\/\/(?:www\.)?instagram\.com\//,
  /https?:\/\/(?:www\.)?instagr\.am\//,
];
const isValidIgUrl = (u) => IG_PATTERNS.some(p => p.test(u));

// Deduplicate by exact URL (adapted from reference bot)
const dedupeMedia = (items) => {
  const seen = new Set();
  return items.filter(i => { if (!i?.url || seen.has(i.url)) return false; seen.add(i.url); return true; });
};

const instagram = {
  name: 'instagram', aliases: ['ig', 'insta', 'reels', 'igdl'], category: 'media', description: 'Download Instagram post/reel',
  async execute(sock, msg, args, extra) {
    const url = args.join(' ').trim();
    if (!url || !isValidIgUrl(url)) return extra.reply('❌ Usage: .instagram <Instagram URL>\nExample: .instagram https://www.instagram.com/reel/xxxxx');
    await extra.react('📥');
    try {
      // Use ruhend-scraper igdl — works on most hosts without cookies
      const downloadData = await igdl(url);
      if (!downloadData?.data?.length) {
        return extra.reply('❌ No media found. The post may be private or the link is invalid.');
      }

      // Deduplicate by exact URL
      const seen = new Set();
      const items = downloadData.data.filter(m => {
        if (!m?.url || seen.has(m.url)) return false;
        seen.add(m.url); return true;
      }).slice(0, 20);

      if (!items.length) return extra.reply('❌ No valid media found.');

      const total = items.length;
      for (let i = 0; i < total; i++) {
        const item = items[i];
        try {
          const isVideo = /\.(mp4|mov|avi|mkv|webm)/i.test(item.url)
            || item.type === 'video'
            || url.includes('/reel/')
            || url.includes('/tv/');

          const cap = `📸 *Instagram* ${total > 1 ? `(${i + 1}/${total})` : ''}`.trim();

          if (isVideo) {
            await sock.sendMessage(extra.from, { video: { url: item.url }, mimetype: 'video/mp4', caption: cap }, { quoted: msg });
          } else {
            await sock.sendMessage(extra.from, { image: { url: item.url }, caption: cap }, { quoted: msg });
          }

          if (i < total - 1) await new Promise(r => setTimeout(r, 1000));
        } catch (itemErr) {
          console.error(`Instagram item ${i + 1} failed:`, itemErr.message);
        }
      }
    } catch (e) {
      console.error('Instagram command error:', e);
      extra.reply('❌ Instagram failed: ' + (e.message || 'unknown error'));
    }
  }
};

const igs = {
  name: 'igs', aliases: ['igstory', 'igsc'], category: 'media', description: 'Download Instagram story',
  async execute(sock, msg, args, extra) {
    const url = args.join(' ').trim();
    if (!url || !url.includes('instagram.com')) return extra.reply('❌ Usage: .igs <Instagram story URL>');
    await extra.react('📥');
    try {
      const items = await APIs.instagramDownload(url);
      if (!items?.length) return extra.reply('❌ No media found.');
      const item = items[0]; const buf = item._buf || await APIs.downloadBuffer(item.url);
      if (item.type === 'video') { await sock.sendMessage(extra.from, { video: buf, mimetype: 'video/mp4', fileLength: buf.length, caption: '📱 *Instagram Story*' }, { quoted: msg }); }
      else                       { await sock.sendMessage(extra.from, { image: buf, caption: '📱 *Instagram Story*' }, { quoted: msg }); }
    } catch (e) { extra.reply('❌ ' + e.message); }
  }
};

const facebook = {
  name: 'facebook', aliases: ['fb', 'fbdl'], category: 'media', description: 'Download Facebook video',
  async execute(sock, msg, args, extra) {
    const url = args.join(' ').trim();
    if (!url || (!url.includes('facebook.com') && !url.includes('fb.watch') && !url.includes('fb.com')))
      return extra.reply('❌ Usage: .facebook <Facebook video URL>');
    await extra.react('🔄');
    try { const d = await APIs.facebookDownload(url); await sendVideo(sock, msg, extra, d.videoUrl, '📘 *Facebook Video*'); }
    catch (e) { extra.reply('❌ Facebook failed: ' + e.message); }
  }
};

const twitter = {
  name: 'twitter', aliases: ['tw', 'x', 'twdl'], category: 'media', description: 'Download Twitter/X video',
  async execute(sock, msg, args, extra) {
    const url = args.join(' ').trim();
    if (!url || (!url.includes('twitter.com') && !url.includes('x.com') && !url.includes('t.co')))
      return extra.reply('❌ Usage: .twitter <Twitter/X URL>');
    await extra.react('🔄');
    try { const d = await APIs.twitterDownload(url); await sendVideo(sock, msg, extra, d.videoUrl, `🐦 *Twitter/X*\n📝 ${(d.title || '').slice(0, 80)}`); }
    catch (e) { extra.reply('❌ Twitter failed: ' + e.message); }
  }
};

const song = {
  name: 'song', aliases: ['play', 'music', 'mp3', 'yta'], category: 'media', description: 'Download audio from YouTube',
  async execute(sock, msg, args, extra) {
    const text = args.join(' ').trim();
    if (!text) return extra.reply('❌ Usage: .song <song name or YouTube URL>');
    await extra.react('🎵');

    try {
      // ── Step 1: Resolve YouTube URL + metadata ─────────────────────────
      let url = text;
      let title = text;
      let thumb = '';
      let duration = '';

      const isYtUrl = text.includes('youtube.com') || text.includes('youtu.be');
      if (!isYtUrl) {
        const res = await yts(text);
        if (!res?.videos?.length) return extra.reply('❌ No results found.');
        const vid = res.videos[0];
        url = vid.url;
        title = vid.title;
        thumb = vid.thumbnail;
        duration = vid.timestamp || '';
      }

      // ── Step 2: Send thumbnail preview ────────────────────────────────
      if (thumb) {
        try {
          const r = await axios.get(thumb, { responseType: 'arraybuffer', timeout: 8000 });
          await sock.sendMessage(extra.from, {
            image: Buffer.from(r.data),
            caption: `🎵 *${title}*\n⏱ Duration: ${duration}\n⬇️ Downloading audio...`
          }, { quoted: msg });
        } catch (e) {
          console.log("Thumb failed, continuing...");
        }
      }

      // ── Step 3: Download via your Internal API Chain ──────────────────
      // This uses the methods from the other bot adapted to your APIs utility
      let audioBuffer = null;
      let downloadSuccess = false;

      const methods = [
        async () => await APIs.getEliteProTechDownloadByUrl(url),
        async () => await APIs.getYupraDownloadByUrl(url),
        async () => await APIs.getOkatsuDownloadByUrl(url),
        async () => await APIs.getIzumiDownloadByUrl(url)
      ];

      for (const method of methods) {
        try {
          const data = await method();
          const dlUrl = data?.download || data?.dl || data?.url;
          if (!dlUrl) continue;

          const res = await axios.get(dlUrl, {
            responseType: 'arraybuffer',
            timeout: 90000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
          });

          if (res.data && res.data.byteLength > 10000) {
            audioBuffer = Buffer.from(res.data);
            downloadSuccess = true;
            break;
          }
        } catch (e) {
          console.error(`Method failed: ${e.message}`);
        }
      }

      if (!downloadSuccess || !audioBuffer) {
        return extra.reply('❌ All download sources failed. Please try a different song or link.');
      }

      // ── Step 4: Format Detection & Conversion ─────────────────────────
      const { toAudio } = require('../../utils/converter');
      const head = audioBuffer.slice(0, 12);
      let ext = 'mp3';
      
      // Basic check for M4A/MP4
      if (head.toString('ascii', 4, 8) === 'ftyp') ext = 'm4a';
      else if (head.toString('ascii', 0, 4) === 'OggS') ext = 'ogg';

      let finalBuffer = audioBuffer;
      if (ext !== 'mp3') {
        try {
          finalBuffer = await toAudio(audioBuffer, ext);
        } catch (convErr) {
          console.error("Conversion failed, sending original buffer:", convErr.message);
        }
      }

      // ── Step 5: Send Final Audio ─────────────────────────────────────
      const safeTitle = title.replace(/[^\w\s-]/g, '').slice(0, 50) || 'audio';
      await sock.sendMessage(extra.from, {
        audio: finalBuffer,
        mimetype: 'audio/mpeg',
        ptt: false,
        fileName: `${safeTitle}.mp3`
      }, { quoted: msg });

      await extra.react('✅');

    } catch (e) {
      console.error('Song command error:', e);
      extra.reply('❌ Error: ' + (e.message || 'Unknown error occurred.'));
    }
  }
};
const pinterest = {
  name: 'pinterest', aliases: ['pin'], category: 'media', description: 'Download Pinterest image/video',
  async execute(sock, msg, args, extra) {
    const url = args.join(' ').trim();
    if (!url) return extra.reply('❌ Usage: .pinterest <Pinterest URL>\nExample: .pinterest https://pin.it/xxxxx');
    if (!url.includes('pinterest') && !url.includes('pin.it')) return extra.reply('❌ Please provide a valid Pinterest URL.');
    await extra.react('📥');
    try {
      const d = await APIs.pinterestDownload(url);
      const buf = await APIs.downloadBuffer(d.url);
      if (d.type === 'video') { await sock.sendMessage(extra.from, { video: buf, mimetype: 'video/mp4', caption: '📌 *Pinterest Video*' }, { quoted: msg }); }
      else                    { await sock.sendMessage(extra.from, { image: buf, caption: '📌 *Pinterest Image*' }, { quoted: msg }); }
    } catch (e) { extra.reply('❌ Pinterest failed: ' + e.message); }
  }
};

const lyrics = {
  name: 'lyrics', aliases: ['lyric'], category: 'media', description: 'Get song lyrics\nUsage: .lyrics <song> - <artist>',
  async execute(sock, msg, args, extra) {
    const text = args.join(' '); if (!text) return extra.reply('❌ Usage: .lyrics <song name> - <artist>');
    await extra.reply('🎵 Searching lyrics...');
    const parts    = text.includes(' - ') ? text.split(' - ') : text.split(' by ');
    const songName = parts[0]?.trim();
    const artist   = parts[1]?.trim() || '';
    try {
      const lyr     = await APIs.lyrics(songName, artist);
      const trimmed = lyr.length > 3500 ? lyr.slice(0, 3500) + '\n\n..._(truncated)_' : lyr;
      extra.reply(`🎵 *${songName}*${artist ? ` — ${artist}` : ''}\n\n${trimmed}`);
    } catch { extra.reply('❌ Lyrics not found.\nTips:\n▸ .lyrics Shape of You - Ed Sheeran\n▸ .lyrics Blinding Lights - The Weeknd'); }
  }
};

module.exports = [tiktok, instagram, igs, facebook, twitter, song, pinterest, lyrics];
