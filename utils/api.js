/**
 * Steven Bot — API Utilities
 */
const axios = require('axios');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const UA_D = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36';
const UA_M = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';

const api = axios.create({ timeout: 60000, headers: { 'User-Agent': UA_D } });

// ── Optional cookies.txt support for yt-dlp ─────────────────────────────────
// If a Netscape-format cookies.txt file exists at bot/cookies.txt, yt-dlp
// will use it. This is REQUIRED for Instagram from cloud server IPs (and
// helpful for age-restricted YouTube songs). To create one: install the
// "Get cookies.txt LOCALLY" browser extension, log into instagram.com /
// youtube.com, export cookies, save the file at bot/cookies.txt.
const COOKIES_PATH = path.join(__dirname, '..', 'cookies.txt');
const cookiesArgs = () => fs.existsSync(COOKIES_PATH) ? ['--cookies', COOKIES_PATH] : [];
const hasCookies = () => fs.existsSync(COOKIES_PATH);

const tryWith = async (fns) => {
  let last;
  for (const fn of fns) { try { return await fn(); } catch (e) { last = e; } }
  throw last;
};

module.exports = {

  // ── AI Chat ──────────────────────────────────────────────────────────────
  chatAI: async (text) => tryWith([
    async () => { const r = await api.get(`https://api.siputzx.my.id/api/ai/chatgpt?text=${encodeURIComponent(text)}`, { timeout: 15000 }); if (r.data?.data) return r.data.data; throw new Error('no data'); },
    async () => { const r = await api.get(`https://api.ryzendesu.vip/api/ai/chatgpt?text=${encodeURIComponent(text)}`, { timeout: 15000 }); if (r.data?.response || r.data?.data) return r.data.response || r.data.data; throw new Error('no response'); }
  ]),

  // ── Image generation ─────────────────────────────────────────────────────
  generateImage: async (prompt) => tryWith([
    async () => {
      const seed = Math.floor(Math.random() * 99999);
      const r = await axios.get(`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=512&height=512&seed=${seed}&nologo=true`, { responseType: 'arraybuffer', timeout: 40000, headers: { 'User-Agent': UA_M } });
      const buf = Buffer.from(r.data); if (buf.length < 5000) throw new Error('too small'); return buf;
    }
  ]),

  // ── TikTok ───────────────────────────────────────────────────────────────
  tiktokDownload: async (url) => tryWith([
    async () => {
      const r = await api.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`, { timeout: 20000 });
      const d = r.data?.data; if (!d?.play) throw new Error('no play');
      return { videoUrl: d.play, hdUrl: d.hdplay || d.play, title: d.title || 'TikTok', author: d.author?.nickname || '' };
    },
    async () => {
      const r = await api.get(`https://api.ryzendesu.vip/api/downloader/tiktok?url=${encodeURIComponent(url)}`, { timeout: 20000 });
      const v = r.data?.video || r.data?.data?.url; if (!v) throw new Error('no url');
      return { videoUrl: v, title: 'TikTok', author: '' };
    }
  ]),

  // ── Instagram ─────────────────────────────────────────────────────────────
  // Strategy: scrape Instagram's own embed page (no auth required for public posts).
  // The embed page embeds the video directly in HTML and exposes the media URL
  // in a JSON blob. We also buffer the video ourselves with the correct IG CDN
  // headers so Baileys never fetches the URL without them (which caused corruption).
  instagramDownload: async (url) => {
    const IG_CDN_HEADERS = {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
      'Referer': 'https://www.instagram.com/',
      'Accept': 'video/mp4,video/*;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'identity',
      // 'Range': 'bytes=0-' removed — causes partial/corrupted buffers
    };

    // ── Helper: buffer a CDN URL with IG headers ──────────────────────────
    const bufferIgMedia = async (mediaUrl) => {
      const r = await axios({
        method: 'GET',
        url: mediaUrl,
        responseType: 'arraybuffer',
        headers: {
          'User-Agent': UA_M,
          'Referer': 'https://www.instagram.com/',
        },
        timeout: 60000,
        maxRedirects: 5
      });

      const buf = Buffer.from(r.data);

      if (!buf || buf.length < 5000) {
        throw new Error('Invalid or incomplete video buffer');
      }

      return buf;
    };

    // ── Helper: extract shortcode from any IG URL format ──────────────────
    const getShortcode = (u) => {
      const m = u.match(/\/(?:p|reel|tv|reels)\/([A-Za-z0-9_-]+)/);
      return m ? m[1] : null;
    };

    const shortcode = getShortcode(url);

    // ── Source 0: cobalt.tools API v10 (updated endpoint format) ─────────
    // Cobalt v10 changed from POST /api/json to POST / with new Accept header.
    // Multiple public instances tried in order.
    const tryCobalt = async () => {
      const COBALT_INSTANCES = [
        'https://api.cobalt.tools/',
        'https://cobalt.api.timelessnesses.me/',
        'https://co.wuk.sh/',
      ];
      let lastErr;
      for (const endpoint of COBALT_INSTANCES) {
        try {
          const r = await axios.post(endpoint, { url, videoQuality: '720', filenameStyle: 'pretty' }, {
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'User-Agent': UA_D,
            },
            timeout: 30000,
          });
          const d = r.data;
          if (!d || d.status === 'error') throw new Error('cobalt: ' + (d?.error?.code || d?.text || 'error'));

          // Single media (stream/redirect/tunnel)
          if (d.url && ['stream', 'redirect', 'tunnel'].includes(d.status)) {
            const buf = await bufferIgMedia(d.url);
            const isVid = /\.(mp4|mov|webm)/i.test(d.url) || /\/api\/stream/i.test(d.url);
            return [{ url: d.url, type: isVid ? 'video' : 'image', _buf: buf }];
          }

          // Carousel / picker
          if (Array.isArray(d.picker) && d.picker.length) {
            const results = [];
            for (const item of d.picker.slice(0, 20)) {
              if (!item.url) continue;
              try {
                const buf = await bufferIgMedia(item.url);
                results.push({
                  url: item.url,
                  type: item.type === 'photo' ? 'image' : 'video',
                  _buf: buf,
                });
              } catch {}
            }
            if (results.length) return results;
            throw new Error('cobalt: picker had no downloadable items');
          }
          throw new Error('cobalt: unexpected response shape');
        } catch (e) { lastErr = e; }
      }
      throw lastErr || new Error('cobalt: all instances failed');
    };

    // ── Source 0b: instavideosave.com scraper ─────────────────────────────
    const tryInstavideosave = async () => {
      const r = await axios.post(
        'https://instavideosave.net/',
        new URLSearchParams({ url }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': UA_D,
            'Origin': 'https://instavideosave.net',
            'Referer': 'https://instavideosave.net/',
          },
          timeout: 25000,
        }
      );
      const html = typeof r.data === 'string' ? r.data : '';
      const mp4s = [...html.matchAll(/href=["'](https?:\/\/[^"']+\.mp4[^"']*)[^"']*["']/gi)].map(m => m[1].replace(/&amp;/g, '&'));
      if (!mp4s.length) throw new Error('instavideosave: no mp4');
      const buf = await bufferIgMedia(mp4s[0]);
      return [{ url: mp4s[0], type: 'video', _buf: buf }];
    };

    // ── Source 0c: saveig.app API ─────────────────────────────────────────
    const trySaveig = async () => {
      const r = await axios.get(
        `https://saveig.app/api?url=${encodeURIComponent(url)}`,
        {
          headers: { 'User-Agent': UA_D, Accept: 'application/json' },
          timeout: 20000,
        }
      );
      const items = r.data?.data || r.data?.medias || [];
      if (!items.length) throw new Error('saveig: no items');
      const results = [];
      for (const item of items.slice(0, 20)) {
        const mediaUrl = item.url || item.download_url;
        if (!mediaUrl) continue;
        try {
          const buf = await bufferIgMedia(mediaUrl);
          const isVid = item.type === 'video' || /\.mp4/i.test(mediaUrl);
          results.push({ url: mediaUrl, type: isVid ? 'video' : 'image', _buf: buf });
        } catch {}
      }
      if (!results.length) throw new Error('saveig: all downloads failed');
      return results;
    };

    // ── Source 0d: igdl.app public API ───────────────────────────────────
    const tryIgdl = async () => {
      const r = await axios.post(
        'https://v3.igdl.app/',
        new URLSearchParams({ q: url }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': UA_D,
            'Origin': 'https://igdl.app',
            'Referer': 'https://igdl.app/',
          },
          timeout: 25000,
        }
      );
      const data = r.data;
      const items = Array.isArray(data) ? data : (data?.data || data?.result || []);
      if (!items.length) throw new Error('igdl: no items');
      const results = [];
      for (const item of items.slice(0, 20)) {
        const mediaUrl = item.url || item.download;
        if (!mediaUrl) continue;
        try {
          const buf = await bufferIgMedia(mediaUrl);
          const isVid = item.type === 'mp4' || item.type === 'video' || /\.mp4/i.test(mediaUrl);
          results.push({ url: mediaUrl, type: isVid ? 'video' : 'image', _buf: buf });
        } catch {}
      }
      if (!results.length) throw new Error('igdl: all downloads failed');
      return results;
    };

    // ── Source 0e: Instagram oEmbed + direct CDN URL extraction ──────────
    const tryIgramApi = async () => {
      // igram.world is a reliable public IG downloader with a clean API
      const r = await axios.get(
        `https://igram.world/api/convert?url=${encodeURIComponent(url)}`,
        {
          headers: { 'User-Agent': UA_D, Accept: 'application/json', Referer: 'https://igram.world/' },
          timeout: 20000,
        }
      );
      const items = r.data?.items || r.data?.data || r.data?.result || [];
      if (!items.length) throw new Error('igram: no items');
      const results = [];
      for (const item of items.slice(0, 20)) {
        const mediaUrl = item.url || item.src;
        if (!mediaUrl) continue;
        try {
          const buf = await bufferIgMedia(mediaUrl);
          const isVid = item.type === 'video' || /\.mp4/i.test(mediaUrl);
          results.push({ url: mediaUrl, type: isVid ? 'video' : 'image', _buf: buf });
        } catch {}
      }
      if (!results.length) throw new Error('igram: all downloads failed');
      return results;
    };

    // ── Source A: snapinsta.app (public scraper API, works for public posts) ──
    const trySnapinsta = async () => {
      const r = await axios.post(
        'https://snapinsta.app/api/ajaxSearch',
        new URLSearchParams({ q: url, t: 'media', lang: 'en' }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'User-Agent': UA_D,
            'Accept': '*/*',
            'Origin': 'https://snapinsta.app',
            'Referer': 'https://snapinsta.app/',
            'X-Requested-With': 'XMLHttpRequest',
          },
          timeout: 30000,
        }
      );
      const html = r.data?.data || r.data || '';
      if (typeof html !== 'string') throw new Error('snapinsta: bad response');

      // Extract download links — snapinsta wraps direct CDN URLs in href="..." or data-href="..."
      const mediaUrls = new Set();
      const linkRe = /(?:href|data-href|src)=["'](https?:\/\/[^"']+(?:\.mp4|\.jpg|\.jpeg|cdninstagram|fbcdn)[^"']*)["']/gi;
      let m;
      while ((m = linkRe.exec(html)) !== null) {
        const u = m[1].replace(/&amp;/g, '&');
        if (u.includes('cdninstagram') || u.includes('fbcdn') || /\.(mp4|jpg|jpeg)/i.test(u)) {
          mediaUrls.add(u);
        }
      }
      if (!mediaUrls.size) throw new Error('snapinsta: no media links');

      const results = [];
      for (const u of [...mediaUrls].slice(0, 20)) {
        try {
          const buf = await bufferIgMedia(u);
          const isVid = /\.mp4/i.test(u);
          results.push({ url: u, type: isVid ? 'video' : 'image', _buf: buf });
        } catch {}
      }
      if (!results.length) throw new Error('snapinsta: all downloads failed');
      return results;
    };

    // ── Source 1: Instagram Embed Page (most reliable, no auth needed) ────
    // Instagram's embed page for any public post/reel loads the media JSON
    // in a <script> tag as window.__additionalDataLoaded or as a JSON blob.
    const tryEmbed = async () => {
      if (!shortcode) throw new Error('embed: no shortcode');
      const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
      const r = await axios.get(embedUrl, {
        headers: {
          'User-Agent': UA_M,
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://www.instagram.com/',
        },
        timeout: 25000,
        maxRedirects: 5,
      });
      const html = r.data || '';

      // Pattern 1: __additionalDataLoaded JSON blob
      let videoUrl = null;
      let imageUrl = null;
      const jsonMatch = html.match(/window\.__additionalDataLoaded\s*\(\s*[^,]+,\s*(\{.+?\})\s*\)/s)
                     || html.match(/window\.__additionalDataLoaded\('[^']+',(\{.+?\})\)/s);
      if (jsonMatch) {
        try {
          const data = JSON.parse(jsonMatch[1]);
          const item = data?.items?.[0] || data?.graphql?.shortcode_media || data;
          videoUrl = item?.video_url;
          imageUrl = item?.display_url || item?.display_resources?.slice(-1)?.[0]?.src;
          // carousels
          if (!videoUrl && item?.edge_sidecar_to_children?.edges?.length) {
            const edges = item.edge_sidecar_to_children.edges;
            const results = [];
            for (const e of edges) {
              const n = e.node;
              results.push({ url: n.video_url || n.display_url, type: n.is_video ? 'video' : 'image', _raw: n.video_url || n.display_url });
            }
            if (results.length) return results;
          }
        } catch {}
      }

      // Pattern 2: direct mp4 in og:video or video src tag
      if (!videoUrl) {
        const ogVideo = html.match(/<meta[^>]+property="og:video(?::url)?"[^>]+content="([^"]+)"/i)
                     || html.match(/property="og:video"[^>]*content="([^"]+)"/i);
        if (ogVideo) videoUrl = ogVideo[1].replace(/&amp;/g, '&');
      }

      // Pattern 3: video src directly in HTML
      if (!videoUrl) {
        const vsrc = html.match(/<video[^>]+src="(https?:\/\/[^"]+\.mp4[^"]*)"/i);
        if (vsrc) videoUrl = vsrc[1].replace(/&amp;/g, '&');
      }

      // Pattern 4: og:image for photo posts
      if (!imageUrl && !videoUrl) {
        const ogImg = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i);
        if (ogImg) imageUrl = ogImg[1].replace(/&amp;/g, '&');
      }

      if (videoUrl) return [{ url: videoUrl, type: 'video', _buf: await bufferIgMedia(videoUrl) }];
      if (imageUrl) return [{ url: imageUrl, type: 'image', _buf: await bufferIgMedia(imageUrl) }];
      throw new Error('embed: no media found in page');
    };

    // ── Source 2: Instagram GraphQL oEmbed → embed page combo ────────────
    const tryOembed = async () => {
      if (!shortcode) throw new Error('oembed: no shortcode');
      // oEmbed gives us thumbnail + author. Then use embed page with exact URL.
      const r = await axios.get(
        `https://www.instagram.com/api/v1/oembed/?url=${encodeURIComponent(url)}&format=json`,
        { headers: { 'User-Agent': UA_M, Accept: 'application/json' }, timeout: 15000 }
      );
      const thumb = r.data?.thumbnail_url;
      if (!thumb) throw new Error('oembed: no thumbnail');
      // oEmbed only gives thumbnail for videos (it IS the video frame)
      // For photos this is the actual image — buffer it with IG headers
      const buf = await bufferIgMedia(thumb);
      return [{ url: thumb, type: 'image', _buf: buf }];
    };

    // ── Source 3: ddinstagram.com redirect trick ──────────────────────────
    // Prepending "dd" to instagram.com gives direct media links on dumpor-style proxy
    const tryDdInstagram = async () => {
      const proxyUrl = url.replace('www.instagram.com', 'www.ddinstagram.com')
                          .replace('instagram.com', 'ddinstagram.com');
      const r = await axios.get(proxyUrl, {
        headers: { 'User-Agent': UA_D, Accept: 'text/html', Referer: 'https://ddinstagram.com/' },
        timeout: 20000,
        maxRedirects: 10,
      });
      const html = r.data || '';
      const mp4s = [...html.matchAll(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/gi)].map(m => m[0].replace(/&amp;/g, '&'));
      const imgs = [...html.matchAll(/https?:\/\/[^\s"'<>]*cdninstagram[^\s"'<>]*\.jpg[^\s"'<>]*/gi)].map(m => m[0].replace(/&amp;/g, '&'));
      if (!mp4s.length && !imgs.length) throw new Error('ddinstagram: no media');
      const results = [];
      for (const u of mp4s) {
        try { const buf = await bufferIgMedia(u); results.push({ url: u, type: 'video', _buf: buf }); } catch {}
      }
      for (const u of imgs) {
        try { const buf = await bufferIgMedia(u); results.push({ url: u, type: 'image', _buf: buf }); } catch {}
      }
      if (!results.length) throw new Error('ddinstagram: all downloads failed');
      return results;
    };

    // ── Source 4: imginn.com public scraper ───────────────────────────────
    const tryImginn = async () => {
      if (!shortcode) throw new Error('imginn: no shortcode');
      const r = await axios.get(`https://imginn.com/p/${shortcode}/`, {
        headers: { 'User-Agent': UA_D, Accept: 'text/html', Referer: 'https://imginn.com/' },
        timeout: 20000,
      });
      const html = r.data || '';
      const mp4s = [...html.matchAll(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/gi)].map(m => m[0].replace(/&amp;/g, '&'));
      const results = [];
      for (const u of mp4s.slice(0, 5)) {
        try { const buf = await bufferIgMedia(u); results.push({ url: u, type: 'video', _buf: buf }); break; } catch {}
      }
      if (!results.length) throw new Error('imginn: no video or download failed');
      return results;
    };

    // ── Source 0: yt-dlp (PRIMARY — only reliable method from cloud IPs) ─
    // Instagram blocks server IPs aggressively. yt-dlp + a cookies.txt file
    // exported from a logged-in browser is the only consistently working
    // approach. Without cookies, expect this (and every fallback) to fail.
    const tryYtDlpIg = async () => {
      const tmpId = `ig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const outDir = os.tmpdir();
      // Use playlist_index for carousels; %(autonumber)s as backup for non-playlist
      const outTpl = path.join(outDir, `${tmpId}_%(autonumber)s.%(ext)s`);

      await new Promise((resolve, reject) => {
        const args = [
          url,
          '-o', outTpl,
          '--no-warnings',
          '--quiet',
          '--no-check-certificates',
          '--no-part',
          '--retries', '3',
          '--socket-timeout', '20',
          ...cookiesArgs(),
        ];
        execFile(process.env.YTDLP_PATH || 'yt-dlp', args,
          { timeout: 120000, maxBuffer: 10 * 1024 * 1024 },
          (err, _stdout, stderr) => {
            if (err) {
              const reason = (stderr || err.message || '').slice(0, 300);
              return reject(new Error('yt-dlp ig: ' + reason));
            }
            resolve();
          }
        );
      });

      const produced = fs.readdirSync(outDir)
        .filter(f => f.startsWith(tmpId))
        .sort();
      if (!produced.length) throw new Error('yt-dlp ig: no output files');

      const results = [];
      for (const f of produced.slice(0, 20)) {
        const fp = path.join(outDir, f);
        try {
          const buf = fs.readFileSync(fp);
          fs.unlinkSync(fp);
          if (buf.length < 5000) continue;
          const ext = (f.split('.').pop() || '').toLowerCase();
          const isVid = ['mp4', 'mov', 'webm', 'mkv'].includes(ext);
          results.push({
            url: `local://${f}`,
            type: isVid ? 'video' : 'image',
            _buf: buf,
          });
        } catch {}
      }
      if (!results.length) throw new Error('yt-dlp ig: all files unreadable');
      return results;
    };

    // ── Run chain ─────────────────────────────────────────────────────────
    // Order: yt-dlp (with cookies) first — the only reliable path. Then a
    // few public scrapers as opportunistic fallbacks (most often blocked
    // for cloud IPs but kept for the rare case they work).
    // Removed: cobalt (now requires JWT auth), oembed (returns "no media").
    let chainErr;
    for (const fn of [tryYtDlpIg, tryIgdl, tryIgramApi, trySaveig, tryInstavideosave, trySnapinsta, tryDdInstagram, tryImginn]) {
      try {
        const result = await fn();
        if (result?.length) return result;
      } catch (e) { chainErr = e; }
    }
    const cookieHint = hasCookies()
      ? '\n\nYour cookies.txt may be expired — re-export from a logged-in browser.'
      : '\n\n💡 To enable Instagram downloads from this server, export cookies.txt from a logged-in instagram.com session and place it at: bot/cookies.txt\n(Use the "Get cookies.txt LOCALLY" browser extension.)';
    throw new Error('All Instagram download sources failed. Server IPs are blocked by Instagram.' +
      cookieHint +
      (chainErr ? `\n\nLast error: ${chainErr.message.slice(0, 200)}` : ''));
  },

  // ── Facebook ──────────────────────────────────────────────────────────────
  facebookDownload: async (url) => tryWith([
    async () => {
      const r = await axios.post('https://fdown.net/download.php', `URLz=${encodeURIComponent(url)}`,
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA_D, Referer: 'https://fdown.net/' }, timeout: 25000 }
      );
      const html = typeof r.data === 'string' ? r.data : '';
      const m = html.match(/href="(https?:\/\/[^"]+\.mp4[^"]*)"/i) || html.match(/href="(https?:\/\/video\.fbcdn\.net[^"]+)"/i);
      if (!m) throw new Error('fdown: no mp4 url');
      return { videoUrl: m[1].replace(/&amp;/g, '&') };
    },
    async () => {
      const r = await axios.post('https://api.cobalt.tools/', JSON.stringify({ url, downloadMode: 'auto' }), {
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, timeout: 25000
      });
      const v = r.data?.url; if (!v) throw new Error('cobalt: no url');
      return { videoUrl: v };
    },
    async () => {
      const r = await axios.get(`https://api.siputzx.my.id/api/d/fb?url=${encodeURIComponent(url)}`, { timeout: 20000 });
      const d = r.data?.data; const v = d?.sd || d?.hd || d?.url; if (!v) throw new Error('siputzx: no url');
      return { videoUrl: v };
    }
  ]),

  // ── Twitter / X ───────────────────────────────────────────────────────────
  twitterDownload: async (url) => tryWith([
    async () => {
      const vxUrl = url.replace('twitter.com', 'api.vxtwitter.com').replace('x.com', 'api.vxtwitter.com');
      const r = await axios.get(vxUrl, { headers: { 'User-Agent': UA_D, Accept: 'application/json' }, timeout: 15000 });
      const v = r.data?.mediaURLs?.[0] || r.data?.media_extended?.[0]?.url; if (!v) throw new Error('vxtwitter: no url');
      return { videoUrl: v, title: r.data?.text?.slice(0, 80) || 'Twitter/X' };
    },
    async () => {
      const r = await axios.get(`https://api.ryzendesu.vip/api/downloader/twitter?url=${encodeURIComponent(url)}`, { timeout: 20000 });
      const v = r.data?.url || r.data?.data?.url || r.data?.hd; if (!v) throw new Error('ryzendesu: no url');
      return { videoUrl: v, title: 'Twitter/X' };
    }
  ]),


  // ── Screenshot ───────────────────────────────────────────────────────────
  // Free, no-key providers ONLY. screenshotmachine demokey was removed —
  // it was returning "invalid key" errors. Order: thum.io → WordPress mShots
  // → s-shot.ru. All three are public, free, no API key needed.
  screenshot: async (url) => {
    const cleanUrl = url.startsWith('http') ? url : 'https://' + url;
    return tryWith([
      // 1. thum.io — free public screenshot service, no key
      async () => {
        const r = await axios.get(`https://image.thum.io/get/width/1280/crop/800/noanimate/${cleanUrl}`, {
          responseType: 'arraybuffer', timeout: 35000,
          headers: { 'User-Agent': UA_D, Accept: 'image/*' }
        });
        const buf = Buffer.from(r.data);
        if (buf.length < 5000) throw new Error('thum.io: too small');
        return buf;
      },
      // 2. WordPress mShots — free, no key. May return a tiny placeholder on
      //    first hit while it generates the shot, so retry a few times.
      async () => {
        const endpoint = `https://s.wordpress.com/mshots/v1/${encodeURIComponent(cleanUrl)}?w=1280&h=800`;
        let buf;
        for (let attempt = 0; attempt < 5; attempt++) {
          const r = await axios.get(endpoint, {
            responseType: 'arraybuffer', timeout: 30000,
            headers: { 'User-Agent': UA_D, Accept: 'image/*' }
          });
          buf = Buffer.from(r.data);
          if (buf.length > 8000) return buf;
          await new Promise(res => setTimeout(res, 2500));
        }
        throw new Error('mshots: placeholder only');
      },
      // 3. s-shot.ru — free, no key
      async () => {
        const r = await axios.get(`https://mini.s-shot.ru/1280x800/PNG/1280/Z100/?${encodeURIComponent(cleanUrl)}`, {
          responseType: 'arraybuffer', timeout: 35000,
          headers: { 'User-Agent': UA_D, Accept: 'image/*' }
        });
        const buf = Buffer.from(r.data);
        if (buf.length < 5000) throw new Error('s-shot: too small');
        return buf;
      }
    ]);
  },

  // ── Lyrics ───────────────────────────────────────────────────────────────
  lyrics: async (song, artist = '') => tryWith([
    async () => {
      const url = artist && artist !== 'unknown'
        ? `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(song)}`
        : `https://api.lyrics.ovh/v1/${encodeURIComponent(song)}/${encodeURIComponent(song)}`;
      const r = await axios.get(url, { timeout: 12000 }); if (!r.data?.lyrics) throw new Error('no lyrics'); return r.data.lyrics;
    },
    async () => {
      const q = (artist ? artist + ' ' : '') + song;
      const r = await axios.get(`https://api.siputzx.my.id/api/tools/lyrics?title=${encodeURIComponent(q)}`, { timeout: 10000 });
      const lyr = r.data?.data?.lyrics || r.data?.lyrics; if (!lyr) throw new Error('no lyrics'); return lyr;
    }
  ]),

  // ── Pinterest ─────────────────────────────────────────────────────────────
  pinterestDownload: async (url) => {
    // Resolve pin.it short links
    let finalUrl = url;
    try {
      const head = await axios.get(url, { maxRedirects: 10, timeout: 15000,
        headers: { 'User-Agent': UA_M, Accept: 'text/html' }, validateStatus: s => s < 500 });
      finalUrl = head.request?.res?.responseUrl || head.config?.url || url;
    } catch {}

    const r = await axios.get(finalUrl, { timeout: 20000, maxRedirects: 10,
      headers: { 'User-Agent': UA_M, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' }
    });
    const html = typeof r.data === 'string' ? r.data : '';

    // Video: v1.pinimg.com mp4
    const vm = html.match(/"url":"(https:\/\/v1\.pinimg\.com[^"]+\.mp4[^"]*)"/i)
             || html.match(/https:\/\/v1\.pinimg\.com\/[^\s"']+\.mp4/i);
    if (vm) {
      const vu = (vm[1] || vm[0]).split('\\u002F').join('/');
      return { url: vu, type: 'video' };
    }

    // og:image (best quality still)
    const og = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)
             || html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/i);
    if (og) {
      let iu = og[1].replace(/&amp;/g, '&').replace('/236x/', '/736x/').replace('/474x/', '/736x/');
      return { url: iu, type: 'image' };
    }

    // pinimg originals direct link
    const im = html.match(/https:\/\/i\.pinimg\.com\/originals\/[^\s"']+\.(?:jpg|jpeg|png)/i);
    if (im) return { url: im[0], type: 'image' };

    throw new Error('Pinterest: no media found. Pin may be private or removed.');
  },

  // ── Pies (real photos by country) ───────────────────────────────────────────
  // Multi-source strategy with guaranteed final fallback:
  //   1. randomuser.me (huge real-photo DB, with nat= country filter)  ← primary
  //   2. Reddit JSON (country-specific subs)                            ← secondary
  //   3. thispersondoesnotexist.com (AI face)                           ← guaranteed
  // Reason for change: many country-specific subreddits became private/banned
  // and Reddit started 403-ing anonymous JSON requests, so .pies failed across
  // most countries. randomuser.me works globally and never rate-limits us.
  pies: async (country, nsfw = false) => {
    const lc = (country || '').toLowerCase().replace(/\s+/g, '');

    // ─── Source 1: randomuser.me ──────────────────────────────────────────
    // Maps our countries to ISO-2 codes that randomuser.me supports.
    // Unsupported countries fall through to "any" (random nationality).
    // randomuser.me supported nat codes — anything not here falls through
    // to the "random nationality" mode (still returns a real photo).
    const NAT_MAP = {
      usa: 'us', america: 'us',
      uk: 'gb', britain: 'gb', england: 'gb',
      france: 'fr', french: 'fr',
      germany: 'de',
      spain: 'es',
      brazil: 'br',
      australia: 'au',
      canada: 'ca',
      switzerland: 'ch',
      denmark: 'dk',
      finland: 'fi',
      ireland: 'ie',
      india: 'in',
      iran: 'ir',
      mexico: 'mx',
      netherlands: 'nl',
      norway: 'no',
      newzealand: 'nz',
      serbia: 'rs',
      turkey: 'tr',
      ukraine: 'ua',
    };

    // Map common spellings that aren't ISO-2 to the supported pool above
    const ALIAS = { usa: 'us', america: 'us', britain: 'gb', england: 'gb' };
    const lcKey = ALIAS[lc] || lc;

    const tryRandomUser = async (gender = 'female') => {
      const nat = NAT_MAP[lc];
      const url = `https://randomuser.me/api/?gender=${gender}&inc=picture,nat${nat ? `&nat=${nat}` : ''}`;
      const r = await axios.get(url, {
        timeout: 12000,
        headers: { 'User-Agent': UA_D, Accept: 'application/json' }
      });
      const pic = r.data?.results?.[0]?.picture?.large;
      if (!pic) throw new Error('randomuser: no pic');
      const ir = await axios.get(pic, {
        responseType: 'arraybuffer', timeout: 12000,
        headers: { 'User-Agent': UA_D }
      });
      const buf = Buffer.from(ir.data);
      if (buf.length < 3000) throw new Error('randomuser: too small');
      return buf;
    };

    // ─── Source 2: Reddit ─────────────────────────────────────────────────
    const SFW_SUBS = ['Faces', 'Portraits', 'pics'];
    const COUNTRY_SUBS = {
      japan: 'japanpics', korea: 'kpics', india: 'IndianFaces',
      france: 'FrenchGirls', russia: 'RussianFaces', uk: 'britishgirls',
      usa: 'Selfie', china: 'ChinesePhotos', thai: 'ThaiGirls',
      thailand: 'ThaiGirls', vietnam: 'AsianInvasion',
      // Arabic / MENA region — keep SFW
      lebanon: 'arab', egypt: 'arab', morocco: 'arab',
      jordan: 'arab', algeria: 'arab', iraq: 'arab',
      syria: 'arab', saudi: 'arab', kuwait: 'arab',
      qatar: 'arab', uae: 'arab', arab: 'arab',
      // Latin America
      brazil: 'brasilivre', mexico: 'mexico',
      argentina: 'argentina', colombia: 'Colombia',
      // Europe
      italy: 'italy', spain: 'es', germany: 'de',
      poland: 'Polska', greece: 'greece', romania: 'Romania',
      // Asia/SEA
      philippines: 'Philippines', indonesia: 'indonesia',
      malaysia: 'malaysia', pakistan: 'pakistan',
      // Africa
      nigeria: 'Nigeria', kenya: 'Kenya', ghana: 'ghana',
      ethiopia: 'ethiopia', southafrica: 'southafrica',
    };
    const NSFW_SUBS = ['RealGirls', 'AmIHot'];

    let sub;
    if (nsfw) sub = NSFW_SUBS[Math.floor(Math.random() * NSFW_SUBS.length)];
    else if (COUNTRY_SUBS[lc]) sub = COUNTRY_SUBS[lc];
    else sub = SFW_SUBS[Math.floor(Math.random() * SFW_SUBS.length)];

    const RHEADERS = {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
      Accept: 'application/json'
    };

    const extractImg = async (p) => {
      if (!p || p.is_self) return null;
      const direct = p.url_overridden_by_dest || p.url || '';
      if (/\.(jpg|jpeg|png)(\?.*)?$/i.test(direct)) {
        const r = await axios.get(direct, { responseType: 'arraybuffer', timeout: 15000, headers: { 'User-Agent': UA_D } });
        const buf = Buffer.from(r.data);
        if (buf.length > 15000) return buf;
      }
      const preview = p.preview?.images?.[0]?.source?.url?.replace(/&amp;/g, '&');
      if (preview && /preview\.redd\.it/.test(preview)) {
        const r = await axios.get(preview, { responseType: 'arraybuffer', timeout: 15000, headers: { 'User-Agent': UA_D } });
        const buf = Buffer.from(r.data);
        if (buf.length > 15000) return buf;
      }
      return null;
    };

    const tryReddit = async () => {
      // First try old.reddit.com (less likely to block) then www.reddit.com
      const hosts = ['https://old.reddit.com', 'https://www.reddit.com'];
      for (const host of hosts) {
        try {
          const r = await axios.get(`${host}/r/${sub}/top.json?limit=50&t=month`, {
            headers: RHEADERS, timeout: 15000, maxRedirects: 5
          });
          const posts = (r.data?.data?.children || []).sort(() => Math.random() - 0.5);
          for (const post of posts) {
            const buf = await extractImg(post?.data).catch(() => null);
            if (buf) return buf;
          }
        } catch {}
      }
      throw new Error('reddit: no image');
    };

    // ─── Source 3: AI face (always works — guaranteed fallback) ──────────
    const tryAIFace = async () => {
      const r = await axios.get('https://thispersondoesnotexist.com/', {
        responseType: 'arraybuffer', timeout: 12000,
        headers: { 'User-Agent': UA_D, Accept: 'image/*' }
      });
      const buf = Buffer.from(r.data);
      if (buf.length < 5000) throw new Error('tpdne: too small');
      return buf;
    };

    // ─── Run all sources in order, return first that succeeds ────────────
    // Order matters: when a country-specific subreddit exists, prefer Reddit
    // because the result actually matches the requested country. Otherwise
    // fall back to randomuser.me which always works but ignores nationality
    // when not in NAT_MAP. AI face is the last-resort guarantee.
    const hasCountrySub = !nsfw && !!COUNTRY_SUBS[lc];
    const sources = hasCountrySub
      ? [tryReddit, tryRandomUser, tryAIFace]
      : [tryRandomUser, tryReddit, tryAIFace];
    let lastErr;
    for (const fn of sources) {
      try { return await fn(); } catch (e) { lastErr = e; }
    }
    throw new Error(`All sources failed: ${lastErr?.message || 'unknown'}`);
  },

  // ── picsHQ — high-quality real photos by free-text topic ────────────────
  // Used by `.pics <topic>`. Hits Unsplash Source first (no API key, returns
  // a real JPEG) then a few keyword-based subreddit fallbacks.
  picsHQ: async (topic) => {
    const q = (topic || 'nature').trim();
    return tryWith([
      async () => {
        const seed = Math.floor(Math.random() * 99999);
        const r = await axios.get(`https://source.unsplash.com/1280x720/?${encodeURIComponent(q)}&sig=${seed}`, {
          responseType: 'arraybuffer', timeout: 15000, maxRedirects: 5,
          headers: { 'User-Agent': UA_D, Accept: 'image/*' }
        });
        const buf = Buffer.from(r.data);
        if (buf.length < 5000) throw new Error('unsplash: too small');
        return buf;
      },
      async () => {
        const r = await axios.get(`https://api.siputzx.my.id/api/r/random?query=${encodeURIComponent(q)}`, { timeout: 12000 });
        const u = r.data?.data?.image || r.data?.url;
        if (!u) throw new Error('siputzx: no url');
        const ir = await axios.get(u, { responseType: 'arraybuffer', timeout: 15000, headers: { 'User-Agent': UA_D } });
        const buf = Buffer.from(ir.data);
        if (buf.length < 5000) throw new Error('siputzx: too small');
        return buf;
      }
    ]);
  },

  // ── Anime images ──────────────────────────────────────────────────────────
  anime: async (type, nsfw = false) => {
    // `loli` (SFW) and `milf` (NSFW) intentionally removed per project policy.
    const SFW  = { waifu:'waifu', neko:'neko', shinobu:'shinobu', megumin:'megumin', bully:'bully', cuddle:'cuddle', cry:'cry', hug:'hug', awoo:'awoo', kiss:'kiss', lick:'lick', pat:'pat', smug:'smug', bonk:'bonk', yeet:'yeet', blush:'blush', smile:'smile', wave:'wave', nom:'nom', bite:'bite', happy:'happy', wink:'wink', poke:'poke', dance:'dance' };

    if (!nsfw) {
      const t = SFW[type] || 'waifu';
      return tryWith([
        async () => {
          const r = await api.get(`https://api.waifu.pics/sfw/${t}`, { timeout: 15000 });
          const u = r.data?.url; if (!u) throw new Error('no url');
          const ir = await api.get(u, { responseType: 'arraybuffer', timeout: 15000 }); return Buffer.from(ir.data);
        },
        async () => {
          const safe = ['neko','hug','kiss','pat','wave','cuddle','dance','smile','blush','wink'];
          const t2 = safe.includes(t) ? t : 'neko';
          const r = await api.get(`https://nekos.best/api/v2/${t2}`, { timeout: 15000 });
          const u = r.data?.results?.[0]?.url; if (!u) throw new Error('no url');
          const ir = await api.get(u, { responseType: 'arraybuffer', timeout: 15000 }); return Buffer.from(ir.data);
        }
      ]);
    } else {
      // waifu.im valid NSFW tags — only use tags the API actually accepts
      const WAIFU_IM_NSFW = {
        waifu: 'waifu', neko: 'oppai', hentai: 'hentai', ecchi: 'ecchi',
        feet: 'ero', yuri: 'ecchi', blowjob: 'hentai', ass: 'ero',
      };
      // waifu.pics valid NSFW categories
      const WAIFU_PICS_NSFW = {
        waifu: 'waifu', neko: 'neko', hentai: 'blowjob', ecchi: 'waifu',
        feet: 'neko', yuri: 'yuri', blowjob: 'blowjob', ass: 'waifu',
      };
      const waifuImTag   = WAIFU_IM_NSFW[type]   || 'hentai';
      const waifuPicsTag = WAIFU_PICS_NSFW[type]  || 'waifu';
      return tryWith([
        async () => {
          const r = await api.get(`https://api.waifu.im/search?included_tags=${waifuImTag}&is_nsfw=true`, { timeout: 15000, headers: { Accept: 'application/json' } });
          const u = r.data?.images?.[0]?.url; if (!u) throw new Error('no url');
          const ir = await api.get(u, { responseType: 'arraybuffer', timeout: 15000 }); return Buffer.from(ir.data);
        },
        async () => {
          const r = await api.get(`https://api.waifu.pics/nsfw/${waifuPicsTag}`, { timeout: 15000 });
          const u = r.data?.url; if (!u) throw new Error('no url');
          const ir = await api.get(u, { responseType: 'arraybuffer', timeout: 15000 }); return Buffer.from(ir.data);
        }
      ]);
    }
  },

  // ── Weather ───────────────────────────────────────────────────────────────
  weather: async (city) => tryWith([
    async () => {
      const r = await api.get(`https://wttr.in/${encodeURIComponent(city)}?format=j1`, { timeout: 10000 });
      const c = r.data?.current_condition?.[0]; const area = r.data?.nearest_area?.[0]; if (!c) throw new Error('no current');
      return { city: area?.areaName?.[0]?.value || city, country: area?.country?.[0]?.value || '', temp_c: c.temp_C, feels_like: c.FeelsLikeC, humidity: c.humidity, wind_speed: c.windspeedKmph, description: c.weatherDesc?.[0]?.value || '', visibility: c.visibility };
    }
  ]),

  // ── Meme ─────────────────────────────────────────────────────────────────
  // Supports both English and Arabic memes. If the query contains Arabic
  // letters or matches a known Arabic-meme keyword, hit Arabic-language
  // subreddits first. Otherwise English subs.
  // `subreddit` may be a subreddit name OR a free-text search query — when
  // it's a free-text query we map it to a sub instead of calling /gimme/<q>.
  meme: async (query = null) => {
    const ENG_SUBS = ['memes', 'dankmemes', 'funny', 'me_irl', 'ComedyCemetery', 'AdviceAnimals', 'wholesomememes'];
    const AR_SUBS  = ['ArabicMemes', 'arabfunny', 'arab', 'ArabMeme'];

    const isArabic = (s) => typeof s === 'string' && /[\u0600-\u06FF]/.test(s);
    const AR_KEYWORDS = ['arabic', 'arab', 'عربي', 'عربى', 'مصر', 'مصري', 'لبنان', 'سوري', 'سعودي'];
    const wantArabic = query && (isArabic(query) || AR_KEYWORDS.some(k => query.toLowerCase().includes(k)));

    // Pick a subreddit pool (Arabic vs English) — query may also be a literal
    // subreddit name, in which case use it directly.
    let sub;
    if (query && /^[A-Za-z0-9_]{3,21}$/.test(query) && !wantArabic) {
      sub = query;
    } else if (wantArabic) {
      sub = AR_SUBS[Math.floor(Math.random() * AR_SUBS.length)];
    } else {
      sub = ENG_SUBS[Math.floor(Math.random() * ENG_SUBS.length)];
    }

    return tryWith([
      async () => { const r = await api.get(`https://meme-api.com/gimme/${encodeURIComponent(sub)}`, { timeout: 10000 }); if (!r.data?.url) throw new Error('no url'); return r.data; },
      // If the targeted sub fails (private/banned), try a random one from the pool
      async () => {
        const pool = wantArabic ? AR_SUBS : ENG_SUBS;
        const alt = pool[Math.floor(Math.random() * pool.length)];
        const r = await api.get(`https://meme-api.com/gimme/${encodeURIComponent(alt)}`, { timeout: 10000 });
        if (!r.data?.url) throw new Error('no url'); return r.data;
      },
      async () => { const r = await api.get('https://meme-api.com/gimme', { timeout: 10000 }); if (!r.data?.url) throw new Error('no url'); return r.data; }
    ]);
  },

  // ── Download buffer ───────────────────────────────────────────────────────
  downloadBuffer: async (url, extraHeaders = {}) => {
    const r = await axios.get(url, {
      responseType: 'arraybuffer', timeout: 60000, maxContentLength: 80 * 1024 * 1024,
      headers: { 'User-Agent': UA_D, ...extraHeaders }, maxRedirects: 10
    });
    return Buffer.from(r.data);
  }
};
