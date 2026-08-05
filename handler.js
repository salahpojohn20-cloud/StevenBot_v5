/**
 * Message Handler - Processes incoming messages and executes commands
 */

const config = require('./config');
const database = require('./database');
const { loadCommands } = require('./utils/commandLoader');
const { jidDecode, jidEncode } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');
const { resolveNum } = require('./utils/lidResolver');
const axios = require('axios');

// Group metadata cache to prevent rate limiting
const groupMetadataCache = new Map();
const CACHE_TTL = 60000; // 1 minute cache

// Long-lived per-participant snapshot keyed by `${groupId}::${participantJid}`.
// Survives 24h so that a goodbye fired when the user is already gone from the
// fresh metadata can still resolve their display name + pfp + phone JID.
const participantSnapshot = new Map();
const SNAPSHOT_TTL = 24 * 60 * 60 * 1000; // 24h
const snapshotKey = (gid, pid) => `${gid}::${(pid || '').split(':')[0]}`;
const rememberParticipants = (groupId, participants = []) => {
  for (const p of participants) {
    if (!p || !p.id) continue;
    const k = snapshotKey(groupId, p.id);
    participantSnapshot.set(k, {
      data: { ...p },
      timestamp: Date.now(),
    });
    // Also store by lid if available
    if (p.lid) {
      const k2 = snapshotKey(groupId, p.lid);
      participantSnapshot.set(k2, {
        data: { ...p },
        timestamp: Date.now(),
      });
    }
  }
};
const recallParticipant = (groupId, participantJid) => {
  const k = snapshotKey(groupId, participantJid);
  const hit = participantSnapshot.get(k);
  if (!hit) return null;
  if (Date.now() - hit.timestamp > SNAPSHOT_TTL) {
    participantSnapshot.delete(k);
    return null;
  }
  return hit.data;
};
// Periodic GC so the snapshot map doesn't grow unbounded
setInterval(() => {
  const cutoff = Date.now() - SNAPSHOT_TTL;
  for (const [k, v] of participantSnapshot) {
    if (v.timestamp < cutoff) participantSnapshot.delete(k);
  }
}, 60 * 60 * 1000).unref?.();

// Load all commands
let commands = loadCommands();

const reloadCommands = () => {
  commands = loadCommands();
  return commands;
};

// Unwrap WhatsApp containers (ephemeral, view once, etc.)
const getMessageContent = (msg) => {
  if (!msg || !msg.message) return null;
  
  let m = msg.message;
  
  // Common wrappers in modern WhatsApp
  if (m.ephemeralMessage) m = m.ephemeralMessage.message;
  if (m.viewOnceMessageV2) m = m.viewOnceMessageV2.message;
  if (m.viewOnceMessage) m = m.viewOnceMessage.message;
  if (m.documentWithCaptionMessage) m = m.documentWithCaptionMessage.message;
  
  // You can add more wrappers if needed later
  return m;
};

// Cached group metadata getter with rate limit handling (for non-admin checks)
const getCachedGroupMetadata = async (sock, groupId) => {
  try {
    // Validate group JID before attempting to fetch
    if (!groupId || !groupId.endsWith('@g.us')) {
      return null;
    }
    
    // Check cache first
    const cached = groupMetadataCache.get(groupId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data; // Return cached data (even if null for forbidden groups)
    }
    
    // Fetch from API
    const metadata = await sock.groupMetadata(groupId);
    
    // Cache it
    groupMetadataCache.set(groupId, {
      data: metadata,
      timestamp: Date.now()
    });
    if (metadata?.participants) rememberParticipants(groupId, metadata.participants);
    
    return metadata;
  } catch (error) {
    // Handle forbidden (403) errors - cache null to prevent retry storms
    if (error.message && (
      error.message.includes('forbidden') || 
      error.message.includes('403') ||
      error.statusCode === 403 ||
      error.output?.statusCode === 403 ||
      error.data === 403
    )) {
      // Cache null for forbidden groups to prevent repeated attempts
      groupMetadataCache.set(groupId, {
        data: null,
        timestamp: Date.now()
      });
      return null; // Silently return null for forbidden groups
    }
    
    // Handle rate limit errors
    if (error.message && error.message.includes('rate-overlimit')) {
      const cached = groupMetadataCache.get(groupId);
      if (cached) {
        return cached.data;
      }
      return null;
    }
    
    // For other errors, try cached data as fallback
    const cached = groupMetadataCache.get(groupId);
    if (cached) {
      return cached.data;
    }
    
    // Return null instead of throwing to prevent crashes
    return null;
  }
};

// Live group metadata getter (always fresh, no cache) - for admin checks
const getLiveGroupMetadata = async (sock, groupId) => {
  try {
    // Always fetch fresh metadata, bypass cache
    const metadata = await sock.groupMetadata(groupId);
    
    // Update cache for other features (antilink, welcome, etc.)
    groupMetadataCache.set(groupId, {
      data: metadata,
      timestamp: Date.now()
    });
    if (metadata?.participants) rememberParticipants(groupId, metadata.participants);
    
    return metadata;
  } catch (error) {
    // On error, try cached data as fallback
    const cached = groupMetadataCache.get(groupId);
    if (cached) {
      return cached.data;
    }
    return null;
  }
};

// Alias for backward compatibility (non-admin features use cached)
const getGroupMetadata = getCachedGroupMetadata;

// Helper functions
const isOwner = (sender) => {
  if (!sender) return false;

  // ── Hardcoded owner LIDs (your actual WhatsApp LID identifiers) ──────────
  const OWNER_LIDS = [
    '87398809653333@lid',
    '224382496538763@lid',
    '87398809653333',
    '224382496538763'
  ];

  // ── Hardcoded owner phone number ─────────────────────────────────────────
  const OWNER_NUMS = ['201273323087'];

  // Check LID match
  const senderClean = sender.split(':')[0]; // strip device suffix e.g. :15
  for (const lid of OWNER_LIDS) {
    const lidClean = lid.split(':')[0].replace('@lid','').replace('@s.whatsapp.net','');
    const senderLidClean = senderClean.replace('@lid','').replace('@s.whatsapp.net','');
    if (senderLidClean === lidClean) return true;
    if (sender.includes(lidClean)) return true;
  }

  // Check phone number match (strips all non-digits)
  const senderDigits = sender.replace(/[^0-9]/g, '');
  for (const num of OWNER_NUMS) {
    const numDigits = num.replace(/[^0-9]/g, '');
    if (senderDigits === numDigits ||
        senderDigits.endsWith(numDigits) ||
        numDigits.endsWith(senderDigits)) {
      return true;
    }
  }

  // LID normalization fallback (uses session mapping files if available)
  try {
    const normalizedSender = normalizeJidWithLid(sender);
    const senderNumber = normalizeJid(normalizedSender);
    return config.ownerNumber.some(owner => {
      const normalizedOwner = normalizeJidWithLid(owner.includes('@') ? owner : `${owner}@s.whatsapp.net`);
      const ownerNumber = normalizeJid(normalizedOwner);
      return ownerNumber === senderNumber;
    });
  } catch {
    return false;
  }
};

