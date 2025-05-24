import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import http from 'http';
import pino from 'pino';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  makeWASocket,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  delay,
  isJidGroup,
  Browsers,
  downloadMediaMessage
} from '@whiskeysockets/baileys';
import { File } from 'megajs';
import moment from 'moment-timezone';
import ytSearch from 'yt-search';
import fetch from 'node-fetch';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const logger = pino({
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
  level: 'info'
});

moment.tz.setDefault('Africa/Nairobi');

// Configuration
const config = {
  SESSION_NAME: process.env.SESSION_NAME || 'Demon-Slayer',
  OWNER_NUMBER: process.env.OWNER_NUMBER || '',
  CHANNEL_JID: process.env.CHANNEL_JID || '120363299029326322@newsletter',
  CHANNEL_NAME: process.env.CHANNEL_NAME || "𝖒𝖆𝖗𝖎𝖘𝖊𝖑",
  REQUIRED_CHANNEL: '0029VajJoCoLI8YePbpsnE3q',
  TIMEZONE: 'Africa/Nairobi',
  ALWAYS_ONLINE: false,
  AUTO_TYPING: false,
  AUTO_RECORDING: false
};

const userSockets = new Map();
const sessionBasePath = path.join(__dirname, 'sessions');
const verifiedUsers = new Set();
const userSettings = new Map();
const gptStatusFile = path.resolve(__dirname, "gpt4o_status.json");

// Track bot start time for uptime
const startTime = new Date();

const apiUrls = [
  "https://api.siputzx.my.id/api/ai/deepseek-llm-67b-chat?content=",
  "https://vapis.my.id/api/gpt4o?q=",
  "https://vapis.my.id/api/gemini?q=",
  "https://vapis.my.id/api/luminai?q="
];

/* ==================== HELPER FUNCTIONS ==================== */

function getNairobiTime() {
  return moment().tz('Africa/Nairobi');
}

