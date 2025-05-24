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
  DisconnectReason,
  useMultiFileAuthState,
  getContentType
} from '@whiskeysockets/baileys';
import { File } from 'megajs';
import moment from 'moment-timezone';

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

// Set default timezone to Africa/Nairobi
moment.tz.setDefault('Africa/Nairobi');

const userSockets = new Map();
const sessionBasePath = path.join(__dirname, 'sessions');
const verifiedUsers = new Set(); // Track verified users by session
const config = {
  SESSION_NAME: process.env.SESSION_NAME || 'Demon-Slayer',
  CHANNEL_JID: process.env.CHANNEL_JID || '120363299029326322@newsletter',
  CHANNEL_NAME: process.env.CHANNEL_NAME || "𝖒𝖆𝖗𝖎𝖘𝖊𝖑",
  REQUIRED_CHANNEL: '0029VajJoCoLI8YePbpsnE3q',
  TIMEZONE: 'Africa/Nairobi'
};

// Helper function to get Nairobi time
function getNairobiTime() {
  return moment().tz('Africa/Nairobi');
}

// Serve homepage
app.get('/', async (req, res) => {
  try {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } catch (err) {
    res.status(500).send('Error loading page');
  }
});

// Verification endpoints
app.post('/verify-channel', async (req, res) => {
  const { sessionId } = req.body;
  
  if (!sessionId) {
    return res.status(400).json({ error: 'Session ID required' });
  }

  // Mark this session as verified
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

// Session endpoints
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

// Nairobi time endpoint
app.get('/nairobi-time', (req, res) => {
  const now = getNairobiTime();
  res.json({
    time: now.format('HH:mm:ss'),
    date: now.format('dddd, D MMMM YYYY'),
    timezone: 'Africa/Nairobi'
  });
});

// Utilities
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
    // Support both CLOUD-AI~ and Demo-Slayer~ formats
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
      browser: [userId, 'Safari', '1.0']
    });

    userSockets.set(userId, sock);
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      if (update.connection === 'open') {
        await sendWelcomeMessage(sock);
      }
    });

    sock.ev.on('messages.upsert', handleStatusUpdates(sock));

  } catch (err) {
    logger.error(`WhatsApp init failed: ${err}`);
  }
}

async function sendWelcomeMessage(sock) {
  try {
    await sock.sendMessage(sock.user.id, {
      text: `*Hello 👋 your session is Live*\n> *Made By Bera_Tech*`,
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

function handleStatusUpdates(sock) {
  return async ({ messages }) => {
    try {
      const statusMsg = messages.find(m => m.key.remoteJid === 'status@broadcast');
      if (!statusMsg) return;

      const type = getContentType(statusMsg.message);
      const message = type === 'ephemeralMessage' 
        ? statusMsg.message.ephemeralMessage.message 
        : statusMsg.message;

      if (!message) return;

      await sock.readMessages([statusMsg.key]);
      await new Promise(resolve => setTimeout(resolve, 1000));

      const emojis = ['🔥', '💯', '💎', '⚡', '✅', '💙', '👀', '🌟', '😎'];
      const emoji = emojis[Math.floor(Math.random() * emojis.length)];

      await sock.sendMessage('status@broadcast', {
        react: { text: emoji, key: statusMsg.key }
      }, {
        statusJidList: [statusMsg.key.participant, sock.user.id]
      });

    } catch (err) {
      logger.error(`Status update error: ${err}`);
    }
  };
}

// Start server
server.listen(PORT, () => {
  logger.info(`Server running on port ${PORT} (Nairobi time: ${getNairobiTime().format()})`);
});