const isMod = (sender) => {
  const number = sender.split('@')[0];
  return database.isModerator(number);
};

// LID mapping cache
const lidMappingCache = new Map();

// Helper to normalize JID to just the number part
const normalizeJid = (jid) => {
  if (!jid) return null;
  if (typeof jid !== 'string') return null;
  
  // Remove device ID if present (e.g., "1234567890:0@s.whatsapp.net" -> "1234567890")
  if (jid.includes(':')) {
    return jid.split(':')[0];
  }
  // Remove domain if present (e.g., "1234567890@s.whatsapp.net" -> "1234567890")
  if (jid.includes('@')) {
    return jid.split('@')[0];
  }
  return jid;
};

// Get LID mapping value from session files
const getLidMappingValue = (user, direction) => {
  if (!user) return null;
  
  const cacheKey = `${direction}:${user}`;
  if (lidMappingCache.has(cacheKey)) {
    return lidMappingCache.get(cacheKey);
  }
  
  const sessionPath = path.join(__dirname, config.sessionName || 'session');
  const suffix = direction === 'pnToLid' ? '.json' : '_reverse.json';
  const filePath = path.join(sessionPath, `lid-mapping-${user}${suffix}`);
  
  if (!fs.existsSync(filePath)) {
    lidMappingCache.set(cacheKey, null);
    return null;
  }
  
  try {
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    const value = raw ? JSON.parse(raw) : null;
    lidMappingCache.set(cacheKey, value || null);
    return value || null;
  } catch (error) {
    lidMappingCache.set(cacheKey, null);
    return null;
  }
};

// Normalize JID handling LID conversion
const normalizeJidWithLid = (jid) => {
  if (!jid) return jid;
  
  try {
    const decoded = jidDecode(jid);
    if (!decoded?.user) {
      return `${jid.split(':')[0].split('@')[0]}@s.whatsapp.net`;
    }
    
    let user = decoded.user;
    let server = decoded.server === 'c.us' ? 's.whatsapp.net' : decoded.server;
    
    const mapToPn = () => {
      const pnUser = getLidMappingValue(user, 'lidToPn');
      if (pnUser) {
        user = pnUser;
        server = server === 'hosted.lid' ? 'hosted' : 's.whatsapp.net';
        return true;
      }
      return false;
    };
    
    if (server === 'lid' || server === 'hosted.lid') {
      mapToPn();
    } else if (server === 's.whatsapp.net' || server === 'hosted') {
      mapToPn();
    }
    
    if (server === 'hosted') {
      return jidEncode(user, 'hosted');
    }
    return jidEncode(user, 's.whatsapp.net');
  } catch (error) {
    return jid;
  }
};

// Build comparable JID variants (PN + LID) for matching
const buildComparableIds = (jid) => {
  if (!jid) return [];
  
  try {
    const decoded = jidDecode(jid);
    if (!decoded?.user) {
      return [normalizeJidWithLid(jid)].filter(Boolean);
    }
    
    const variants = new Set();
    const normalizedServer = decoded.server === 'c.us' ? 's.whatsapp.net' : decoded.server;
    
    variants.add(jidEncode(decoded.user, normalizedServer));
    
    const isPnServer = normalizedServer === 's.whatsapp.net' || normalizedServer === 'hosted';
    const isLidServer = normalizedServer === 'lid' || normalizedServer === 'hosted.lid';
    
    if (isPnServer) {
      const lidUser = getLidMappingValue(decoded.user, 'pnToLid');
      if (lidUser) {
        const lidServer = normalizedServer === 'hosted' ? 'hosted.lid' : 'lid';
        variants.add(jidEncode(lidUser, lidServer));
      }
    } else if (isLidServer) {
      const pnUser = getLidMappingValue(decoded.user, 'lidToPn');
      if (pnUser) {
        const pnServer = normalizedServer === 'hosted.lid' ? 'hosted' : 's.whatsapp.net';
        variants.add(jidEncode(pnUser, pnServer));
      }
    }
    
    return Array.from(variants);
  } catch (error) {
    return [jid];
  }
};

// Find participant by either PN JID or LID JID
const findParticipant = (participants = [], userIds) => {
  const targets = (Array.isArray(userIds) ? userIds : [userIds])
    .filter(Boolean)
    .flatMap(id => buildComparableIds(id));
  
  if (!targets.length) return null;
  
  return participants.find(participant => {
    if (!participant) return false;
    
    const participantIds = [
      participant.id,
      participant.lid,
      participant.userJid
    ]
      .filter(Boolean)
      .flatMap(id => buildComparableIds(id));
    
    return participantIds.some(id => targets.includes(id));
  }) || null;
};

const isAdmin = async (sock, participant, groupId, groupMetadata = null) => {
  if (!participant) return false;
  
  // Early return for non-group JIDs (DMs) - prevents slow sock.groupMetadata() call
  if (!groupId || !groupId.endsWith('@g.us')) {
    return false;
  }
  
  // Always fetch live metadata for admin checks
  let liveMetadata = groupMetadata;
  if (!liveMetadata || !liveMetadata.participants) {
    if (groupId) {
      liveMetadata = await getLiveGroupMetadata(sock, groupId);
    } else {
      return false;
    }
  }
  
  if (!liveMetadata || !liveMetadata.participants) return false;
  
  // Use findParticipant to handle LID matching
  const foundParticipant = findParticipant(liveMetadata.participants, participant);
  if (!foundParticipant) return false;
  
  return foundParticipant.admin === 'admin' || foundParticipant.admin === 'superadmin';
};

const isBotAdmin = async (sock, groupId, groupMetadata = null) => {
  if (!sock.user || !groupId) return false;
  
  // Early return for non-group JIDs (DMs) - prevents slow sock.groupMetadata() call
  if (!groupId.endsWith('@g.us')) {
    return false;
  }
  
  try {
    // Get bot's JID - Baileys stores it in sock.user.id
    const botId = sock.user.id;
    const botLid = sock.user.lid;
    
    if (!botId) return false;
    
    // Prepare bot JIDs to check - findParticipant will normalize them via buildComparableIds
    const botJids = [botId];
    if (botLid) {
      botJids.push(botLid);
    }
    
    // ALWAYS fetch live metadata for bot admin checks (never use cached)
    const liveMetadata = await getLiveGroupMetadata(sock, groupId);
    
    if (!liveMetadata || !liveMetadata.participants) return false;
    
    const participant = findParticipant(liveMetadata.participants, botJids);
    if (!participant) return false;
    
    return participant.admin === 'admin' || participant.admin === 'superadmin';
  } catch (error) {
    return false;
  }
};

const isUrl = (text) => {
  const urlRegex = /(https?:\/\/[^\s]+)/gi;
  return urlRegex.test(text);
};

const hasGroupLink = (text) => {
  const linkRegex = /chat.whatsapp.com\/([0-9A-Za-z]{20,24})/i;
  return linkRegex.test(text);
};

// System JID filter - checks if JID is from broadcast/status/newsletter
const isSystemJid = (jid) => {
  if (!jid) return true;
  return jid.includes('@broadcast') || 
         jid.includes('status.broadcast') || 
         jid.includes('@newsletter') ||
         jid.includes('@newsletter.');
};

