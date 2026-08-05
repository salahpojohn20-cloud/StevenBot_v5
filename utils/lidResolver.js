/**
 * lidResolver.js — Centralised LID ↔ phone-number resolution
 *
 * WhatsApp sends many participants as @lid JIDs. This module resolves them
 * to real phone numbers using the group participant list (most reliable),
 * then Baileys session files, then raw fallback.
 *
 * KEY INSIGHT: participant objects have BOTH p.id (phone JID) AND p.lid (LID JID).
 * When the sender arrives as a @lid JID, we match p.lid to find the p.id phone number.
 */

const fs   = require('fs');
const path = require('path');

// ── Cache ──────────────────────────────────────────────────────────────────
const _cache = new Map();
const _TTL   = 60_000;
const _get = k  => { const e = _cache.get(k); return (e && Date.now()-e.ts < _TTL) ? e.val : undefined; };
const _set = (k,v) => _cache.set(k, { val: v, ts: Date.now() });

// ── Normalise a raw JID user string (strip device suffix) ─────────────────
const _user = jid => (jid || '').split(':')[0].split('@')[0];
const _server = jid => { const b = (jid||'').split(':')[0]; return b.includes('@') ? b.split('@')[1] : ''; };

// ── Read Baileys session mapping file ─────────────────────────────────────
const _readMapping = (user, dir, sessionPath) => {
  const k = `${dir}:${user}`;
  const c = _get(k); if (c !== undefined) return c;
  const suffix = dir === 'pnToLid' ? '.json' : '_reverse.json';
  const fp = path.join(sessionPath, `lid-mapping-${user}${suffix}`);
  try {
    if (!fs.existsSync(fp)) { _set(k, null); return null; }
    const v = JSON.parse(fs.readFileSync(fp, 'utf8').trim() || 'null');
    _set(k, v || null); return v || null;
  } catch { _set(k, null); return null; }
};

/**
 * resolveNum(jid, participants?, sessionName?)
 * Returns digits-only REAL phone number (7-15 digits), e.g. '201273323087'.
 * Returns '' when no real phone could be resolved — callers should treat
 * this as "unknown" and NOT use the raw JID digits (those are LID digits
 * that will produce non-clickable mentions).
 *
 * Resolution order:
 *   1. JID is already a phone JID (s.whatsapp.net / c.us)
 *   2. participants[].lid matches → use participants[].id (phone)
 *   3. participants[].id matches AND it's a LID → use participants[].phoneNumber
 *   4. participants[].id matches AND it's already a phone → use it
 *   5. Baileys session lid-mapping file
 *   6. Try the matching session/auth folder paths (./session, ./auth_info, etc.)
 */
const _looksLikePhone = n => {
  const d = (n || '').replace(/\D/g, '');
  return d.length >= 7 && d.length <= 15;
};

const resolveNum = (jid, participants = [], sessionName = 'session') => {
  if (!jid) return '';
  const user   = _user(jid);
  const server = _server(jid);

  // 1. Already a phone JID — trust the digits as-is (if reasonable)
  if (server === 's.whatsapp.net' || server === 'c.us') {
    const d = user.replace(/\D/g, '');
    return _looksLikePhone(d) ? d : '';
  }

  // 2-4. LID resolution via participant list
  if (server === 'lid' || server === 'hosted.lid' || !server) {
    if (participants && participants.length) {
      // 2. Match p.lid → use p.id (phone)
      const byLid = participants.find(p => p.lid && _user(p.lid) === user);
      if (byLid) {
        // Prefer the explicit phoneNumber field if present
        if (byLid.phoneNumber && _looksLikePhone(_user(byLid.phoneNumber))) {
          return _user(byLid.phoneNumber).replace(/\D/g, '');
        }
        // Otherwise use p.id only if it's actually a phone JID
        if (byLid.id && !byLid.id.includes('@lid')) {
          const d = _user(byLid.id).replace(/\D/g, '');
          if (_looksLikePhone(d)) return d;
        }
      }

      // 3. p.id is the LID we're looking up → use p.phoneNumber
      const byIdLid = participants.find(p => p.id && p.id.includes('@lid') && _user(p.id) === user);
      if (byIdLid?.phoneNumber) {
        const d = _user(byIdLid.phoneNumber).replace(/\D/g, '');
        if (_looksLikePhone(d)) return d;
      }

      // 3b. Fallback: maybe the bot stores phone elsewhere — scan for any
      // participant whose .lid matches and has any phone-like field
      for (const p of participants) {
        if (p.lid && _user(p.lid) === user) {
          for (const f of [p.phoneNumber, p.jid, p.notify, p.name]) {
            const d = _user(f || '').replace(/\D/g, '');
            if (_looksLikePhone(d)) return d;
          }
        }
      }
    }

    // 5-6. Baileys session mapping files — try the named session, then common defaults
    const candidates = [
      path.join(process.cwd(), sessionName),
      path.join(process.cwd(), 'session'),
      path.join(process.cwd(), 'auth_info'),
      path.join(process.cwd(), 'auth_info_baileys'),
    ];
    for (const sessionPath of candidates) {
      try {
        if (!fs.existsSync(sessionPath)) continue;
        const pn = _readMapping(user, 'lidToPn', sessionPath);
        if (pn) {
          const d = String(pn).replace(/\D/g, '');
          if (_looksLikePhone(d)) return d;
        }
      } catch {}
    }
  }

  // 7. Could NOT resolve to a real phone — return empty.
  // Returning the raw LID digits would only produce a broken @mention.
  return '';
};

/**
 * resolveJid(jid, participants?, sessionName?)
 * Returns full @s.whatsapp.net JID for the resolved phone number.
 * If we couldn't resolve a real phone, returns the original jid.
 */
const resolveJid = (jid, participants = [], sessionName = 'session') => {
  const num = resolveNum(jid, participants, sessionName);
  // Only return phone JID if we got a reasonable phone number (not a 15-digit LID)
  const server = _server(jid);
  if (server === 'lid' || server === 'hosted.lid') {
    // Check if we found a real phone (phone numbers are 7-15 digits, LIDs are usually longer)
    if (num && num.length >= 7 && num.length <= 15) return `${num}@s.whatsapp.net`;
    return jid; // couldn't resolve, keep original
  }
  return num ? `${num}@s.whatsapp.net` : jid;
};

/**
 * resolveParticipants(participants, sessionName?)
 * Enriches each participant with .phoneNum and .phoneJid
 */
const resolveParticipants = (participants = [], sessionName = 'session') =>
  participants.map(p => {
    const phoneNum = resolveNum(p.id, participants, sessionName);
    const phoneJid = (phoneNum && phoneNum.length >= 7 && phoneNum.length <= 15)
      ? `${phoneNum}@s.whatsapp.net`
      : (p.id || '');
    return { ...p, phoneNum, phoneJid };
  });

/**
 * isSameParticipant(jidA, jidB, participants?, sessionName?)
 * Returns true if two JIDs refer to the same person (handles LID <-> phone matching).
 * Used by abyss/bankai to safely exclude bot/owner from kick list.
 */
const isSameParticipant = (jidA, jidB, participants = [], sessionName = 'session') => {
  if (!jidA || !jidB) return false;
  const numA = resolveNum(jidA, participants, sessionName);
  const numB = resolveNum(jidB, participants, sessionName);
  if (numA && numB && numA === numB) return true;
  // Raw user comparison as fallback
  const uA = _user(jidA); const uB = _user(jidB);
  return uA === uB;
};

module.exports = { resolveNum, resolveJid, resolveParticipants, isSameParticipant };