function formatUptime() {
  const now = new Date();
  const uptime = now - startTime;
  const days = Math.floor(uptime / (1000 * 60 * 60 * 24));
  const hours = Math.floor((uptime % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((uptime % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((uptime % (1000 * 60)) / 1000);
  
  return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

async function ensureSessionPath(userId) {
  const userPath = path.join(sessionBasePath, userId);
  try {
    await fs.mkdir(userPath, { recursive: true });
    return userPath;
  } catch (err) {
    logger.error(`Error creating session path: ${err}`);
    throw err;
  }
}

async function downloadSessionData(userId, sessionId) {
  try {
    let part;
    if (sessionId.includes("CLOUD-AI~")) {
      part = sessionId.split("CLOUD-AI~")[1];
    } else if (sessionId.includes("Demo-Slayer~")) {
      part = sessionId.split("Demo-Slayer~")[1];
    } else {
      throw new Error("Invalid session ID format");
    }

    const [fileID, key] = part.split("#");
    const file = File.fromURL(`https://mega.nz/file/${fileID}#${key}`);
    const data = await new Promise((resolve, reject) => {
      file.download((err, data) => err ? reject(err) : resolve(data));
    });

    const userPath = await ensureSessionPath(userId);
    await fs.writeFile(path.join(userPath, 'creds.json'), data);
    return true;
  } catch (err) {
    logger.error(`Session download failed: ${err}`);
    return false;
  }
}

async function updateBio(sock) {
  try {
    const now = getNairobiTime();
    const bio = `⏰ ${now.format('HH:mm:ss')} | ${now.format('dddd')} | 📅 ${now.format('D MMMM YYYY')} | Enjoying`;
    await sock.updateProfileStatus(bio);
  } catch (err) {
    logger.error(`Bio update failed: ${err}`);
  }
}

/* ==================== FEATURE MANAGEMENT ==================== */

async function manageAlwaysOnline(sock, userId, enable) {
  if (enable) {
    logger.info(`Enabling always online for ${userId}`);
    const interval = setInterval(async () => {
      try {
        await sock.sendPresenceUpdate('available');
        logger.debug(`Sent presence update for ${userId}`);
      } catch (err) {
        logger.error(`Always online error: ${err}`);
        clearInterval(interval);
      }
    }, 20000);

    userSettings.set(`${userId}-alwaysOnline`, interval);
    config.ALWAYS_ONLINE = true;
  } else {
    logger.info(`Disabling always online for ${userId}`);
    const interval = userSettings.get(`${userId}-alwaysOnline`);
    if (interval) clearInterval(interval);
    userSettings.delete(`${userId}-alwaysOnline`);
    config.ALWAYS_ONLINE = false;
  }
}

async function manageAutoTyping(sock, userId, enable) {
  if (enable) {
    logger.info(`Enabling auto typing for ${userId}`);
    const interval = setInterval(async () => {
      try {
        const chats = await sock.fetchBlocklist();
        const validChats = chats.filter(chat => !isJidGroup(chat));
        
        if (validChats.length > 0) {
          const recentMessages = await Promise.all(
            validChats.map(async chat => {
              const messages = await sock.fetchMessages(chat, { limit: 1 });
              return messages[0];
            })
          );
          
          const unrespondedChats = validChats.filter((chat, index) => {
            const msg = recentMessages[index];
            return msg && !msg.key.fromMe;
          });

          if (unrespondedChats.length > 0) {
            const randomChat = unrespondedChats[Math.floor(Math.random() * unrespondedChats.length)];
            await sock.sendPresenceUpdate('composing', randomChat);
            logger.debug(`Sent typing indicator to ${randomChat}`);
            await delay(2000);
            await sock.sendPresenceUpdate('paused', randomChat);
          }
        }
      } catch (err) {
        logger.error(`Auto typing error: ${err}`);
      }
    }, 30000);

    userSettings.set(`${userId}-autoTyping`, interval);
    config.AUTO_TYPING = true;
  } else {
    logger.info(`Disabling auto typing for ${userId}`);
    const interval = userSettings.get(`${userId}-autoTyping`);
    if (interval) clearInterval(interval);
    userSettings.delete(`${userId}-autoTyping`);
    config.AUTO_TYPING = false;
  }
}

async function manageAutoRecording(sock, userId, enable) {
  if (enable) {
    logger.info(`Enabling auto recording for ${userId}`);
    const interval = setInterval(async () => {
      try {
        const chats = await sock.fetchBlocklist();
        const validChats = chats.filter(chat => !isJidGroup(chat));
        
        if (validChats.length > 0) {
          const recentMessages = await Promise.all(
            validChats.map(async chat => {
              const messages = await sock.fetchMessages(chat, { limit: 1 });
              return messages[0];
            })
          );
          
          const unrespondedChats = validChats.filter((chat, index) => {
            const msg = recentMessages[index];
            return msg && !msg.key.fromMe;
          });

          if (unrespondedChats.length > 0) {
            const randomChat = unrespondedChats[Math.floor(Math.random() * unrespondedChats.length)];
            await sock.sendPresenceUpdate('recording', randomChat);
            logger.debug(`Sent recording indicator to ${randomChat}`);
            await delay(2000);
            await sock.sendPresenceUpdate('paused', randomChat);
          }
        }
      } catch (err) {
        logger.error(`Auto recording error: ${err}`);
      }
    }, 30000);

    userSettings.set(`${userId}-autoRecording`, interval);
    config.AUTO_RECORDING = true;
  } else {
    logger.info(`Disabling auto recording for ${userId}`);
    const interval = userSettings.get(`${userId}-autoRecording`);
    if (interval) clearInterval(interval);
    userSettings.delete(`${userId}-autoRecording`);
    config.AUTO_RECORDING = false;
  }
}

/* ==================== FEATURE HANDLERS ==================== */

// Ping Command Handler
async function handlePing(sock, msg) {
  const jid = msg.key.remoteJid;
  const start = Date.now();
  
  await sock.sendMessage(jid, { text: 'Testing response time...' }, { quoted: msg });
  
  const end = Date.now();
  const latency = end - start;
  
  await sock.sendMessage(jid, { 
    text: `🏓 Pong!\nResponse time: ${latency}ms\nUptime: ${formatUptime()}`
  }, { quoted: msg });
}

// Uptime Command Handler
async function handleUptime(sock, msg) {
  const jid = msg.key.remoteJid;
  await sock.sendMessage(jid, { 
    text: `⏱️ Bot Uptime: ${formatUptime()}`
  }, { quoted: msg });
}

// AI Chat Handler
async function handleAIChat(sock, msg) {
  const jid = msg.key.remoteJid;
  const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
  
  try {
    // Only respond to owner messages
    const botNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';
    const ownerNumber = config.OWNER_NUMBER + '@s.whatsapp.net';
    const sender = msg.key.participant || msg.key.remoteJid;
    const isOwner = sender === ownerNumber;
    const isBot = sender === botNumber;
    
    if (!isOwner && !isBot) return;

    const gptStatus = await readGptStatus();

    if (text.toLowerCase() === "deepseek on" || text.toLowerCase() === "deepseek off") {
      const enable = text.toLowerCase() === "deepseek on";
      await writeGptStatus(enable);
      await sock.sendMessage(jid, { text: `✅ AI has been ${enable ? "activated" : "deactivated"}.` }, { quoted: msg });
      return;
    }

    if (!gptStatus.enabled) return;

    await sock.sendMessage(jid, { react: { text: '💻', key: msg.key } });

    let reply = null;

    for (const baseUrl of apiUrls) {
      try {
        const response = await fetch(baseUrl + encodeURIComponent(text));
        if (!response.ok) {
          logger.error(`API failed: ${baseUrl}, status: ${response.status}`);
          continue;
        }

        const json = await response.json();
        reply = json.data || json.message;
        if (reply) break;

      } catch (err) {
        logger.error(`Error with API ${baseUrl}:`, err);
        continue;
      }
    }

    if (!reply) {
      await sock.sendMessage(jid, { text: "❌ All AI APIs failed. Please try again later." }, { quoted: msg });
      await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } });
      return;
    }

    await sock.sendMessage(jid, { text: reply }, { quoted: msg });
    await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } });

  } catch (err) {
    logger.error(`AI chat error: ${err}`);
  }
}