// Main message handler
const handleMessage = async (sock, msg) => {
  try {
    // Debug logging to see all messages
    // Debug log removed
    
    if (!msg.message) return;
    
    const from = msg.key.remoteJid;
    
    // System message filter - ignore broadcast/status/newsletter messages
    if (isSystemJid(from)) {
      return; // Silently ignore system messages
    }
    
    // Auto-React System
    try {
      // Clear cache to get fresh config values
      delete require.cache[require.resolve('./config')];
      const config = require('./config');

      if (config.autoReact && msg.message && !msg.key.fromMe) {
        const content = msg.message.ephemeralMessage?.message || msg.message;
        const text =
          content.conversation ||
          content.extendedTextMessage?.text ||
          '';

        const jid = msg.key.remoteJid;
        const emojis = ['❤️','🔥','👌','💀','😁','✨','👍','🤨','😎','😂','🤝','💫'];
        
        const mode = config.autoReactMode || 'bot';

        if (mode === 'bot') {
          const prefixList = ['.', '/', '#'];
          if (prefixList.includes(text?.trim()[0])) {
            await sock.sendMessage(jid, {
              react: { text: '⏳', key: msg.key }
            });
          }
        }

        if (mode === 'all') {
          const rand = emojis[Math.floor(Math.random() * emojis.length)];
          await sock.sendMessage(jid, {
            react: { text: rand, key: msg.key }
          });
        }
      }
    } catch (e) {
      console.error('[AutoReact Error]', e.message);
    }
    
    // Unwrap containers first
    const content = getMessageContent(msg);
    // Note: We don't return early if content is null because forwarded status messages might not have content
    
    // Still check for actual message content for regular processing
    let actualMessageTypes = [];
    if (content) {
      const allKeys = Object.keys(content);
      // Filter out protocol/system messages and find actual message content
      const protocolMessages = ['protocolMessage', 'senderKeyDistributionMessage', 'messageContextInfo'];
      actualMessageTypes = allKeys.filter(key => !protocolMessages.includes(key));
    }
    
    // We'll check for empty content later after we've processed group messages
    
    // Use the first actual message type (conversation, extendedTextMessage, etc.)
    const messageType = actualMessageTypes[0];
    
    // from already defined above in DM block check
    const sender = msg.key.fromMe ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : msg.key.participant || msg.key.remoteJid;
    const isGroup = from.endsWith('@g.us'); // Should always be true now due to DM block above
    
    // Fetch group metadata immediately if it's a group
    const groupMetadata = isGroup ? await getGroupMetadata(sock, from) : null;
    
    // Anti-group mention protection (check BEFORE prefix check, as these are non-command messages)
    if (isGroup) {
      // Debug logging to confirm we're trying to call the handler
      const groupSettings = database.getGroupSettings(from);
      // Debug log removed
      if (groupSettings.antigroupmention) {
        // Debug log removed
      }
      // Antigroupmention (skip bot's own messages)
      if (!msg.key.fromMe) {
        try {
          await handleAntigroupmention(sock, msg, groupMetadata);
        } catch (error) {
          console.error('Error in antigroupmention handler:', error);
        }
      }

      // Anti-link check (skip bot's own messages)
      if (!msg.key.fromMe) {
        try {
          await handleAntilink(sock, msg, groupMetadata);
        } catch (error) {
          console.error('Error in antilink handler:', error);
        }
      }
    }
    
    // Return early for non-group messages with no recognizable content
    if (!content || actualMessageTypes.length === 0) return;

    // Track group message statistics — ONLY real user messages, not protocol/
    // reactions/edits/poll-updates/system events. groupstats and myactivity
    // were over-counting because every container event used to increment.
    if (isGroup && !msg.key.fromMe) {
      const REAL_MSG_TYPES = new Set([
        'conversation',
        'extendedTextMessage',
        'imageMessage',
        'videoMessage',
        'audioMessage',
        'stickerMessage',
        'documentMessage',
        'documentWithCaptionMessage',
        'contactMessage',
        'contactsArrayMessage',
        'locationMessage',
        'liveLocationMessage',
        'ptvMessage',
      ]);
      const isRealMessage = actualMessageTypes.some(t => REAL_MSG_TYPES.has(t));
      if (isRealMessage) {
        try {
          let statNum = resolveNum(sender, groupMetadata?.participants, config.sessionName);
          if (!statNum || statNum.length < 5) statNum = sender.replace('@s.whatsapp.net','').replace('@lid','').split(':')[0].replace(/\D/g,'');
          const statKey = `stats_${from.replace('@g.us','')}`;
          const today = new Date().toDateString();
          const stats = database.getBotSetting(statKey) || {total:0,today:0,date:'',users:{}};
          if (stats.date !== today) { stats.today = 0; stats.date = today; }
          stats.total  = (stats.total||0) + 1;
          stats.today  = (stats.today||0) + 1;
          if (statNum && statNum.length >= 7 && statNum.length <= 15) {
            stats.users = stats.users || {};
            stats.users[statNum] = (stats.users[statNum]||0) + 1;
          }
          database.setBotSetting(statKey, stats);
        } catch {}
      }
    }
    
    // 🔹 Button response should also check unwrapped content
    const btn = content.buttonsResponseMessage || msg.message?.buttonsResponseMessage;
    if (btn) {
      const buttonId = btn.selectedButtonId;
      const displayText = btn.selectedDisplayText;
      
      // Handle button clicks by routing to commands
      if (buttonId === 'btn_menu') {
        // Execute menu command
        const menuCmd = commands.get('menu');
        if (menuCmd) {
          await sock.sendMessage(from, { react: { text: '🫒', key: msg.key } }).catch(()=>{});
          await menuCmd.execute(sock, msg, [], {
            from,
            sender,
            isGroup,
            groupMetadata,
            isOwner: isOwner(sender),
            isAdmin: await isAdmin(sock, sender, from, groupMetadata),
            isBotAdmin: await isBotAdmin(sock, from, groupMetadata),
            isMod: isMod(sender),
            reply: (text) => sock.sendMessage(from, { text }, { quoted: msg }),
            react: (emoji = '🫒') => sock.sendMessage(from, { react: { text: emoji, key: msg.key } })
          });
        }
        return;
      } else if (buttonId === 'btn_ping') {
        // Execute ping command
        const pingCmd = commands.get('ping');
        if (pingCmd) {
          await sock.sendMessage(from, { react: { text: '🫒', key: msg.key } }).catch(()=>{});
          await pingCmd.execute(sock, msg, [], {
            from,
            sender,
            isGroup,
            groupMetadata,
            isOwner: isOwner(sender),
            isAdmin: await isAdmin(sock, sender, from, groupMetadata),
            isBotAdmin: await isBotAdmin(sock, from, groupMetadata),
            isMod: isMod(sender),
            reply: (text) => sock.sendMessage(from, { text }, { quoted: msg }),
            react: (emoji = '🫒') => sock.sendMessage(from, { react: { text: emoji, key: msg.key } })
          });
        }
        return;
      } else if (buttonId === 'btn_help') {
        // Execute list command again (help)
        const listCmd = commands.get('list');
        if (listCmd) {
          await sock.sendMessage(from, { react: { text: '🫒', key: msg.key } }).catch(()=>{});
          await listCmd.execute(sock, msg, [], {
            from,
            sender,
            isGroup,
            groupMetadata,
            isOwner: isOwner(sender),
            isAdmin: await isAdmin(sock, sender, from, groupMetadata),
            isBotAdmin: await isBotAdmin(sock, from, groupMetadata),
            isMod: isMod(sender),
            reply: (text) => sock.sendMessage(from, { text }, { quoted: msg }),
            react: (emoji = '🫒') => sock.sendMessage(from, { react: { text: emoji, key: msg.key } })
          });
        }
        return;
      }
    }
    
    // Get message body from unwrapped content
    let body = '';
    if (content.conversation) {
      body = content.conversation;
    } else if (content.extendedTextMessage) {
      body = content.extendedTextMessage.text || '';
    } else if (content.imageMessage) {
      body = content.imageMessage.caption || '';
    } else if (content.videoMessage) {
      body = content.videoMessage.caption || '';
    }
    
    body = (body || '').trim();
    
    // Check antiall protection (owner only feature)
    if (isGroup) {
      const groupSettings = database.getGroupSettings(from);
      if (groupSettings.antiall) {
        const senderIsAdmin = await isAdmin(sock, sender, from, groupMetadata);
        const senderIsOwner = isOwner(sender);
        
        if (!senderIsAdmin && !senderIsOwner) {
          const botIsAdmin = await isBotAdmin(sock, from, groupMetadata);
          if (botIsAdmin) {
            await sock.sendMessage(from, { delete: msg.key });
            return;
          }
        }
      }
      
      // Anti-tag protection (check BEFORE text check, as tagall can have no text)
      if (groupSettings.antitag && !msg.key.fromMe) {
        const ctx = content.extendedTextMessage?.contextInfo;
        const mentionedJids = ctx?.mentionedJid || [];
        
        const messageText = (
          body ||
          content.imageMessage?.caption ||
          content.videoMessage?.caption ||
          ''
        );
        
        const textMentions = messageText.match(/@[\d+\s\-()~.]+/g) || [];
        const numericMentions = messageText.match(/@\d{10,}/g) || [];
        
        const uniqueNumericMentions = new Set();
        numericMentions.forEach((mention) => {
          const numMatch = mention.match(/@(\d+)/);
          if (numMatch) uniqueNumericMentions.add(numMatch[1]);
        });
        
        const mentionedJidCount = mentionedJids.length;
        const numericMentionCount = uniqueNumericMentions.size;
        const totalMentions = Math.max(mentionedJidCount, numericMentionCount);
        
        if (totalMentions >= 3) {
          try {
            const participants = groupMetadata.participants || [];
            const mentionThreshold = Math.max(3, Math.ceil(participants.length * 0.5));
            const hasManyNumericMentions = numericMentionCount >= 10 ||
              (numericMentionCount >= 5 && numericMentionCount >= mentionThreshold);
            
            if (totalMentions >= 3) { // trigger on any mass tag (3+)
              const senderIsAdmin = await isAdmin(sock, sender, from, groupMetadata);
              const senderIsOwner = isOwner(sender);
              
              if (!senderIsAdmin && !senderIsOwner) {
                const action = (groupSettings.antitagAction || 'delete').toLowerCase();
                
                if (action === 'delete') {
                  try {
                    await sock.sendMessage(from, { delete: msg.key });
                    await sock.sendMessage(from, { 
                      text: '⚠️ *Tagall Detected!*',
                      mentions: [sender]
                    }, { quoted: msg });
                  } catch (e) {
                    console.error('Failed to delete tagall message:', e);
                  }
                } else if (action === 'kick') {
                  try {
                    await sock.sendMessage(from, { delete: msg.key });
                  } catch (e) {
                    console.error('Failed to delete tagall message:', e);
                  }
                  
                  const botIsAdmin = await isBotAdmin(sock, from, groupMetadata);
                  if (botIsAdmin) {
                    try {
                      await sock.groupParticipantsUpdate(from, [sender], 'remove');
                    } catch (e) {
                      console.error('Failed to kick for antitag:', e);
                    }
                    // Resolve real phone for clickable @mention (not raw LID digits)
                    let tagPhone = resolveNum(sender, groupMetadata?.participants, config.sessionName);
                    if (!tagPhone || tagPhone.length < 7 || tagPhone.length > 15) {
                      tagPhone = sender.split('@')[0].split(':')[0];
                    }
                    const tagMentionJid = (tagPhone.length >= 7 && tagPhone.length <= 15)
                      ? `${tagPhone}@s.whatsapp.net` : sender;
                    await sock.sendMessage(from, {
                      text: `🚫 *Antitag Detected!*\n\n@${tagPhone} has been kicked for tagging all members.`,
                      mentions: [tagMentionJid],
                    }, { quoted: msg });
                  }
                }
                return;
              }
            }
          } catch (e) {
            console.error('Error during anti-tag enforcement:', e);
          }
        }
      }
    }
    
    // AutoSticker feature - convert images/videos to stickers automatically
    if (isGroup) { // Process all messages in groups (including bot's own messages)
      const groupSettings = database.getGroupSettings(from);
      if (groupSettings.autosticker) {
        const mediaMessage = content?.imageMessage || content?.videoMessage;
        if (mediaMessage && !body.startsWith(database.getPrefix()) && !msg.key.fromMe) {
          try {
            const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
            const { exec } = require('child_process');
            const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
            const path = require('path');
            const { getTempDir, deleteTempFile } = require('./utils/tempManager');
            const isVid = !!content.videoMessage;
            const mtype = isVid ? 'video' : 'image';
            const stream = await downloadContentFromMessage(mediaMessage, mtype);
            const chunks = [];
            for await (const chunk of stream) chunks.push(chunk);
            const buf = Buffer.concat(chunks);
            if (buf && buf.length > 0) {
              const ts = Date.now();
              const inF  = path.join(getTempDir(), `as_in_${ts}`);
              const outF = path.join(getTempDir(), `as_out_${ts}.webp`);
              require('fs').writeFileSync(inF, buf);
              const cmd = isVid
                ? `"${FFMPEG}" -i "${inF}" -vf "scale=512:512:force_original_aspect_ratio=decrease,fps=15" -vcodec libwebp -loop 0 -preset picture -an -vsync 0 -t 6 "${outF}" -y`
                : `"${FFMPEG}" -i "${inF}" -vf "scale=512:512:force_original_aspect_ratio=decrease" -vcodec libwebp "${outF}" -y`;
              await new Promise((res, rej) => exec(cmd, e => e ? rej(e) : res()));
              const webp = require('fs').readFileSync(outF);
              await sock.sendMessage(from, { sticker: webp }, { quoted: msg });
              deleteTempFile(inF); deleteTempFile(outF);
              return;
            }
          } catch (e) { console.error('[AutoSticker]:', e.message); }
        }
      }
    }

    // Banned users check — bot-level block
    if (!isOwner(sender) && !isMod(sender) && database.isBanned && database.isBanned(sender)) return;

    // Mode check — uses database so .mode command works dynamically
    const botMode = database.getMode();
    if (botMode === 'private' && !isOwner(sender) && !isMod(sender)) return;
    if (botMode === 'group' && !isGroup) return;

    // Prefix check
    const activePrefix = database.getPrefix();
    if (!body.startsWith(activePrefix)) return;

    // Parse command name and args
    const args = body.slice(activePrefix.length).trim().split(/\s+/);
    const commandName = args.shift().toLowerCase();
    if (!commandName) return;

    // Look up command
    const command = commands.get(commandName);
    if (!command) return;

    // Permission checks
    if (command.ownerOnly && !isOwner(sender)) {
      return sock.sendMessage(from, { text: config.messages.ownerOnly }, { quoted: msg });
    }
    
    if (command.modOnly && !isOwner(sender) && !isMod(sender)) {
      return sock.sendMessage(from, { text: '🔒 This command is only for moderators!' }, { quoted: msg });
    }
    
    if (command.groupOnly && !isGroup) {
      return sock.sendMessage(from, { text: config.messages.groupOnly }, { quoted: msg });
    }
    
    if (command.privateOnly && isGroup) {
      return sock.sendMessage(from, { text: config.messages.privateOnly }, { quoted: msg });
    }
    
    // Owner + Sudo bypass admin requirement in all groups, even if not actual admin
    if (command.adminOnly && !isOwner(sender) && !isMod(sender) && !(await isAdmin(sock, sender, from, groupMetadata))) {
      return sock.sendMessage(from, { text: config.messages.adminOnly }, { quoted: msg });
    }
    
    if (command.botAdminNeeded && !isOwner(sender)) {
      const botIsAdmin = await isBotAdmin(sock, from, groupMetadata);
      if (!botIsAdmin) {
        return sock.sendMessage(from, { text: config.messages.botAdminNeeded }, { quoted: msg });
      }
    }
    
    // (Stats are tracked once above using resolveNum — duplicate raw-digit
    // tracker removed to prevent LID pollution of the users map.)

    // Auto-typing (non-blocking for speed)
    if (config.autoTyping) {
      sock.sendPresenceUpdate('composing', from).catch(()=>{});
    }
    
    // Execute command
    console.log(`Executing command: ${commandName} from ${sender}`);
    
    // Resolve real phone number via centralised LID resolver
    let resolvedSenderNum = resolveNum(sender, groupMetadata?.participants, config.sessionName);
    if (!resolvedSenderNum || resolvedSenderNum.length < 5) {
      resolvedSenderNum = sender.replace('@s.whatsapp.net','').replace('@lid','').split(':')[0].replace(/\D/g,'');
    }

    // Track command usage with resolved number
    try { database.trackCmd(resolvedSenderNum || sender.split('@')[0].replace(/\D/g,'')); } catch {}

    const _isBotAdmin = await isBotAdmin(sock, from, groupMetadata);

    await sock.sendMessage(from, { react: { text: '🫒', key: msg.key } }).catch(()=>{});
    await command.execute(sock, msg, args, {
      from,
      sender,
      senderNum: resolvedSenderNum,
      isGroup,
      groupMetadata,
      isOwner: isOwner(sender),
      isAdmin: await isAdmin(sock, sender, from, groupMetadata),
      isBotAdmin: _isBotAdmin,
      isBotAdminFn: () => isBotAdmin(sock, from, groupMetadata),
      isMod: isMod(sender),
      pushName: msg.pushName || resolvedSenderNum,
      reply: (text) => sock.sendMessage(from, { text }, { quoted: msg }),
      react: (emoji = '🫒') => sock.sendMessage(from, { react: { text: emoji, key: msg.key } })
    });
    
  } catch (error) {
    const errMsg = error?.message || '';
    // Silently ignore non-critical errors
    if (errMsg.includes('rate-overlimit') ||
        errMsg.includes('not-authorized') ||
        errMsg.includes('forbidden') ||
        errMsg.includes('command is not defined') ||
        errMsg.includes('Cannot read properties of undefined')) {
      return;
    }
    console.error('[Handler Error]:', errMsg);
    try {
      await sock.sendMessage(from || msg.key.remoteJid, {
        text: `❌ Error: ${errMsg}`
      }, { quoted: msg });
    } catch {}
  }
};

