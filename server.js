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
  isJidGroup,
  Browsers
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
  TIMEZONE: 'Africa/Nairobi'
};

const userSockets = new Map();
const sessionBasePath = path.join(__dirname, 'sessions');
const verifiedUsers = new Set();

// Track bot start time for uptime
const startTime = new Date();

// AI API Configuration
const aiApis = {
  deepseek: "https://api.siputzx.my.id/api/ai/deepseek-llm-67b-chat?content=",
  gemini: "https://vapis.my.id/api/gemini?q=",
  luminai: "https://vapis.my.id/api/luminai?q="
};

// YouTube Download APIs
const youtubeApis = {
  video: [
    "https://api.giftedtech.web.id/api/download/dlmp4?url=",
    "https://apis.davidcyriltech.my.id/download/ytmp4?url="
  ],
  audio: [
    "https://apis.giftedtech.web.id/api/download/dlmp3?apikey=gifted&url=",
    "https://apis.davidcyriltech.my.id/download/ytmp3?url="
  ]
};

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

/* ==================== FEATURE HANDLERS ==================== */

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

async function handleUptime(sock, msg) {
  const jid = msg.key.remoteJid;
  await sock.sendMessage(jid, { 
    text: `⏱️ Bot Uptime: ${formatUptime()}`
  }, { quoted: msg });
}

async function handleAIChat(sock, msg) {
  const jid = msg.key.remoteJid;
  const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
  
  try {
    const botNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';
    const ownerNumber = config.OWNER_NUMBER + '@s.whatsapp.net';
    const sender = msg.key.participant || msg.key.remoteJid;
    const isOwner = sender === ownerNumber;
    
    if (!isOwner) return;

    await sock.sendMessage(jid, { react: { text: '💻', key: msg.key } });

    let reply = null;

    // Try all AI APIs in order
    for (const [apiName, apiUrl] of Object.entries(aiApis)) {
      try {
        const response = await fetch(apiUrl + encodeURIComponent(text));
        if (!response.ok) continue;
        
        const json = await response.json();
        reply = json.data || json.message || json.result;
        if (reply) {
          logger.info(`Used ${apiName} API successfully`);
          break;
        }
      } catch (err) {
        logger.error(`Error with ${apiName} API:`, err);
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
    const apisToUse = isVideo ? youtubeApis.video : youtubeApis.audio;
    let downloadUrl;

    for (const api of apisToUse) {
      try {
        const response = await fetch(api + videoUrl);
        const data = await response.json();
        
        if (data.result?.download_url) {
          downloadUrl = data.result.download_url;
          break;
        } else if (data.download_url) {
          downloadUrl = data.download_url;
          break;
        }
      } catch (err) {
        logger.error(`YouTube API failed: ${err}`);
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
      caption: isVideo ? '📥 *Downloaded Video*' : '📥 *Downloaded Audio*'
    }, { quoted: msg });

  } catch (err) {
    logger.error(`YouTube download error: ${err}`);
    await sock.sendMessage(jid, { 
      text: '❌ *An error occurred while processing your request.*' 
    }, { quoted: msg });
  }
}

/* ==================== COMMAND HANDLER ==================== */

function handleCommands(sock) {
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

      if (command === 'ping') {
        await handlePing(sock, msg);
        return;
      }

      if (command === 'uptime') {
        await handleUptime(sock, msg);
        return;
      }

      if (command.startsWith('play ') || command.startsWith('video ')) {
        await handleYouTubeDownload(sock, msg);
        return;
      }

      if (isOwner) {
        await handleAIChat(sock, msg);
      }

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

    sock.ev.on('connection.update', async (update) => {
      if (update.connection === 'open') {
        await sendConnectionMessage(sock);
      }
    });

    sock.ev.on('messages.upsert', handleCommands(sock));

  } catch (err) {
    logger.error(`WhatsApp init failed: ${err}`);
    // Attempt restart after delay
    await delay(10000);
    await startWhatsApp(userId, useQR);
  }
}

async function sendConnectionMessage(sock) {
  try {
    const botNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';
    await sock.sendMessage(botNumber, {
      text: `✅ *WhatsApp Connection Established!*\n\n` +
            `Your bot is now connected and ready to use.\n\n` +
            `*Available Commands:*\n` +
            `• *ping* - Check bot response time\n` +
            `• *uptime* - Show bot uptime\n` +
            `• *play [query]* - Download audio from YouTube\n` +
            `• *video [query]* - Download video from YouTube\n` +
            `• Ask any question for AI response\n\n` +
            `*Connection Details:*\n` +
            `- Server Time: ${getNairobiTime().format('LLLL')}\n` +
            `- Uptime: ${formatUptime()}\n\n` +
            `Enjoy using your bot!`
    });
  } catch (err) {
    logger.error(`Connection message failed: ${err}`);
  }
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
  res.json({ verified: isVerified });
});

app.post('/set-session', async (req, res) => {
  const { SESSION_ID, sessionId } = req.body;
  
  if (!verifiedUsers.has(sessionId)) {
    return res.status(403).json({ 
      error: 'Please verify by visiting our channel first'
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

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error(`Unhandled error: ${err.stack}`);
  res.status(500).json({ error: 'Internal server error' });
});

// Process error handlers
process.on('uncaughtException', (err) => {
  logger.error(`Uncaught Exception: ${err.stack}`);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
});

server.listen(PORT, () => {
  logger.info(`Server running on port ${PORT} (Nairobi time: ${getNairobiTime().format()})`);
});