// YouTube Downloader Handler
async function handleYouTubeDownload(sock, msg) {
  const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
  const jid = msg.key.remoteJid;
  
  try {
    await sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } });
    
    const isVideo = text.toLowerCase().startsWith('video ');
    const query = text.replace(/^(play|video)\s*/i, '').trim();
    
    if (!query) {
      return await sock.sendMessage(jid, { 
        text: '❌ *Please provide a search query!*\nExample: `play despacito` or `video funny cats`' 
      }, { quoted: msg });
    }

    const searchResults = await ytSearch(query);
    if (!searchResults.videos.length) {
      return await sock.sendMessage(jid, { 
        text: '❌ *No results found!*' 
      }, { quoted: msg });
    }

    const video = searchResults.videos[0];
    const infoMsg = `╭━━━〔 *YouTube Downloader* 〕━━━
┃▸ *Title:* ${video.title}
┃▸ *Duration:* ${video.timestamp}
┃▸ *Views:* ${video.views}
┃▸ *Channel:* ${video.author.name}
╰━━━━━━━━━━━━━━━━━━

📥 *Downloading...*`;

    await sock.sendMessage(jid, {
      image: { url: video.thumbnail },
      caption: infoMsg
    }, { quoted: msg });

    const videoUrl = encodeURIComponent(video.url);
    const apis = isVideo ? [
      `https://api.giftedtech.web.id/api/download/dlmp4?url=${videoUrl}`,
      `https://apis.davidcyriltech.my.id/download/ytmp4?url=${videoUrl}`,
      `https://www.dark-yasiya-api.site/download/ytmp4?url=${videoUrl}`
    ] : [
      `https://apis.giftedtech.web.id/api/download/dlmp3?apikey=gifted&url=${videoUrl}`,
      `https://apis.davidcyriltech.my.id/download/ytmp3?url=${videoUrl}`
    ];

    let downloadUrl;
    for (const api of apis) {
      try {
        const response = await fetch(api);
        const data = await response.json();
        if (data.success && data.result?.download_url) {
          downloadUrl = data.result.download_url;
          break;
        }
      } catch (err) {
        logger.error(`API ${api} failed: ${err}`);
      }
    }

    if (!downloadUrl) {
      return await sock.sendMessage(jid, { 
        text: '❌ *All download sources failed. Try again later.*' 
      }, { quoted: msg });
    }

    await sock.sendMessage(jid, {
      [isVideo ? 'video' : 'audio']: { url: downloadUrl },
      mimetype: isVideo ? 'video/mp4' : 'audio/mpeg',
      caption: isVideo ? '📥 *Downloaded in Video Format*' : '📥 *Downloaded in Audio Format*'
    }, { quoted: msg });

  } catch (err) {
    logger.error(`YouTube download error: ${err}`);
    await sock.sendMessage(jid, { 
      text: '❌ *An error occurred while processing your request.*' 
    }, { quoted: msg });
  }
}