const handleGroupUpdate = async (sock, update) => {
  try {
    const { id, participants, action } = update;
    
    // Validate group JID before processing
    if (!id || !id.endsWith('@g.us')) {
      return;
    }
    
    const groupSettings = database.getGroupSettings(id);
    
    if (!groupSettings.welcome && !groupSettings.goodbye) return;
    
    const groupMetadata = await getGroupMetadata(sock, id);
    if (!groupMetadata) return; // Skip if metadata unavailable (forbidden or error)
    
    // Helper to extract participant JID
    const getParticipantJid = (participant) => {
      if (typeof participant === 'string') {
        return participant;
      }
      if (participant && participant.id) {
        return participant.id;
      }
      if (participant && typeof participant === 'object') {
        // Try to find JID in object
        return participant.jid || participant.participant || null;
      }
      return null;
    };
    
    for (const participant of participants) {
      const participantJid = getParticipantJid(participant);
      if (!participantJid) {
        console.warn('Could not extract participant JID:', participant);
        continue;
      }
      
      const participantNumber = participantJid.split('@')[0];
      
      if (action === 'add' && groupSettings.welcome) {
        // ── If user set a custom template via .setwelcome, send EXACTLY that ──
        // Replace @user with a clickable mention to the new member, @group with
        // the group subject, and #memberCount with the live member count. No
        // image, no extra text, no decoration — bot sends the raw template.
        if (groupSettings.welcomeMessage && groupSettings.welcomeMessage.trim()) {
          try {
            let message = groupSettings.welcomeMessage;
            message = message.replace(/@user/g, `@${participantNumber}`);
            message = message.replace(/@group/g, groupMetadata.subject || 'the group');
            message = message.replace(/#memberCount/g, groupMetadata.participants.length);
            await sock.sendMessage(id, {
              text: message,
              mentions: [participantJid]
            });
          } catch (sendErr) {
            console.error('Welcome (custom) send error:', sendErr);
          }
          continue;
        }
        try {
          // Get user's display name - find participant using phoneNumber or JID
          let displayName = participantNumber;
          
          // Try to find participant in group metadata
          const participantInfo = groupMetadata.participants.find(p => {
            const pId = p.id || p.jid || p.participant;
            const pPhone = p.phoneNumber;
            // Match by JID or phoneNumber
            return pId === participantJid || 
                   pId?.split('@')[0] === participantNumber ||
                   pPhone === participantJid ||
                   pPhone?.split('@')[0] === participantNumber;
          });
          
          // Get phoneNumber JID to fetch contact name
          let phoneJid = null;
          if (participantInfo && participantInfo.phoneNumber) {
            phoneJid = participantInfo.phoneNumber;
          } else {
            // Try to normalize participantJid to phoneNumber format
            // If it's a LID, try to convert to phoneNumber
            try {
              const normalized = normalizeJidWithLid(participantJid);
              if (normalized && normalized.includes('@s.whatsapp.net')) {
                phoneJid = normalized;
              }
            } catch (e) {
              // If normalization fails, try using participantJid directly if it's a valid JID
              if (participantJid.includes('@s.whatsapp.net')) {
                phoneJid = participantJid;
              }
            }
          }
          
          // Try to get contact name from phoneNumber JID
          if (phoneJid) {
            try {
              // Method 1: Try to get from contact store if available
              if (sock.store && sock.store.contacts && sock.store.contacts[phoneJid]) {
                const contact = sock.store.contacts[phoneJid];
                if (contact.notify && contact.notify.trim() && !contact.notify.match(/^\d+$/)) {
                  displayName = contact.notify.trim();
                } else if (contact.name && contact.name.trim() && !contact.name.match(/^\d+$/)) {
                  displayName = contact.name.trim();
                }
              }
              
              // Method 2: Try to fetch contact using onWhatsApp and then check store
              if (displayName === participantNumber) {
                try {
                  await sock.onWhatsApp(phoneJid);
                  
                  // After onWhatsApp, check store again (might populate after check)
                  if (sock.store && sock.store.contacts && sock.store.contacts[phoneJid]) {
                    const contact = sock.store.contacts[phoneJid];
                    if (contact.notify && contact.notify.trim() && !contact.notify.match(/^\d+$/)) {
                      displayName = contact.notify.trim();
                    }
                  }
                } catch (fetchError) {
                  // Silently handle fetch errors
                }
              }
            } catch (contactError) {
              // Silently handle contact errors
            }
          }
          
          // Final fallback: use participantInfo.notify or name if available
          if (displayName === participantNumber && participantInfo) {
            if (participantInfo.notify && participantInfo.notify.trim() && !participantInfo.notify.match(/^\d+$/)) {
              displayName = participantInfo.notify.trim();
            } else if (participantInfo.name && participantInfo.name.trim() && !participantInfo.name.match(/^\d+$/)) {
              displayName = participantInfo.name.trim();
            }
          }
          
          // Get user's profile picture URL
          let profilePicUrl = '';
          try {
            profilePicUrl = await sock.profilePictureUrl(participantJid, 'image');
          } catch (ppError) {
            // If profile picture not available, use default avatar
            profilePicUrl = 'https://img.pyrocdn.com/dbKUgahg.png';
          }
          
          // Get group name and description
          const groupName = groupMetadata.subject || 'the group';
          const groupDesc = groupMetadata.desc || 'No description';
          
          // Get current time string
          const now = new Date();
          const timeString = now.toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit',
            hour12: true 
          });
          
          // Create formatted welcome message
          const welcomeMsg = `╭╼━≪•𝙽𝙴𝚆 𝙼𝙴𝙼𝙱𝙴𝚁•≫━╾╮\n┃𝚆𝙴𝙻𝙲𝙾𝙼𝙴: @${displayName} 👋\n┃Member count: #${groupMetadata.participants.length}\n┃𝚃𝙸𝙼𝙴: ${timeString}⏰\n╰━━━━━━━━━━━━━━━╯\n\n*@${displayName}* Welcome to *${groupName}*! 🎉\n*Group 𝙳𝙴𝚂𝙲𝚁𝙸𝙿𝚃𝙸𝙾𝙽*\n${groupDesc}\n\n> *ᴘᴏᴡᴇʀᴇᴅ ʙʏ ${config.botName}*`;

          // Fetch welcome image using a working API chain
          let imageBuffer = null;
          const welcomeApis = [
            // 1. bintang API (Indonesian public bot API — reliable)
            async () => {
              const r = await axios.get(
                `https://api.bintangiop.my.id/api/welcome?username=${encodeURIComponent(displayName)}&groupname=${encodeURIComponent(groupName)}&members=${groupMetadata.participants.length}&avatar=${encodeURIComponent(profilePicUrl)}`,
                { responseType: 'arraybuffer', timeout: 20000 }
              );
              const buf = Buffer.from(r.data);
              if (buf.length < 5000) throw new Error('too small');
              return buf;
            },
            // 2. siputzx welcome card
            async () => {
              const r = await axios.get(
                `https://api.siputzx.my.id/api/m/welcome?bg=https://img.pyrocdn.com/dbKUgahg.png&username=${encodeURIComponent(displayName)}&members=${encodeURIComponent('Members: ' + groupMetadata.participants.length)}&avatar=${encodeURIComponent(profilePicUrl)}`,
                { responseType: 'arraybuffer', timeout: 20000 }
              );
              const buf = Buffer.from(r.data);
              if (buf.length < 5000) throw new Error('too small');
              return buf;
            },
            // 3. ryzendesu welcome card
            async () => {
              const r = await axios.get(
                `https://api.ryzendesu.vip/api/image/welcome?username=${encodeURIComponent(displayName)}&guildName=${encodeURIComponent(groupName)}&memberCount=${groupMetadata.participants.length}&avatar=${encodeURIComponent(profilePicUrl)}`,
                { responseType: 'arraybuffer', timeout: 20000 }
              );
              const buf = Buffer.from(r.data);
              if (buf.length < 5000) throw new Error('too small');
              return buf;
            },
          ];
          for (const apiFn of welcomeApis) {
            try { imageBuffer = await apiFn(); break; } catch {}
          }

          if (imageBuffer) {
            // Send the welcome image with formatted caption
            await sock.sendMessage(id, { 
              image: imageBuffer,
              caption: welcomeMsg,
              mentions: [participantJid] 
            });
          } else {
            // Fallback: send the profile picture with the welcome caption
            try {
              const ppBuf = profilePicUrl && !profilePicUrl.includes('pyrocdn')
                ? Buffer.from((await axios.get(profilePicUrl, { responseType: 'arraybuffer', timeout: 10000 })).data)
                : null;
              if (ppBuf) {
                await sock.sendMessage(id, { image: ppBuf, caption: welcomeMsg, mentions: [participantJid] });
              } else {
                throw new Error('no pp');
              }
            } catch {
              await sock.sendMessage(id, { text: welcomeMsg, mentions: [participantJid] });
            }
          }
        } catch (welcomeError) {
          // Fallback to text message if image generation fails
          console.error('Welcome image error:', welcomeError);
          let message = 'Welcome @user to @group! 👋\nEnjoy your stay!';
          message = message.replace(/@user/g, `@${participantNumber}`);
          message = message.replace(/@group/g, groupMetadata.subject || 'the group');
          
          await sock.sendMessage(id, { 
            text: message, 
            mentions: [participantJid] 
          });
        }
      } else if (action === 'remove' && groupSettings.goodbye) {
        // ── If user set a custom template via .setgoodbye, send EXACTLY that ──
        if (groupSettings.goodbyeMessage && groupSettings.goodbyeMessage.trim()) {
          try {
            let message = groupSettings.goodbyeMessage;
            message = message.replace(/@user/g, `@${participantNumber}`);
            message = message.replace(/@group/g, groupMetadata.subject || 'the group');
            message = message.replace(/#memberCount/g, groupMetadata.participants.length);
            await sock.sendMessage(id, {
              text: message,
              mentions: [participantJid]
            });
          } catch (sendErr) {
            console.error('Goodbye (custom) send error:', sendErr);
          }
          continue;
        }
        try {
          // Get user's display name - find participant using phoneNumber or JID
          let displayName = participantNumber;

          // Step 1: Look in the fresh metadata (works only if cache wasn't
          // already refreshed past the removal).
          let participantInfo = groupMetadata.participants.find(p => {
            const pId = p.id || p.jid || p.participant;
            const pPhone = p.phoneNumber;
            return pId === participantJid ||
                   pId?.split('@')[0] === participantNumber ||
                   pPhone === participantJid ||
                   pPhone?.split('@')[0] === participantNumber;
          });

          // Step 2: Fall back to the long-lived snapshot — this is THE fix
          // for "goodbye fires after removal so user is gone from metadata".
          // The snapshot keeps the user's info for 24h after their last seen
          // membership, so we can always greet them goodbye properly.
          if (!participantInfo) {
            participantInfo = recallParticipant(id, participantJid);
          }
          
          // Get phoneNumber JID to fetch contact name
          let phoneJid = null;
          if (participantInfo && participantInfo.phoneNumber) {
            phoneJid = participantInfo.phoneNumber;
          } else {
            // Try to normalize participantJid to phoneNumber format
            try {
              const normalized = normalizeJidWithLid(participantJid);
              if (normalized && normalized.includes('@s.whatsapp.net')) {
                phoneJid = normalized;
              }
            } catch (e) {
              if (participantJid.includes('@s.whatsapp.net')) {
                phoneJid = participantJid;
              }
            }
          }
          
          // Try to get contact name from phoneNumber JID
          if (phoneJid) {
            try {
              // Method 1: Try to get from contact store if available
              if (sock.store && sock.store.contacts && sock.store.contacts[phoneJid]) {
                const contact = sock.store.contacts[phoneJid];
                if (contact.notify && contact.notify.trim() && !contact.notify.match(/^\d+$/)) {
                  displayName = contact.notify.trim();
                } else if (contact.name && contact.name.trim() && !contact.name.match(/^\d+$/)) {
                  displayName = contact.name.trim();
                }
              }
              
              // Method 2: Try to fetch contact using onWhatsApp and then check store
              if (displayName === participantNumber) {
                try {
                  await sock.onWhatsApp(phoneJid);
                  
                  // After onWhatsApp, check store again
                  if (sock.store && sock.store.contacts && sock.store.contacts[phoneJid]) {
                    const contact = sock.store.contacts[phoneJid];
                    if (contact.notify && contact.notify.trim() && !contact.notify.match(/^\d+$/)) {
                      displayName = contact.notify.trim();
                    }
                  }
                } catch (fetchError) {
                  // Silently handle fetch errors
                }
              }
            } catch (contactError) {
              // Silently handle contact errors
            }
          }
          
          // Final fallback: use participantInfo.notify or name if available
          if (displayName === participantNumber && participantInfo) {
            if (participantInfo.notify && participantInfo.notify.trim() && !participantInfo.notify.match(/^\d+$/)) {
              displayName = participantInfo.notify.trim();
            } else if (participantInfo.name && participantInfo.name.trim() && !participantInfo.name.match(/^\d+$/)) {
              displayName = participantInfo.name.trim();
            }
          }
          
          // Get user's profile picture URL
          let profilePicUrl = '';
          try {
            profilePicUrl = await sock.profilePictureUrl(participantJid, 'image');
          } catch (ppError) {
            // If profile picture not available, use default avatar
            profilePicUrl = 'https://img.pyrocdn.com/dbKUgahg.png';
          }
          
          // Get group name and description
          const groupName = groupMetadata.subject || 'the group';
          const groupDesc = groupMetadata.desc || 'No description';
          
          // Get current time string
          const now = new Date();
          const timeString = now.toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit',
            hour12: true 
          });
          
          // Create simple goodbye message
          const goodbyeMsg = `Goodbye @${displayName} 👋 We will never miss you!`;
          
          // Fetch goodbye image using a working API chain
          let imageBuffer = null;
          const goodbyeApis = [
            // 1. bintang API goodbye
            async () => {
              const r = await axios.get(
                `https://api.bintangiop.my.id/api/goodbye?username=${encodeURIComponent(displayName)}&groupname=${encodeURIComponent(groupName)}&members=${groupMetadata.participants.length}&avatar=${encodeURIComponent(profilePicUrl)}`,
                { responseType: 'arraybuffer', timeout: 20000 }
              );
              const buf = Buffer.from(r.data);
              if (buf.length < 5000) throw new Error('too small');
              return buf;
            },
            // 2. siputzx goodbye card
            async () => {
              const r = await axios.get(
                `https://api.siputzx.my.id/api/m/goodbye?bg=https://img.pyrocdn.com/dbKUgahg.png&username=${encodeURIComponent(displayName)}&members=${encodeURIComponent('Members: ' + groupMetadata.participants.length)}&avatar=${encodeURIComponent(profilePicUrl)}`,
                { responseType: 'arraybuffer', timeout: 20000 }
              );
              const buf = Buffer.from(r.data);
              if (buf.length < 5000) throw new Error('too small');
              return buf;
            },
            // 3. ryzendesu goodbye card
            async () => {
              const r = await axios.get(
                `https://api.ryzendesu.vip/api/image/goodbye?username=${encodeURIComponent(displayName)}&guildName=${encodeURIComponent(groupName)}&memberCount=${groupMetadata.participants.length}&avatar=${encodeURIComponent(profilePicUrl)}`,
                { responseType: 'arraybuffer', timeout: 20000 }
              );
              const buf = Buffer.from(r.data);
              if (buf.length < 5000) throw new Error('too small');
              return buf;
            },
          ];
          for (const apiFn of goodbyeApis) {
            try { imageBuffer = await apiFn(); break; } catch {}
          }

          if (imageBuffer) {
            // Send the goodbye image with caption
            await sock.sendMessage(id, { 
              image: imageBuffer,
              caption: goodbyeMsg,
              mentions: [participantJid] 
            });
          } else {
            // Fallback: send profile picture with goodbye caption
            try {
              const ppBuf = profilePicUrl && !profilePicUrl.includes('pyrocdn')
                ? Buffer.from((await axios.get(profilePicUrl, { responseType: 'arraybuffer', timeout: 10000 })).data)
                : null;
              if (ppBuf) {
                await sock.sendMessage(id, { image: ppBuf, caption: goodbyeMsg, mentions: [participantJid] });
              } else {
                throw new Error('no pp');
              }
            } catch {
              await sock.sendMessage(id, { text: goodbyeMsg, mentions: [participantJid] });
            }
          }
        } catch (goodbyeError) {
          // Fallback to simple goodbye message
          console.error('Goodbye error:', goodbyeError);
          const goodbyeMsg = `Goodbye @${participantNumber} 👋 We will never miss you! 💀`;
          
          await sock.sendMessage(id, { 
            text: goodbyeMsg, 
            mentions: [participantJid] 
          });
        }
      }
    }
  } catch (error) {
    // Silently handle forbidden errors and other group metadata errors
    if (error.message && (
      error.message.includes('forbidden') || 
      error.message.includes('403') ||
      error.statusCode === 403 ||
      error.output?.statusCode === 403 ||
      error.data === 403
    )) {
      // Silently skip forbidden groups
      return;
    }
    // Only log non-forbidden errors
    if (!error.message || !error.message.includes('forbidden')) {
      console.error('Error handling group update:', error);
    }
  }
};

