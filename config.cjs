const fs = require("fs");
require("dotenv").config();

const config = {
  SESSION_ID: process.env.SESSION_ID || "CLOUD-AI~hEpE0JJS#9F5AUTZKJfIi-B2W3hHI-hFjDLpPaAQ_5du51-3jphc",
  PREFIX: process.env.PREFIX || '.',
  AUTO_STATUS_SEEN: process.env.AUTO_STATUS_SEEN !== undefined ? process.env.AUTO_STATUS_SEEN === 'true' : true,
  AUTO_STATUS_REACT: process.env.AUTO_STATUS_REACT || "true",
  AUTO_STATUS_REPLY: process.env.AUTO_STATUS_REPLY !== undefined ? process.env.AUTO_STATUS_REPLY === 'true' : true,
  STATUS_READ_MSG: process.env.STATUS_READ_MSG || '✅ Auto Status Seen Bot',
  AUTO_DL: process.env.AUTO_DL !== undefined ? process.env.AUTO_DL === 'true' : false,
  AUTO_READ: process.env.AUTO_READ !== undefined ? process.env.AUTO_READ === 'true' : false,
  AUTO_TYPING: process.env.AUTO_TYPING !== undefined ? process.env.AUTO_TYPING === 'true' : false,
  AUTO_RECORDING: process.env.AUTO_RECORDING !== undefined ? process.env.AUTO_RECORDING === 'true' : false,
  ALWAYS_ONLINE: process.env.ALWAYS_ONLINE !== undefined ? process.env.ALWAYS_ONLINE === 'true' : false,
  AUTO_REACT: process.env.AUTO_REACT !== undefined ? process.env.AUTO_REACT === 'true' : false,
  SLIKE: process.env.SLIKE !== undefined ? process.env.SLIKE === 'true' : true,
  SLIKE_EMOJIS: process.env.SLIKE_EMOJIS ? process.env.SLIKE_EMOJIS.split(',') : ['❤️', '🔥', '😍', '💯', '✨', '😎'],
  AUTO_BLOCK: process.env.AUTO_BLOCK !== undefined ? process.env.AUTO_BLOCK === 'true' : true,
  AUTO_BIO: process.env.AUTO_BIO !== undefined ? process.env.AUTO_BIO === 'true' : true,
  ANTI_DELETE: process.env.ANTI_DELETE !== undefined ? process.env.ANTI_DELETE === 'true' : true,
  DELETE_PATH: process.env.DELETE_PATH || "pm",
  BLOCKED_PREFIXES: process.env.BLOCKED_PREFIXES ? process.env.BLOCKED_PREFIXES.split(',') : ['44', '212', '91'],
  OWNER_REACT: process.env.OWNER_REACT !== undefined ? process.env.OWNER_REACT === 'true' : false,
  REJECT_CALL: process.env.REJECT_CALL !== undefined ? process.env.REJECT_CALL === 'true' : false,
  NOT_ALLOW: process.env.NOT_ALLOW !== undefined ? process.env.NOT_ALLOW === 'true' : true,
  MODE: process.env.MODE || "public",
  OWNER_NAME: process.env.OWNER_NAME || "Bera",
  OWNER_NUMBER: process.env.OWNER_NUMBER || "254743982206",
  BOT_NAME: process.env.BOT_NAME || "CLOUD ☁️ AI",

  // Add these new fields:
  UPDATE_TRIGGERS: process.env.UPDATE_TRIGGERS 
    ? process.env.UPDATE_TRIGGERS.split(',') 
    : ['update', 'upgrade', 'refresh'],
  GITHUB_REPO: process.env.GITHUB_REPO || "PRO-DEVELOPER-1/CORE-AI",
  UPDATE_BRANCH: process.env.UPDATE_BRANCH || "main",
  PM2_NAME: process.env.PM2_NAME || "CORE-AI",
  GEMINI_KEY: process.env.GEMINI_KEY || "YOUR_KEY_HERE",
  WELCOME: process.env.WELCOME !== undefined ? process.env.WELCOME === 'true' : false,

  // Plugin Loader Logs
  PLUGIN_LOG: process.env.PLUGIN_LOG !== undefined ? process.env.PLUGIN_LOG === 'true' : true,
  PLUGIN_SUCCESS_EMOJI: process.env.PLUGIN_SUCCESS_EMOJI || '✔',
  PLUGIN_FAIL_EMOJI: process.env.PLUGIN_FAIL_EMOJI || '❌',


};

module.exports = config;