// View Once Media Handler (Non-prefix version)
async function handleViewOnce(sock, msg) {
  try {
    const botNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';
    const ownerNumber = config.OWNER_NUMBER + '@s.whatsapp.net';
    
    // Check if sender is Owner or Bot
    const sender = msg.key.participant || msg.key.remoteJid;
    const isOwner = sender === ownerNumber;
    const isBot = sender === botNumber;
    const isAuthorized = isOwner || isBot;

    // Detect reaction on View Once message
    const isReaction = msg.message?.reactionMessage;
    const reactedToViewOnce = isReaction && msg.quoted && 
      (msg.quoted.message?.viewOnceMessage || msg.quoted.message?.viewOnceMessageV2);

    // Detect emoji reply (alone or with text) only on View Once media
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
    const isEmojiReply = /^[\p{Emoji}](\s|\S)*$/u.test(text.trim()) && 
                       msg.quoted && 
                       (msg.quoted.message?.viewOnceMessage || msg.quoted.message?.viewOnceMessageV2);

    // Secret Mode = Emoji Reply or Reaction (For Bot/Owner Only) on View Once media
    const secretMode = (isEmojiReply || reactedToViewOnce) && isAuthorized;

    if (!secretMode) return;

    const targetMessage = reactedToViewOnce ? msg.quoted : msg;
    if (!targetMessage.quoted) return;
    
    let message = targetMessage.quoted.message;
    if (message.viewOnceMessageV2) message = message.viewOnceMessageV2.message;
    else if (message.viewOnceMessage) message = message.viewOnceMessage.message;

    // Additional check to ensure it's media (image, video, or audio)
    const messageType = message ? Object.keys(message)[0] : null;
    const isMedia = messageType && ['imageMessage', 'videoMessage', 'audioMessage'].includes(messageType);
    
    if (!message || !isMedia) return;

    let buffer = await downloadMediaMessage(targetMessage.quoted, 'buffer');
    if (!buffer) return;

    let mimetype = message.audioMessage?.mimetype || 'audio/ogg';
    let caption = `> *© cloud ai*`;

    // Set recipient (bot or owner)
    let recipient = isEmojiReply ? botNumber : ownerNumber;

    if (messageType === 'imageMessage') {
      await sock.sendMessage(recipient, { image: buffer, caption });
    } else if (messageType === 'videoMessage') {
      await sock.sendMessage(recipient, { video: buffer, caption, mimetype: 'video/mp4' });
    } else if (messageType === 'audioMessage') {  
      await sock.sendMessage(recipient, { audio: buffer, mimetype, ptt: true });
    }

  } catch (error) {
    logger.error('View Once handler error:', error);
  }
}

/* ==================== COMMAND HANDLER ==================== */