// Antilink handler — only matches real URLs
const handleAntilink = async (sock, msg, groupMetadata) => {
  try {
    const from   = msg.key.remoteJid;
    const sender = msg.key.participant || msg.key.remoteJid;
    const gs     = database.getGroupSettings(from);
    if (!gs.antilink) return;

    const body = (
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      msg.message?.videoMessage?.caption || ''
    );
    if (!body) return;

    // Match WhatsApp group links, http/https URLs, and common short link domains
    const hasLink = /https?:\/\/[^\s]+/.test(body) ||
                    /chat\.whatsapp\.com\/[a-zA-Z0-9]+/.test(body) ||
                    /(?:^|\s)(t\.me|wa\.me|bit\.ly|tinyurl\.com|shorturl\.at)\/[^\s]+/.test(body);

    if (!hasLink) return;

    const senderIsAdmin = await isAdmin(sock, sender, from, groupMetadata);
    const senderIsOwner = isOwner(sender);
    if (senderIsAdmin || senderIsOwner || isMod(sender)) return;

    const botIsAdmin = await isBotAdmin(sock, from, groupMetadata);
    const action     = (gs.antilinkAction || 'delete').toLowerCase();
    // Resolve real phone number for @mention (not LID)
    const senderPhone = resolveNum(sender, groupMetadata?.participants) || sender.split('@')[0].split(':')[0];
    const mentionJid  = senderPhone.length >= 7 && senderPhone.length <= 15
      ? `${senderPhone}@s.whatsapp.net` : sender;

    // Step 1: DELETE the message first (always, if bot is admin)
    if (botIsAdmin) {
      try { await sock.sendMessage(from, { delete: msg.key }); } catch (delErr) {
        console.error('antilink delete failed:', delErr.message);
      }
    }

    // Step 2: warn or kick
    if (action === 'kick' && botIsAdmin) {
      try { await sock.groupParticipantsUpdate(from, [sender], 'remove'); } catch {}
      await sock.sendMessage(from, {
        text: `🔗 @${senderPhone} was removed for sending a link.`,
        mentions: [mentionJid]
      }).catch(() => {});
    } else {
      await sock.sendMessage(from, {
        text: `⚠️ @${senderPhone} links are not allowed here!`,
        mentions: [mentionJid]
      }).catch(() => {});
    }
  } catch (e) {
    console.error('handleAntilink:', e.message);
  }
};


