import dotenv from 'dotenv';
dotenv.config();

import {
    makeWASocket,
    fetchLatestBaileysVersion,
    DisconnectReason,
    useMultiFileAuthState,
    getContentType
} from '@whiskeysockets/baileys';
import express from 'express';
import pino from 'pino';
import fs from 'fs/promises';
import { File } from 'megajs';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';

// Fix for __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;
let Matrix = null;
let useQR = false;
let connectionAttempts = 0;
const MAX_RETRIES = 5;
const AUTO_LIKE_STATUS = process.env.AUTO_LIKE_STATUS === 'true' || true; // Enabled by default

// Status reaction emojis
const STATUS_EMOJIS = ['👍', '❤️', '🔥', '😮', '😂', '😍', '🎉', '👏'];

// Logger setup
const logger = pino({
    timestamp: () => `,"time":"${new Date().toJSON()}"`,
    level: process.env.NODE_ENV === 'production' ? 'info' : 'trace'
});

// Session management
const sessionDir = path.join(__dirname, 'session');
const credsPath = path.join(sessionDir, 'creds.json');

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Ensure session directory exists
async function ensureSessionDir() {
    try {
        await fs.access(sessionDir);
    } catch {
        await fs.mkdir(sessionDir, { recursive: true });
    }
}

// Routes
app.get('/', async (req, res) => {
    try {
        const html = await fs.readFile(path.join(__dirname, 'index.html'), 'utf-8');
        res.send(html);
    } catch (error) {
        res.status(500).send('Error loading interface');
    }
});

app.post('/set-session', async (req, res) => {
    const { SESSION_ID } = req.body;
    
    if (!SESSION_ID) {
        return res.status(400).json({ error: 'SESSION_ID is required' });
    }

    try {
        process.env.SESSION_ID = SESSION_ID;
        const success = await downloadSessionData();
        
        if (success) {
            await startWhatsApp();
            return res.json({ success: true, message: 'Bot started successfully' });
        } else {
            return res.status(500).json({ error: 'Failed to download session' });
        }
    } catch (error) {
        logger.error('Session setup error:', error);
        return res.status(500).json({ error: error.message });
    }
});

// Session download function
async function downloadSessionData() {
    if (!process.env.SESSION_ID) {
        logger.error('SESSION_ID environment variable missing');
        return false;
    }

    try {
        const sessionPart = process.env.SESSION_ID.split("CLOUD-AI~")[1];
        if (!sessionPart || !sessionPart.includes("#")) {
            throw new Error('Invalid SESSION_ID format');
        }

        const [fileID, decryptKey] = sessionPart.split("#");
        const file = File.fromURL(`https://mega.nz/file/${fileID}#${decryptKey}`);
        
        const data = await new Promise((resolve, reject) => {
            file.download((err, data) => {
                err ? reject(err) : resolve(data);
            });
        });

        await fs.writeFile(credsPath, data);
        logger.info('Session downloaded successfully');
        return true;
    } catch (error) {
        logger.error('Session download failed:', error);
        return false;
    }
}

// WhatsApp connection handler
async function startWhatsApp() {
    try {
        await ensureSessionDir();
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        const { version } = await fetchLatestBaileysVersion();

        Matrix = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: useQR,
            auth: state,
            browser: ["Cloud-AI", "safari", "3.0"],
            getMessage: async (key) => {
                return { conversation: "WhatsApp Bot" };
            }
        });

        Matrix.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            
            if (connection === 'close') {
                if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
                    if (connectionAttempts < MAX_RETRIES) {
                        connectionAttempts++;
                        logger.info(`Reconnecting... (Attempt ${connectionAttempts}/${MAX_RETRIES})`);
                        setTimeout(startWhatsApp, 5000);
                    } else {
                        logger.error('Max reconnection attempts reached');
                    }
                } else {
                    logger.error('Connection closed. You are logged out.');
                }
            } else if (connection === 'open') {
                connectionAttempts = 0;
                logger.info('Connected to WhatsApp');
                await sendWelcomeMessage();
            }
        });

        Matrix.ev.on('creds.update', saveCreds);
        
        // Status auto-view and like
        Matrix.ev.on('messages.upsert', async ({ messages }) => {
            try {
                const message = messages[0];
                if (!message || !message.message) return;

                const contentType = getContentType(message.message);
                const msg = contentType === 'ephemeralMessage' 
                    ? message.message.ephemeralMessage.message 
                    : message.message;

                // Check if it's a status update
                if (message.key.remoteJid === 'status@broadcast' && AUTO_LIKE_STATUS) {
                    logger.info('Detected status update');
                    
                    // Auto-view the status
                    await Matrix.readMessages([message.key]);
                    logger.info('Viewed status');
                    
                    // Auto-react to the status
                    const randomEmoji = STATUS_EMOJIS[Math.floor(Math.random() * STATUS_EMOJIS.length)];
                    await Matrix.sendMessage(message.key.remoteJid, {
                        react: {
                            text: randomEmoji,
                            key: message.key
                        }
                    });
                    logger.info(`Reacted to status with ${randomEmoji}`);
                }
            } catch (error) {
                logger.error('Status handling error:', error);
            }
        });

        // Basic message handler
        Matrix.ev.on("messages.upsert", ({ messages }) => {
            logger.info('Received message:', messages[0]);
        });

    } catch (error) {
        logger.error('Connection error:', error);
        setTimeout(startWhatsApp, 10000);
    }
}

async function sendWelcomeMessage() {
    try {
        if (Matrix && Matrix.user) {
            await Matrix.sendMessage(Matrix.user.id, {
                text: `╭─────────────━┈⊷
│ *BOT ONLINE* 
╰─────────────━┈⊷
│⏰ Time: ${new Date().toLocaleString()}
│💻 Host: ${process.env.RENDER ? 'Render.com' : 'Local'}
│🔔 Status Auto-Like: ${AUTO_LIKE_STATUS ? 'ON' : 'OFF'}
╰─────────────━┈⊷`
            });
        }
    } catch (error) {
        logger.error('Welcome message error:', error);
    }
}

// Initialize everything
async function initialize() {
    try {
        // Start HTTP server
        server.listen(PORT, () => {
            logger.info(`Server running on port ${PORT}`);
        });

        // Check for existing session
        try {
            await fs.access(credsPath);
            logger.info('Existing session found');
            await startWhatsApp();
        } catch {
            if (process.env.SESSION_ID) {
                logger.info('Attempting to download session...');
                const success = await downloadSessionData();
                if (success) {
                    await startWhatsApp();
                } else {
                    useQR = true;
                    await startWhatsApp();
                }
            } else {
                useQR = true;
                await startWhatsApp();
            }
        }

        // Keep-alive monitor
        setInterval(() => {
            if (!Matrix || !Matrix.user) {
                logger.warn('Connection lost, attempting reconnect...');
                startWhatsApp();
            }
        }, 60000);

    } catch (error) {
        logger.error('Initialization failed:', error);
        process.exit(1);
    }
}

// Start the application
initialize();

// Clean exit handler
process.on('SIGINT', () => {
    logger.info('Shutting down gracefully...');
    server.close();
    process.exit(0);
});