function handleCommands(sock, userId) {
  return async ({ messages }) => {
    try {
      const msg = messages[0];
      if (!msg?.message) return;

      const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
      if (!text) return;

      const command = text.toLowerCase().trim();
      const jid = msg.key.remoteJid;
      const sender = msg.key.participant || msg.key.remoteJid;
      const isOwner = sender === config.OWNER_NUMBER + '@s.whatsapp.net';

      // Handle basic commands
      if (command === 'ping') {
        await handlePing(sock, msg);
        return;
      }

      if (command === 'uptime') {
        await handleUptime(sock, msg);
        return;
      }

      // Handle owner commands
      if (command === 'alwaysonline on') {
        if (!isOwner) return;
        await manageAlwaysOnline(sock, userId, true);
        await sock.sendMessage(jid, { text: "Always Online has been enabled." }, { quoted: msg });
        return;
      }

      if (command === 'alwaysonline off') {
        if (!isOwner) return;
        await manageAlwaysOnline(sock, userId, false);
        await sock.sendMessage(jid, { text: "Always Online has been disabled." }, { quoted: msg });
        return;
      }

      if (command === 'autotyping on') {
        if (!isOwner) return;
        await manageAutoTyping(sock, userId, true);
        await sock.sendMessage(jid, { text: "Auto-Typing has been enabled." }, { quoted: msg });
        return;
      }

      if (command === 'autotyping off') {
        if (!isOwner) return;
        await manageAutoTyping(sock, userId, false);
        await sock.sendMessage(jid, { text: "Auto-Typing has been disabled." }, { quoted: msg });
        return;
      }

      if (command === 'autorecording on') {
        if (!isOwner) return;
        await manageAutoRecording(sock, userId, true);
        await sock.sendMessage(jid, { text: "Auto-Recording has been enabled." }, { quoted: msg });
        return;
      }

      if (command === 'autorecording off') {
        if (!isOwner) return;
        await manageAutoRecording(sock, userId, false);
        await sock.sendMessage(jid, { text: "Auto-Recording has been disabled." }, { quoted: msg });
        return;
      }

      if (command === 'features') {
        const responseMessage = `Current Features Status:\n\n` +
                              `🟢 Always Online: ${config.ALWAYS_ONLINE ? 'ON' : 'OFF'}\n` +
                              `⌨️ Auto Typing: ${config.AUTO_TYPING ? 'ON' : 'OFF'}\n` +
                              `🎤 Auto Recording: ${config.AUTO_RECORDING ? 'ON' : 'OFF'}\n\n` +
                              `Owner can toggle these features`;
        await sock.sendMessage(jid, { text: responseMessage }, { quoted: msg });
        return;
      }

      // Handle media download commands
      if (command.startsWith('play ') || command.startsWith('video ')) {
        await handleYouTubeDownload(sock, msg);
        return;
      }

      // Handle AI chat (owner only)
      if (isOwner) {
        await handleAIChat(sock, msg);
      }

      // Handle view once media (non-prefix)
      await handleViewOnce(sock, msg);

    } catch (err) {
      logger.error(`Command handler error: ${err}`);
    }
  };
}

/* ==================== SERVER SETUP ==================== */

async function startWhatsApp(userId, useQR = false) {
  try {
    const userPath = await ensureSessionPath(userId);
    const { state, saveCreds } = await useMultiFileAuthState(userPath);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: useQR,
      auth: state,
      browser: Browsers.macOS('Desktop'),
      getMessage: async () => undefined,
      shouldIgnoreJid: jid => isJidGroup(jid)
    });

    userSockets.set(userId, sock);
    sock.ev.on('creds.update', saveCreds);

    // Bio updates
    const updateBioInterval = setInterval(() => updateBio(sock), 60000);
    await updateBio(sock);

    sock.ev.on('connection.update', async (update) => {
      if (update.connection === 'close') {
        clearInterval(updateBioInterval);
        manageAlwaysOnline(sock, userId, false);
        manageAutoTyping(sock, userId, false);
        manageAutoRecording(sock, userId, false);
      } else if (update.connection === 'open') {
        await sendWelcomeMessage(sock);
      }
    });

    // Set up message handlers
    sock.ev.on('messages.upsert', handleStatusUpdates(sock));
    sock.ev.on('messages.upsert', handleCommands(sock, userId));

  } catch (err) {
    logger.error(`WhatsApp init failed: ${err}`);
  }
}