// Anti-group mention handler — detects @everyone/@all AND tagged group JID
const handleAntigroupmention = async (sock, msg, groupMetadata) => {
  try {
    const from   = msg.key.remoteJid;
    const sender = msg.key.participant || msg.key.remoteJid;
    const gs     = database.getGroupSettings(from);
    if (!gs.antigroupmention) return;

    const senderIsAdmin = await isAdmin(sock, sender, from, groupMetadata);
    const senderIsOwner = isOwner(sender);
    if (senderIsAdmin || senderIsOwner || isMod(sender)) return;

    const body = (
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      msg.message?.videoMessage?.caption || ''
    ).toLowerCase();

    // Collect ALL mentioned JIDs from all possible message contexts
    const mentionedJids = [
      ...(msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || []),
      ...(msg.message?.imageMessage?.contextInfo?.mentionedJid || []),
      ...(msg.message?.videoMessage?.contextInfo?.mentionedJid || []),
    ];
    const groupJid = from;

    // Detect @everyone/@all in text
    const hasEveryone = body.includes('@everyone') || body.includes('@all');
    // Detect group JID mentioned (story mention)
    const groupMentioned = mentionedJids.some(j => j === groupJid || j?.includes(groupJid.split('@')[0]));
    // Detect groupStatusMentionMessage (WhatsApp story mention notification)
    const isStatusMention = !!(msg.message?.groupStatusMentionMessage || 
                                msg.message?.messageContextInfo?.messageAddOnDuration ||
                                msg.message?.statusMentionMessage);

    if (!hasEveryone && !groupMentioned && !isStatusMention) return;

    const botIsAdmin = await isBotAdmin(sock, from, groupMetadata);
    const action     = (gs.antigroupmentionAction || 'delete').toLowerCase();

    // Resolve real phone number for @mention (not LID)
    const senderPhone2 = resolveNum(sender, groupMetadata?.participants) || sender.split('@')[0].split(':')[0];
    const mentionJid2  = senderPhone2.length >= 7 && senderPhone2.length <= 15
      ? `${senderPhone2}@s.whatsapp.net` : sender;

    // Step 1: DELETE the message first (always, if bot is admin)
    if (botIsAdmin) {
      try { await sock.sendMessage(from, { delete: msg.key }); } catch (delErr) {
        console.error('antigroupmention delete failed:', delErr.message);
      }
    }

    // Step 2: warn or kick
    if (action === 'kick' && botIsAdmin) {
      try { await sock.groupParticipantsUpdate(from, [sender], 'remove'); } catch {}
      await sock.sendMessage(from, {
        text: `🚫 @${senderPhone2} was removed for group mention.`,
        mentions: [mentionJid2]
      }).catch(() => {});
    } else {
      await sock.sendMessage(from, {
        text: `⚠️ @${senderPhone2} group mentions are not allowed here!`,
        mentions: [mentionJid2]
      }).catch(() => {});
    }
  } catch (e) {
    console.error('handleAntigroupmention:', e.message);
  }
};


// Anti-call feature initializer
const initializeAntiCall = (sock) => {
  // Anti-call feature - reject and block incoming calls
  sock.ev.on('call', async (calls) => {
    try {
      // Reload config to get fresh settings
      delete require.cache[require.resolve('./config')];
      const config = require('./config');
      
      if (!config.defaultGroupSettings.anticall) return;

      for (const call of calls) {
        if (call.status === 'offer') {
          // Reject the call
          await sock.rejectCall(call.id, call.from);

          // Block the caller
          await sock.updateBlockStatus(call.from, 'block');

          // Notify user
          await sock.sendMessage(call.from, {
            text: '🚫 Calls are not allowed. You have been blocked.'
          });
        }
      }
    } catch (err) {
      console.error('[ANTICALL ERROR]', err);
    }
  });
};


// Anti-call feature
let antiCallEnabled = false;
const initAntiCall = (sock) => { initializeAntiCall(sock); };
const setAntiCall = (v) => { antiCallEnabled = v; };

module.exports = {
  handleMessage,
  handleGroupUpdate,
  handleAntilink,
  handleAntigroupmention,
  initializeAntiCall,
  isOwner,
  isAdmin,
  isBotAdmin,
  isMod,
  getGroupMetadata,
  findParticipant,
  reloadCommands,
  initAntiCall,
  setAntiCall,
  antiCallEnabled
};