async function sendWelcomeMessage(sock) {
  try {
    await sock.sendMessage(sock.user.id, {
      text: `*Hello 👋 your session is Live*\n\n` +
            `Available Commands:\n\n` +
            `• ping - Test bot response time\n` +
            `• uptime - Show bot uptime\n` +
            `• play [query] - Download audio\n` +
            `• video [query] - Download video\n` +
            `• features - Show feature status\n\n` +
            `Owner Commands:\n` +
            `• alwaysonline on/off\n` +
            `• autotyping on/off\n` +
            `• autorecording on/off\n` +
            `• deepseek on/off\n\n` +
            `View Once Media:\n` +
            `• React with any emoji or send emoji reply\n` +
            `> *Made By Bera_Tech*`,
      contextInfo: {
        forwardingScore: 999,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
          newsletterJid: config.CHANNEL_JID,
          newsletterName: config.CHANNEL_NAME,
          serverMessageId: 143
        }
      }
    });
  } catch (err) {
    logger.error(`Welcome message failed: ${err}`);
  }
}

// Status update handler
function handleStatusUpdates(sock) {
  return async ({ messages }) => {
    try {
      const statusMsg = messages.find(m => m.key.remoteJid === 'status@broadcast');
      if (!statusMsg) return;
      await sock.readMessages([statusMsg.key]);
      await delay(1000);
      const emojis = ['🔥', '💯', '💎', '⚡', '✅', '💙', '👀', '🌟', '😎'];
      const emoji = emojis[Math.floor(Math.random() * emojis.length)];
      await sock.sendMessage(statusMsg.key.remoteJid, {
        react: { text: emoji, key: statusMsg.key }
      });
      logger.info(`Reacted to status with ${emoji}`);
    } catch (err) {
      logger.error(`Status update error: ${err}`);
    }
  };
}

// API Endpoints
app.get('/', async (req, res) => {
  try {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } catch (err) {
    res.status(500).send('Error loading page');
  }
});

app.post('/verify-channel', async (req, res) => {
  const { sessionId } = req.body;
  
  if (!sessionId) {
    return res.status(400).json({ error: 'Session ID required' });
  }

  verifiedUsers.add(sessionId);
  res.json({ 
    success: true, 
    verified: true,
    message: 'Verification complete. You may now deploy your bot.'
  });
});

app.get('/check-verification/:sessionId', (req, res) => {
  const isVerified = verifiedUsers.has(req.params.sessionId);
  res.json({ 
    verified: isVerified,
    channelLink: `https://whatsapp.com/channel/${config.REQUIRED_CHANNEL}`
  });
});

app.post('/set-session', async (req, res) => {
  const { SESSION_ID, sessionId } = req.body;
  
  if (!verifiedUsers.has(sessionId)) {
    return res.status(403).json({ 
      error: 'Please verify by visiting our channel first',
      channelLink: `https://whatsapp.com/channel/${config.REQUIRED_CHANNEL}`
    });
  }

  if (!SESSION_ID) {
    return res.status(400).json({ error: 'SESSION_ID required' });
  }

  const userId = 'default';
  const success = await downloadSessionData(userId, SESSION_ID);
  if (success) {
    await startWhatsApp(userId, false);
    res.json({ success: true });
  } else {
    res.status(500).json({ error: 'Session download failed' });
  }
});

app.get('/nairobi-time', (req, res) => {
  const now = getNairobiTime();
  res.json({
    time: now.format('HH:mm:ss'),
    date: now.format('dddd, D MMMM YYYY'),
    timezone: 'Africa/Nairobi'
  });
});

server.listen(PORT, () => {
  logger.info(`Server running on port ${PORT} (Nairobi time: ${getNairobiTime().format()})`);
});
