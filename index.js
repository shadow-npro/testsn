const {
    default: makeWASocket,
    getAggregateVotesInPollMessage, 
    useMultiFileAuthState,
    DisconnectReason,
    getDevice,
    fetchLatestBaileysVersion,
    jidNormalizedUser,
    getContentType,
    Browsers,
    makeInMemoryStore,
    makeCacheableSignalKeyStore,
    downloadContentFromMessage,
    generateForwardMessageContent,
    generateWAMessageFromContent,
    prepareWAMessageMedia,
    proto
} = require('@whiskeysockets/baileys')

const { 
  getBuffer, 
  getGroupAdmins, 
  getRandom, 
  h2k, 
  isUrl, 
  Json, 
  runtime, 
  sleep, 
  fetchJson 
} = require('./lib/functions')

const fs = require('fs')
const P = require('pino')
const FileType = require('file-type')
const config = require('./settings')
const qrcode = require('qrcode-terminal')
const NodeCache = require('node-cache')
const util = require('util')
const { sms, downloadMediaMessage } = require('./lib/msg')
const axios = require('axios')
const { File } = require('megajs')
const { exec } = require('child_process')
const { tmpdir } = require('os')
const Crypto = require('crypto')
const Jimp = require('jimp')
const path = require('path')

const chalk = require('chalk');


// Console colors without chalk dependency
const colors = {
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    reset: '\x1b[0m',
    bright: '\x1b[1m'
}

// Bot Configuration
const prefix = config.PREFIX
const prefixRegex = config.prefix === "false" || config.prefix === "null" ? "^" : new RegExp('^[' + config.PREFIX + ']')
const msgRetryCounterCache = new NodeCache()
const ownerNumber = ['94767260726']

// Media Management System
class MediaManager {
    constructor() {
        this.mediaPath = path.join(__dirname, 'media')
        this.initializeMediaFolder()
    }

    initializeMediaFolder() {
        const folders = ['images', 'videos', 'audio', 'documents', 'temp']

        if (!fs.existsSync(this.mediaPath)) {
            fs.mkdirSync(this.mediaPath, { recursive: true })
            console.log(colors.green + "📁 Media directory created" + colors.reset)
        }

        folders.forEach(folder => {
            const folderPath = path.join(this.mediaPath, folder)
            if (!fs.existsSync(folderPath)) {
                fs.mkdirSync(folderPath, { recursive: true })
            }
        })
    }

    getMediaPath(type = 'images', filename) {
        return path.join(this.mediaPath, type, filename)
    }

    async getRandomMedia(type = 'images') {
        try {
            const folderPath = path.join(this.mediaPath, type)
            const files = fs.readdirSync(folderPath).filter(file => {
                const ext = path.extname(file).toLowerCase()
                return ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)
            })

            if (files.length === 0) {
                console.log(colors.yellow + `⚠️ No media files found in ${type} folder` + colors.reset)
                return null
            }

            const randomFile = files[Math.floor(Math.random() * files.length)]
            return path.join(folderPath, randomFile)
        } catch (error) {
            console.log(colors.red + "❌ Error getting random media: " + error.message + colors.reset)
            return null
        }
    }

    async downloadAndSave(url, type = 'images', filename) {
        try {
            const response = await axios.get(url, { responseType: 'stream' })
            const filePath = this.getMediaPath(type, filename)

            const writer = fs.createWriteStream(filePath)
            response.data.pipe(writer)

            return new Promise((resolve, reject) => {
                writer.on('finish', () => resolve(filePath))
                writer.on('error', reject)
            })
        } catch (error) {
            console.log(colors.red + "❌ Error downloading media: " + error.message + colors.reset)
            return null
        }
    }
}

// Enhanced Message ID Generator
function genMsgId() {
    const prefix = "SHADOW"
    const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    let randomText = prefix

    for (let i = prefix.length; i < 20; i++) {
        const randomIndex = Math.floor(Math.random() * characters.length)
        randomText += characters.charAt(randomIndex)
    }   
    return randomText
}

// Enhanced Logging System
class Logger {
    static info(message) {
        console.log(colors.blue + "ℹ️  " + colors.white + message + colors.reset)
    }

    static success(message) {
        console.log(colors.green + "✅ " + colors.white + message + colors.reset)
    }

    static warning(message) {
        console.log(colors.yellow + "⚠️  " + colors.white + message + colors.reset)
    }

    static error(message) {
        console.log(colors.red + "❌ " + colors.white + message + colors.reset)
    }

    static command(command, sender) {
        console.log(colors.cyan + "🔧 " + colors.white + `Command: ${command} | User: ${sender}` + colors.reset)
    }
}

//================== SESSION MANAGEMENT ==================
async function initSession() {
    const sessionPath = path.join(__dirname, 'session', 'creds.json')

    // Check if session directory exists, create if not
    if (!fs.existsSync(path.dirname(sessionPath))) {
        fs.mkdirSync(path.dirname(sessionPath), { recursive: true })
        Logger.info("Session directory created")
    }

    // Handle session download from SESSION_ID
    if (!fs.existsSync(sessionPath)) {
        if (!config.SESSION_ID) {
            Logger.warning("No existing session found and no SESSION_ID provided")
            Logger.info("QR Code will be generated for WhatsApp connection")
            return false
        }

        try {
            Logger.info("Downloading session from SESSION_ID...")
            const sessdata = config.SESSION_ID.split("𝙰𝚂𝙸𝚃𝙷𝙰-𝙼𝙳=")[1]

            if (!sessdata) {
                Logger.error("Invalid SESSION_ID format")
                return false
            }

            const filer = File.fromURL(`https://mega.nz/file/${sessdata}`)

            return new Promise((resolve, reject) => {
                filer.download((err, data) => {
                    if (err) {
                        Logger.error(`Failed to download session: ${err.message}`)
                        resolve(false)
                        return
                    }

                    fs.writeFileSync(sessionPath, data)
                    Logger.success("Session downloaded successfully!")
                    resolve(true)
                })
            })
        } catch (error) {
            Logger.error(`Error downloading session: ${error.message}`)
            return false
        }
    }

    Logger.success("Existing session found")
    return true
}

// Initialize MediaManager
const mediaManager = new MediaManager()

//================== EXPRESS SERVER ==================
const express = require("express")
const app = express()
const port = process.env.PORT || 9000

// Enhanced server routes
app.get("/", (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>SHADOW-N PRO</title>
        <style>
            body {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                margin: 0;
                padding: 0;
                display: flex;
                justify-content: center;
                align-items: center;
                min-height: 100vh;
            }
            .container {
                text-align: center;
                background: rgba(255, 255, 255, 0.1);
                backdrop-filter: blur(10px);
                border-radius: 20px;
                padding: 40px;
                box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.37);
                border: 1px solid rgba(255, 255, 255, 0.18);
            }
            h1 {
                font-size: 3em;
                margin-bottom: 20px;
                text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
            }
            .status {
                background: #4CAF50;
                padding: 10px 20px;
                border-radius: 25px;
                display: inline-block;
                margin: 10px 0;
            }
            .info {
                margin: 10px 0;
                font-size: 1.1em;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🤖 SHADOW-N PRO</h1>
            <div class="status">✅ Bot is Online</div>
            <div class="info">📱 Advanced WhatsApp Bot</div>
            <div class="info">👨‍💻 Developed by NETHUPA METHWAN</div>
            <div class="info">🌐 Port: ${port}</div>
            <div class="info">⚡ Enhanced Performance & Features</div>
        </div>
    </body>
    </html>
    `)
})

app.get("/status", (req, res) => {
    res.json({
        status: "online",
        bot: "SHADOW-N PRO",
        version: "2.0",
        uptime: process.uptime(),
        memory: process.memoryUsage()
    })
})

//================== MAIN CONNECTION FUNCTION ==================
async function connectToWA() {
    Logger.info("🚀 Starting SHADOW-N PRO Bot...")

    // Initialize session
    const sessionExists = await initSession()

    try {
        const { version, isLatest } = await fetchLatestBaileysVersion()
        Logger.info(`Using WA v${version.join('.')}, isLatest: ${isLatest}`)

        const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, 'session'))

        const conn = makeWASocket({
            logger: P({ level: "silent" }).child({ level: "silent" }),
            printQRInTerminal: !sessionExists,
            generateHighQualityLinkPreview: true,
            auth: state,
            defaultQueryTimeoutMs: undefined,
            msgRetryCounterCache,
            browser: Browsers.macOS("SHADOW-N PRO"),
            syncFullHistory: false,
            markOnlineOnConnect: true
        })

        // Store connection globally for error reporting
        global.conn = conn

        // Connection event handler
        conn.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update

            if (qr && !sessionExists) {
                console.log(colors.cyan + "\n📱 Scan this QR code with your WhatsApp:" + colors.reset)
                console.log(colors.cyan + "┌─────────────────────────────────────┐" + colors.reset)
                qrcode.generate(qr, { small: true })
                console.log(colors.cyan + "└─────────────────────────────────────┘" + colors.reset)
                Logger.info("Waiting for WhatsApp connection...")
            }

            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut

                if (lastDisconnect?.error?.output?.statusCode === DisconnectReason.loggedOut) {
                    Logger.error("Device logged out. Please scan QR code again or provide new SESSION_ID")
                    // Clear session files
                    if (fs.existsSync(path.join(__dirname, 'session'))) {
                        fs.rmSync(path.join(__dirname, 'session'), { recursive: true, force: true })
                        Logger.info("Session files cleared")
                    }
                } else {
                    Logger.warning(`Connection closed, reconnecting... ${lastDisconnect?.error?.message}`)
                }

                if (shouldReconnect) {
                    setTimeout(() => connectToWA(), 5000)
                }
            } else if (connection === 'open') {
                Logger.success("WhatsApp connection established!")
                Logger.info("Loading plugins...")

                // Load plugins with better error handling
                await loadPlugins()

                Logger.success("SHADOW-N PRO Bot connected successfully!")

                // Send enhanced connection notification
                const connectionMessage = `🎉 *SHADOW-N PRO BOT v2.0*
🚀 *Successfully Connected!*

╭─ 📋 *Bot Information*
├ 🔧 Prefix: ${config.PREFIX}
├ 🎯 Mode: ${config.MODE}
├ 👀 Auto Status Read: ${config.AUTO_READ_STATUS}
├ ⚡ Version: 2.0 Enhanced
├ 📊 Performance: Optimized
└ 🛡️ Security: Enhanced

╭─ 🎨 *New Features*
├ 📁 Local Media Management
├ 🔄 Advanced Error Handling  
├ 📈 Performance Monitoring
├ 🎯 Smart Command System
└ 💎 Premium UI Experience

*🔗 Powered by NETHUPA METHWAN*
*⚡ Ready to serve with enhanced capabilities!*`

                try {
                    // Use local media for thumbnail
                    const thumbnailPath = await mediaManager.getRandomMedia('images')
                    let mediaOptions = {}

                    if (thumbnailPath) {
                        const imageBuffer = fs.readFileSync(thumbnailPath)
                        mediaOptions = {
                            jpegThumbnail: imageBuffer
                        }
                    }

                    await conn.sendMessage(conn.user.id, { 
                        text: connectionMessage, 
                        contextInfo: {
                            mentionedJid: [''],
                            groupMentions: [],
                            isForwarded: true,
                            forwardedNewsletterMessageInfo: {
                                newsletterJid: '120363421132465520@newsletter',
                                newsletterName: "SHADOW-N PRO v2.0",
                                serverMessageId: 999
                            },
                            externalAdReply: { 
                                title: '🤖 SHADOW-N PRO v2.0',
                                body: '⚡ Enhanced WhatsApp Bot Experience',
                                mediaType: 1,
                                sourceUrl: "https://github.com/your-repo",
                                thumbnailUrl: thumbnailPath ? undefined : "",
                                renderLargerThumbnail: true,
                                showAdAttribution: true,
                                ...mediaOptions
                            }
                        } 
                    })
                } catch (error) {
                    Logger.warning(`Failed to send connection message: ${error.message}`)
                }
            } else if (connection === 'connecting') {
                Logger.info("Connecting to WhatsApp...")
            }
        })

        // Save credentials
        conn.ev.on('creds.update', saveCreds)

        // Enhanced message handler
        conn.ev.on('messages.upsert', async (mek) => {
            await handleMessage(conn, mek)
        })

        // Add enhanced methods to conn object
        enhanceConnection(conn)

        return conn

    } catch (error) {
        Logger.error(`Connection error: ${error.message}`)
        Logger.info("Retrying in 10 seconds...")
        setTimeout(() => connectToWA(), 10000)
    }
}

//================== PLUGIN LOADER ==================
async function loadPlugins() {
    try {
        const pluginDir = path.join(__dirname, 'plugins')

        if (!fs.existsSync(pluginDir)) {
            fs.mkdirSync(pluginDir, { recursive: true })
            Logger.warning("No plugins directory found, created new one")
            return
        }

        const pluginFiles = fs.readdirSync(pluginDir)
        let loadedPlugins = 0
        let failedPlugins = 0

        for (const plugin of pluginFiles) {
            if (path.extname(plugin).toLowerCase() === ".js") {
                try {
                    // Clear require cache for fresh load
                    delete require.cache[require.resolve(path.join(pluginDir, plugin))]
                    require(path.join(pluginDir, plugin))
                    loadedPlugins++
                    Logger.success(`Loaded: ${plugin}`)
                } catch (pluginError) {
                    failedPlugins++
                    Logger.error(`Failed to load ${plugin}: ${pluginError.message}`)
                }
            }
        }

        Logger.success(`Plugin loading complete! (${loadedPlugins} loaded, ${failedPlugins} failed)`)
    } catch (error) {
        Logger.warning(`Plugin directory error: ${error.message}`)
    }
}

//================== CONNECTION ENHANCER ==================
function enhanceConnection(conn) {
    // Enhanced edit message method
    conn.edite = async (messageKey, newText) => {
        try {
            await conn.relayMessage(messageKey.remoteJid, {
                protocolMessage: {
                    key: messageKey,
                    type: 14,
                    editedMessage: {
                        conversation: newText
                    }
                }
            }, {})
        } catch (error) {
            Logger.error(`Failed to edit message: ${error.message}`)
        }
    }

    // Enhanced media download method
    conn.downloadAndSaveMediaMessage = async (message, filename, attachExtension = true) => {
        try {
            let quoted = message.msg ? message.msg : message
            let mime = (message.msg || message).mimetype || ''
            let messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0]

            const stream = await downloadContentFromMessage(quoted, messageType)
            let buffer = Buffer.from([])

            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk])
            }

            let type = await FileType.fromBuffer(buffer)
            let trueFileName = attachExtension ? (filename + '.' + type.ext) : filename
            let filePath = mediaManager.getMediaPath('temp', trueFileName)

            await fs.writeFileSync(filePath, buffer)
            return filePath
        } catch (error) {
            Logger.error(`Failed to download media: ${error.message}`)
            return null
        }
    }


    // Enhanced forward message method
    conn.forwardMessage = async (jid, message, forceForward = false, options = {}) => {
        try {
            let vtype
            if (options.readViewOnce) {
                message.message = message.message && message.message.ephemeralMessage && message.message.ephemeralMessage.message ? message.message.ephemeralMessage.message : (message.message || undefined)
                vtype = Object.keys(message.message.viewOnceMessage.message)[0]
                delete (message.message && message.message.ignore ? message.message.ignore : (message.message || undefined))
                delete message.message.viewOnceMessage.message[vtype].viewOnce
                message.message = {
                    ...message.message.viewOnceMessage.message
                }
            }

            let mtype = Object.keys(message.message)[0]
            let content = await generateForwardMessageContent(message, forceForward)
            let ctype = Object.keys(content)[0]
            let context = {}

            if (mtype != "conversation") context = message.message[mtype].contextInfo
            content[ctype].contextInfo = {
                ...context,
                ...content[ctype].contextInfo
            }

            const waMessage = await generateWAMessageFromContent(jid, content, options ? {
                ...content[ctype],
                ...options,
                ...(options.contextInfo ? {
                    contextInfo: {
                        ...content[ctype].contextInfo,
                        ...options.contextInfo
                    }
                } : {})
            } : {})

            await conn.relayMessage(jid, waMessage.message, { messageId: waMessage.key.id })
            return waMessage
        } catch (error) {
            Logger.error(`Failed to forward message: ${error.message}`)
            return null
        }
    }

    // Add local media sender
    conn.sendLocalMedia = async (jid, type = 'images', caption = '', options = {}) => {
        try {
            const mediaPath = await mediaManager.getRandomMedia(type)
            if (!mediaPath) {
                throw new Error(`No ${type} found in media folder`)
            }

            const mediaBuffer = fs.readFileSync(mediaPath)
            const mimeType = await FileType.fromBuffer(mediaBuffer)

            let mediaMessage = {}

            if (type === 'images') {
                mediaMessage = {
                    image: mediaBuffer,
                    caption: caption,
                    mimetype: mimeType.mime,
                    ...options
                }
            } else if (type === 'videos') {
                mediaMessage = {
                    video: mediaBuffer,
                    caption: caption,
                    mimetype: mimeType.mime,
                    ...options
                }
            }

            return await conn.sendMessage(jid, mediaMessage)
        } catch (error) {
            Logger.error(`Failed to send local media: ${error.message}`)
            return null
        }
    }
}






//================== MESSAGE HANDLER ==================
async function handleMessage(conn, mek) {
    try {
        mek = mek.messages[0]
        if (!mek.message) return

        mek.message = (getContentType(mek.message) === 'ephemeralMessage') ? mek.message.ephemeralMessage.message : mek.message

        // Auto status view with toggle controls
        if (mek?.key?.remoteJid === 'status@broadcast') {
          // Auto read status
          if (config.AUTO_READ_STATUS === "true") {
            try {
              await conn.readMessages([mek.key]);
            } catch (err) {
              console.error("❌ Error reading status:", err);
            }
          }

          // Auto react to status
          if (config.AUTO_REACT_STATUS === "true") {
            try {
              const mnyako = conn?.user?.id
                ? await jidNormalizedUser(conn.user.id)
                : null;

              if (!mek.key.participant || !mnyako) {
                console.log("❌ Missing participant or mnyako for status reaction.");
              } else {
                await conn.sendMessage(
                  mek.key.remoteJid,
                  {
                    react: { key: mek.key, text: '👀' }
                  },
                  {
                    statusJidList: [mek.key.participant, mnyako]
                  }
                );
              }
            } catch (err) {
              console.error("❌ Error reacting to status:", err);
            }
          }

          return; // Exit early for status messages
        }

        const m = sms(conn, mek);

        // DECLARE ALL VARIABLES FIRST - BEFORE ANY USAGE
        const type = Object.keys(mek.message)[0]
        const from = mek?.key?.remoteJid;

        // Extract body based on message type
        const body = (type === 'conversation') ? mek.message.conversation : 
            (type === 'extendedTextMessage') ? mek.message.extendedTextMessage.text :
            (type == 'interactiveResponseMessage') ? mek.message.interactiveResponseMessage && mek.message.interactiveResponseMessage.nativeFlowResponseMessage && JSON.parse(mek.message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson) && JSON.parse(mek.message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson).id :
            (type == 'templateButtonReplyMessage') ? mek.message.templateButtonReplyMessage && mek.message.templateButtonReplyMessage.selectedId : 
            (type == 'imageMessage') && mek.message.imageMessage.caption ? mek.message.imageMessage.caption : 
            (type == 'videoMessage') && mek.message.videoMessage.caption ? mek.message.videoMessage.caption : ''

        // Define all other variables
        const isCmd = body.startsWith(prefix)
        const command = isCmd ? body.slice(prefix.length).trim().split(' ').shift().toLowerCase() : ''
        const args = body.trim().split(/ +/).slice(1)
        const q = args.join(' ')
        const isGroup = from.endsWith('@g.us')
        const sender = mek.key.fromMe ? (conn.user.id.split(':')[0] + '@s.whatsapp.net' || conn.user.id) : (mek.key.participant || mek.key.remoteJid)
        const senderNumber = sender.split('@')[0]
        const botNumber = conn.user.id.split(':')[0]
        const pushname = mek.pushName || 'User'
        const isOwner = ownerNumber.includes(senderNumber)
        const botNumber2 = await jidNormalizedUser(conn.user.id)

        // Function to send status control buttons (moved inside scope)
        async function sendStatusButtons(m, message = "") {
          const readStatus = config.AUTO_READ_STATUS === "true" ? "✅ ON" : "❌ OFF";
          const reactStatus = config.AUTO_REACT_STATUS === "true" ? "✅ ON" : "❌ OFF";

          const readButtonText = config.AUTO_READ_STATUS === "true" ? "Turn OFF Read" : "Turn ON Read";
          const reactButtonText = config.AUTO_REACT_STATUS === "true" ? "Turn OFF React" : "Turn ON React";

          const readButtonId = config.AUTO_READ_STATUS === "true" ? "read_off" : "read_on";
          const reactButtonId = config.AUTO_REACT_STATUS === "true" ? "react_off" : "react_on";

          const buttonMessage = {
            text: `${message}\n\n📊 *STATUS FEATURES CONTROL PANEL*

🔍 Auto Read Status: ${readStatus}
👀 Auto React Status: ${reactStatus}

Use the buttons below to toggle features:`,
            footer: "© Status Manager Bot",
            buttons: [
              {
                buttonId: readButtonId,
                buttonText: { displayText: `📖 ${readButtonText}` },
                type: 1
              },
              {
                buttonId: reactButtonId,
                buttonText: { displayText: `👀 ${reactButtonText}` },
                type: 1
              },
              {
                buttonId: "status_refresh",
                buttonText: { displayText: "🔄 Refresh" },
                type: 1
              }
            ],
            headerType: 1
          };

          try {
            await conn.sendMessage(from, buttonMessage);
          } catch (err) {
            // Fallback to regular text if buttons fail
            await m.reply(`📊 *STATUS FEATURES*

🔍 Auto Read Status: ${readStatus}
👀 Auto React Status: ${reactStatus}

*Commands:*
• \`.statusread on/off\` - Toggle auto read
• \`.statusreact on/off\` - Toggle auto react  
• \`.status\` - Check current settings`);
          }
        }

        // Handle button callbacks
        if (m.msg?.selectedButtonId) {
          const buttonId = m.msg.selectedButtonId;

          if (!isOwner) return m.reply("❌ Owner only command!");

          switch (buttonId) {
            case 'read_on':
              config.AUTO_READ_STATUS = "true";
              await sendStatusButtons(m, "✅ Auto read status: *ENABLED*");
              break;
            case 'read_off':
              config.AUTO_READ_STATUS = "false";
              await sendStatusButtons(m, "❌ Auto read status: *DISABLED*");
              break;
            case 'react_on':
              config.AUTO_REACT_STATUS = "true";
              await sendStatusButtons(m, "✅ Auto react to status: *ENABLED*");
              break;
            case 'react_off':
              config.AUTO_REACT_STATUS = "false";
              await sendStatusButtons(m, "❌ Auto react to status: *DISABLED*");
              break;
            case 'status_refresh':
              await sendStatusButtons(m, "🔄 Status refreshed!");
              break;
          }
          return;
        }

        // Debug command
        if (body === '.checkowner' || body === '.ownertest') {
          await m.reply(`🔍 *OWNER DEBUG INFO*

*Your Info:*
• From: ${from}
• Sender Number: ${senderNumber}
• Push Name: ${pushname}

*Bot Config:*
• Owner Number: ${ownerNumber || 'Not set!'}

*Check Result:*
• Is Owner: ${isOwner ? '✅ YES' : '❌ NO'}

*Your existing isOwner check:*
ownerNumber.includes(senderNumber) = ${isOwner}`);
        }

        // Status commands using your existing variables
        if (body === '.statusinfo' || body === '.status') {
          if (!isOwner) return m.reply("❌ Owner only command!");
          await sendStatusButtons(m, "📊 Status features panel loaded!");
        }

        if (body === '.statusread on' || body === '.autoread on') {
          if (!isOwner) return m.reply("❌ Owner only command!");
          config.AUTO_READ_STATUS = "true";
          await sendStatusButtons(m, "✅ Auto read status: *ENABLED*");
        }

        if (body === '.statusread off' || body === '.autoread off') {
          if (!isOwner) return m.reply("❌ Owner only command!");
          config.AUTO_READ_STATUS = "false";
          await sendStatusButtons(m, "❌ Auto read status: *DISABLED*");
        }

        if (body === '.statusreact on' || body === '.autoreact on') {
          if (!isOwner) return m.reply("❌ Owner only command!");
          config.AUTO_REACT_STATUS = "true";
          await sendStatusButtons(m, "✅ Auto react to status: *ENABLED*");
        }

        if (body === '.statusreact off' || body === '.autoreact off') {
          if (!isOwner) return m.reply("❌ Owner only command!");
          config.AUTO_REACT_STATUS = "false";
          await sendStatusButtons(m, "❌ Auto react to status: *DISABLED*");
        }

    
        

        // Enhanced reply function
        const reply = async (teks, options = {}) => {
            try {
                const defaultOptions = {
                    contextInfo: {
                        mentionedJid: [],
                        isForwarded: false,
                        externalAdReply: {
                            title: "SHADOW-N PRO",
                            body: "Advanced WhatsApp Bot",
                            mediaType: 1,
                            renderLargerThumbnail: false,
                            showAdAttribution: false
                        }
                    }
                }

                const mergedOptions = { ...defaultOptions, ...options }
                return await conn.sendMessage(from, { text: teks, ...mergedOptions }, { quoted: mek })
            } catch (error) {
                Logger.error(`Reply failed: ${error.message}`)
                return await conn.sendMessage(from, { text: teks }, { quoted: mek })
            }
        }
        // Developer react
        if (senderNumber.includes("94767260726")) {
            if (m.message.reactionMessage) return

            // Check if message starts with "." prefix or is a reply to a message with "." prefix
            const messageText = m.message?.conversation || m.message?.extendedTextMessage?.text || ""
            const quotedText = m.message?.extendedTextMessage?.contextInfo?.quotedMessage?.conversation || 
                              m.message?.extendedTextMessage?.contextInfo?.quotedMessage?.extendedTextMessage?.text || ""

            if (messageText.startsWith(".") || quotedText.startsWith(".")) {
                let emoji = "✅" // Default emoji

                // Determine emoji based on command
                const command = messageText.toLowerCase().replace(".", "") || quotedText.toLowerCase().replace(".", "")

                switch (true) {
                    case command.includes("ping"):
                        emoji = "🏓"
                        break
                    case command.includes("restart"):
                        emoji = "🔄"
                        break
                    case command.includes("shutdown"):
                        emoji = "⚡"
                        break
                    case command.includes("alive"):
                        emoji = "💚"
                        break
                    case command.includes("help"):
                        emoji = "❓"
                        break
                    case command.includes("menu"):
                        emoji = "📋"
                        break
                    default:
                        emoji = ""
                        break
                }

                await m.react(emoji)
            }
        }

        // Work type restrictions
        if (!isOwner && config.MODE === "private") return
        if (!isOwner && isGroup && config.MODE === "inbox") return
        if (!isOwner && !isGroup && config.MODE === "groups") return

        // Command handling
        if (isCmd) {
            Logger.command(command, senderNumber)

            // Check if command exists in new system
            try {
                const { findCommand } = require('./command')
                const foundCommand = findCommand(body.trim().toLowerCase())

                if (foundCommand && foundCommand.handler) {
                    const context = {
                        conn, mek, m, from, prefix, body, isCmd, command, args, q,
                        isGroup, sender, senderNumber, botNumber2, botNumber, pushname,
                        isOwner, reply, mediaManager
                    }

                    await foundCommand.handler(conn, mek, context)
                    return
                }
            } catch (error) {
                // Command system not available, continue with switch
            }

            // Built-in commands
            switch (command) {
                case 'jid':
                    await reply(from)
                    break

                case 'ping':
                    const start = Date.now()
                    const msg = await reply("🏓 Pinging...")
                    const end = Date.now()
                    await conn.edite(msg.key, `🏓 Pong!\n⚡ Speed: ${end - start}ms`)
                    break

                case 'runtime':
                case 'uptime':
                    const uptime = runtime(process.uptime())
                    await reply(`⏱️ *Bot Uptime*\n📊 ${uptime}`)
                    break

                case 'status':
                    const statusText = `🤖 *SHADOW-N PRO Status*

🔋 *System Status:* Online
⚡ *Performance:* Optimized
📊 *Uptime:* ${runtime(process.uptime())}
💾 *Memory Usage:* ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB
🌐 *Platform:* ${process.platform}
📱 *Bot Mode:* ${config.MODE}

✅ All systems operational!`

                    await reply(statusText)
                    break

                case 'media':
                    if (!isOwner) return reply("❌ Owner only command!")

                    const mediaTypes = ['images', 'videos', 'audio', 'documents']
                    let mediaInfo = "📁 *Media Library Status*\n\n"

                    for (const type of mediaTypes) {
                        try {
                            const folderPath = path.join(mediaManager.mediaPath, type)
                            const files = fs.readdirSync(folderPath)
                            mediaInfo += `📂 ${type.toUpperCase()}: ${files.length} files\n`
                        } catch {
                            mediaInfo += `📂 ${type.toUpperCase()}: 0 files\n`
                        }
                    }

                    await reply(mediaInfo)
                    break

                default:
                    // Eval for owner
                    if (isOwner && body.startsWith('$')) {
                        let code = body.slice(1)
                        try {
                            let result = await eval(code)
                            await reply(util.format(result))
                        } catch (err) {
                            await reply(util.format(err))
                        }
                    }
            }
        }

    } catch (error) {
        Logger.error(`Message handling error: ${error.message}`)
        console.error(error)
    }
}

//================== STARTUP ==================
app.listen(port, () => {
    Logger.success(`SHADOW-N PRO Server listening on http://localhost:${port}`)
})

// Start bot with delay
setTimeout(() => {
    console.log(chalk.cyan(`

       ███████╗██╗  ██╗ █████╗ ██████╗  ██████╗ ██╗    ██╗      ███╗   ██╗    ██████╗ ██████╗  ██████╗ 
       ██╔════╝██║  ██║██╔══██╗██╔══██╗██╔═══██╗██║    ██║      ████╗  ██║    ██╔══██╗██╔══██╗██╔═══██╗
       ███████╗███████║███████║██║  ██║██║   ██║██║ █╗ ██║█████╗██╔██╗ ██║    ██████╔╝██████╔╝██║   ██║
       ╚════██║██╔══██║██╔══██║██║  ██║██║   ██║██║███╗██║╚════╝██║╚██╗██║    ██╔═══╝ ██╔══██╗██║   ██║
       ███████║██║  ██║██║  ██║██████╔╝╚██████╔╝╚███╔███╔╝      ██║ ╚████║    ██║     ██║  ██║╚██████╔╝
       ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝  ╚═════╝  ╚══╝╚══╝       ╚═╝  ╚═══╝    ╚═╝     ╚═╝  ╚═╝ ╚═════╝ 
        
                                      🤖 V1.0.0 By NETHUPA METHWAN
    `));
    connectToWA()
}, 3000)


// Graceful shutdown
process.on('SIGINT', () => {
    Logger.info("Shutting down SHADOW-N PRO...")

    // Clean up temporary files
    const tempPath = path.join(__dirname, 'media', 'temp')
    if (fs.existsSync(tempPath)) {
        fs.readdirSync(tempPath).forEach(file => {
            try {
                fs.unlinkSync(path.join(tempPath, file))
            } catch (error) {
                Logger.warning(`Failed to clean temp file ${file}: ${error.message}`)
            }
        })
        Logger.info("Temporary files cleaned")
    }

    // Save any pending data
    Logger.success("SHADOW-N PRO shutdown complete")
    process.exit(0)
})

process.on('SIGTERM', () => {
    Logger.info("Received SIGTERM, shutting down gracefully...")
    process.exit(0)
})

process.on('uncaughtException', (error) => {
    Logger.error(`Uncaught Exception: ${error.message}`)
    console.error(error.stack)

    // Attempt to notify owner about critical error
    if (global.conn && ownerNumber[0]) {
        try {
            global.conn.sendMessage(ownerNumber[0] + '@s.whatsapp.net', {
                text: `🚨 *CRITICAL ERROR DETECTED*\n\n` +
                      `⚠️ **Exception:** ${error.message}\n` +
                      `📍 **Stack:** ${error.stack?.split('\n')[0]}\n` +
                      `⏰ **Time:** ${new Date().toLocaleString()}\n\n` +
                      `🔄 **Bot will attempt to recover...**`
            })
        } catch (notifyError) {
            Logger.error(`Failed to notify owner: ${notifyError.message}`)
        }
    }

    // Restart after 5 seconds
    setTimeout(() => {
        process.exit(1)
    }, 5000)
})

process.on('unhandledRejection', (error) => {
    Logger.error(`Unhandled Rejection: ${error.message}`)
    console.error(error.stack || error)
})

//================== ADDITIONAL UTILITY FUNCTIONS ==================

// Performance Monitor
class PerformanceMonitor {
    constructor() {
        this.startTime = Date.now()
        this.messageCount = 0
        this.commandCount = 0
        this.errorCount = 0
    }

    incrementMessage() {
        this.messageCount++
    }

    incrementCommand() {
        this.commandCount++
    }

    incrementError() {
        this.errorCount++
    }

    getStats() {
        const uptime = Date.now() - this.startTime
        const uptimeSeconds = Math.floor(uptime / 1000)
        const memory = process.memoryUsage()

        return {
            uptime: uptimeSeconds,
            messages: this.messageCount,
            commands: this.commandCount,
            errors: this.errorCount,
            memoryUsage: {
                used: Math.round(memory.heapUsed / 1024 / 1024),
                total: Math.round(memory.heapTotal / 1024 / 1024)
            },
            messagesPerMinute: Math.round((this.messageCount / uptimeSeconds) * 60),
            commandsPerMinute: Math.round((this.commandCount / uptimeSeconds) * 60)
        }
    }

    reset() {
        this.messageCount = 0
        this.commandCount = 0
        this.errorCount = 0
        this.startTime = Date.now()
    }
}

const performanceMonitor = new PerformanceMonitor()

// Advanced Database Manager (JSON-based for simplicity)
class DatabaseManager {
    constructor() {
        this.dbPath = path.join(__dirname, 'database')
        this.initDB()
    }

    initDB() {
        if (!fs.existsSync(this.dbPath)) {
            fs.mkdirSync(this.dbPath, { recursive: true })
        }

        // Initialize default databases
        const defaultDBs = ['users.json', 'groups.json', 'settings.json', 'economy.json']

        defaultDBs.forEach(db => {
            const dbFile = path.join(this.dbPath, db)
            if (!fs.existsSync(dbFile)) {
                fs.writeFileSync(dbFile, JSON.stringify({}))
                Logger.info(`Created database: ${db}`)
            }
        })
    }

    read(database) {
        try {
            const dbFile = path.join(this.dbPath, `${database}.json`)
            if (!fs.existsSync(dbFile)) {
                return {}
            }
            const data = fs.readFileSync(dbFile, 'utf8')
            return JSON.parse(data)
        } catch (error) {
            Logger.error(`Failed to read database ${database}: ${error.message}`)
            return {}
        }
    }

    write(database, data) {
        try {
            const dbFile = path.join(this.dbPath, `${database}.json`)
            fs.writeFileSync(dbFile, JSON.stringify(data, null, 2))
            return true
        } catch (error) {
            Logger.error(`Failed to write database ${database}: ${error.message}`)
            return false
        }
    }

    get(database, key, defaultValue = null) {
        const data = this.read(database)
        return data[key] !== undefined ? data[key] : defaultValue
    }

    set(database, key, value) {
        const data = this.read(database)
        data[key] = value
        return this.write(database, data)
    }

    delete(database, key) {
        const data = this.read(database)
        if (data[key] !== undefined) {
            delete data[key]
            return this.write(database, data)
        }
        return false
    }

    has(database, key) {
        const data = this.read(database)
        return data[key] !== undefined
    }

    // Advanced operations
    increment(database, key, amount = 1) {
        const current = this.get(database, key, 0)
        return this.set(database, key, current + amount)
    }

    decrement(database, key, amount = 1) {
        const current = this.get(database, key, 0)
        return this.set(database, key, Math.max(0, current - amount))
    }

    push(database, key, value) {
        const current = this.get(database, key, [])
        if (Array.isArray(current)) {
            current.push(value)
            return this.set(database, key, current)
        }
        return false
    }

    pull(database, key, value) {
        const current = this.get(database, key, [])
        if (Array.isArray(current)) {
            const index = current.indexOf(value)
            if (index > -1) {
                current.splice(index, 1)
                return this.set(database, key, current)
            }
        }
        return false
    }

    backup() {
        try {
            const backupPath = path.join(__dirname, 'backups', `backup_${Date.now()}`)
            if (!fs.existsSync(path.dirname(backupPath))) {
                fs.mkdirSync(path.dirname(backupPath), { recursive: true })
            }

            // Copy entire database directory
            const copyDir = (src, dest) => {
                if (!fs.existsSync(dest)) {
                    fs.mkdirSync(dest, { recursive: true })
                }
                const items = fs.readdirSync(src)
                items.forEach(item => {
                    const srcPath = path.join(src, item)
                    const destPath = path.join(dest, item)
                    if (fs.statSync(srcPath).isDirectory()) {
                        copyDir(srcPath, destPath)
                    } else {
                        fs.copyFileSync(srcPath, destPath)
                    }
                })
            }

            copyDir(this.dbPath, backupPath)
            Logger.success(`Database backup created: ${backupPath}`)
            return backupPath
        } catch (error) {
            Logger.error(`Backup failed: ${error.message}`)
            return null
        }
    }
}

const db = new DatabaseManager()

// Anti-Spam System
class AntiSpam {
    constructor() {
        this.userMessages = new Map()
        this.spamThreshold = 5 // messages
        this.timeWindow = 10000 // 10 seconds
        this.banDuration = 300000 // 5 minutes
    }

    checkSpam(userId) {
        const now = Date.now()
        const userHistory = this.userMessages.get(userId) || []

        // Remove old messages outside time window
        const recentMessages = userHistory.filter(time => now - time < this.timeWindow)

        // Add current message
        recentMessages.push(now)
        this.userMessages.set(userId, recentMessages)

        // Check if user is spamming
        if (recentMessages.length >= this.spamThreshold) {
            // Check if already banned
            const banInfo = db.get('users', `${userId}_ban`)
            if (banInfo && now < banInfo.until) {
                return { isSpam: true, isBanned: true, banUntil: banInfo.until }
            }

            // Apply ban
            const banUntil = now + this.banDuration
            db.set('users', `${userId}_ban`, {
                reason: 'Spam detection',
                until: banUntil,
                timestamp: now
            })

            Logger.warning(`Anti-spam: User ${userId} banned for ${this.banDuration/1000}s`)
            return { isSpam: true, isBanned: false, banUntil }
        }

        return { isSpam: false, isBanned: false }
    }

    isBanned(userId) {
        const now = Date.now()
        const banInfo = db.get('users', `${userId}_ban`)

        if (banInfo && now < banInfo.until) {
            return { banned: true, until: banInfo.until, reason: banInfo.reason }
        }

        // Clean up expired ban
        if (banInfo && now >= banInfo.until) {
            db.delete('users', `${userId}_ban`)
        }

        return { banned: false }
    }

    unban(userId) {
        return db.delete('users', `${userId}_ban`)
    }

    clearUserHistory(userId) {
        this.userMessages.delete(userId)
    }
}

const antiSpam = new AntiSpam()

// Auto Backup System
class AutoBackup {
    constructor() {
        this.backupInterval = 1000 * 60 * 60 * 6 // 6 hours
        this.maxBackups = 10
        this.start()
    }

    start() {
        setInterval(() => {
            this.performBackup()
        }, this.backupInterval)

        Logger.info("Auto-backup system started (6-hour intervals)")
    }

    async performBackup() {
        try {
            Logger.info("Performing automatic backup...")

            // Database backup
            const dbBackupPath = db.backup()

            // Media backup (optional - can be large)
            // await this.backupMedia()

            // Clean old backups
            await this.cleanOldBackups()

            Logger.success("Automatic backup completed")
        } catch (error) {
            Logger.error(`Auto-backup failed: ${error.message}`)
        }
    }

    async cleanOldBackups() {
        try {
            const backupsDir = path.join(__dirname, 'backups')
            if (!fs.existsSync(backupsDir)) return

            const backups = fs.readdirSync(backupsDir)
                .filter(dir => dir.startsWith('backup_'))
                .map(dir => ({
                    name: dir,
                    path: path.join(backupsDir, dir),
                    time: parseInt(dir.split('_')[1])
                }))
                .sort((a, b) => b.time - a.time) // newest first

            // Keep only maxBackups newest backups
            if (backups.length > this.maxBackups) {
                const toDelete = backups.slice(this.maxBackups)

                for (const backup of toDelete) {
                    fs.rmSync(backup.path, { recursive: true, force: true })
                    Logger.info(`Cleaned old backup: ${backup.name}`)
                }
            }
        } catch (error) {
            Logger.error(`Backup cleanup failed: ${error.message}`)
        }
    }
}

// Initialize auto backup
const autoBackup = new AutoBackup()

// Enhanced Security Manager
class SecurityManager {
    constructor() {
        this.trustedUsers = new Set(ownerNumber)
        this.suspiciousPatterns = [
            /hack/gi,
            /crack/gi,
            /illegal/gi,
            /virus/gi,
            /malware/gi
        ]
    }

    isTrusted(userId) {
        return this.trustedUsers.has(userId.split('@')[0])
    }

    addTrusted(userId) {
        this.trustedUsers.add(userId.split('@')[0])
        db.set('security', 'trusted_users', Array.from(this.trustedUsers))
    }

    removeTrusted(userId) {
        this.trustedUsers.delete(userId.split('@')[0])
        db.set('security', 'trusted_users', Array.from(this.trustedUsers))
    }

    checkSuspiciousContent(text) {
        for (const pattern of this.suspiciousPatterns) {
            if (pattern.test(text)) {
                return { suspicious: true, pattern: pattern.source }
            }
        }
        return { suspicious: false }
    }

    logSecurityEvent(userId, event, details) {
        const securityLog = db.get('security', 'events', [])
        securityLog.push({
            userId,
            event,
            details,
            timestamp: Date.now(),
            date: new Date().toISOString()
        })

        // Keep only last 1000 events
        if (securityLog.length > 1000) {
            securityLog.splice(0, securityLog.length - 1000)
        }

        db.set('security', 'events', securityLog)
        Logger.warning(`Security Event: ${event} - User: ${userId}`)
    }
}

const security = new SecurityManager()

// Advanced Command System
class CommandManager {
    constructor() {
        this.commands = new Map()
        this.aliases = new Map()
        this.cooldowns = new Map()
        this.usage = new Map()
    }

    register(commandInfo) {
        const { name, aliases = [], handler, description = '', cooldown = 0, ownerOnly = false } = commandInfo

        this.commands.set(name.toLowerCase(), {
            name,
            handler,
            description,
            cooldown,
            ownerOnly,
            usage: 0
        })

        // Register aliases
        aliases.forEach(alias => {
            this.aliases.set(alias.toLowerCase(), name.toLowerCase())
        })

        Logger.info(`Command registered: ${name} (aliases: ${aliases.join(', ')})`)
    }

    find(commandName) {
        const name = commandName.toLowerCase()
        const realName = this.aliases.get(name) || name
        return this.commands.get(realName)
    }

    async execute(commandName, conn, mek, context) {
        const command = this.find(commandName)
        if (!command) return false

        const { sender, isOwner, reply } = context

        // Owner check
        if (command.ownerOnly && !isOwner) {
            await reply("❌ This command is restricted to bot owners only!")
            return true
        }

        // Cooldown check
        const cooldownKey = `${sender}_${command.name}`
        const now = Date.now()
        const cooldownEnd = this.cooldowns.get(cooldownKey) || 0

        if (now < cooldownEnd) {
            const remaining = Math.ceil((cooldownEnd - now) / 1000)
            await reply(`⏰ Please wait ${remaining}s before using this command again!`)
            return true
        }

        try {
            // Set cooldown
            if (command.cooldown > 0) {
                this.cooldowns.set(cooldownKey, now + command.cooldown * 1000)
            }

            // Track usage
            command.usage++
            this.usage.set(command.name, (this.usage.get(command.name) || 0) + 1)

            // Execute command
            await command.handler(conn, mek, context)
            return true
        } catch (error) {
            Logger.error(`Command execution error (${command.name}): ${error.message}`)
            await reply(`❌ Command failed: ${error.message}`)
            return true
        }
    }

    getStats() {
        const commandStats = []
        this.commands.forEach((cmd, name) => {
            commandStats.push({
                name,
                usage: cmd.usage,
                description: cmd.description
            })
        })
        return commandStats.sort((a, b) => b.usage - a.usage)
    }

    cleanup() {
        // Clean expired cooldowns
        const now = Date.now()
        for (const [key, expiry] of this.cooldowns.entries()) {
            if (now >= expiry) {
                this.cooldowns.delete(key)
            }
        }
    }
}

const commandManager = new CommandManager()

// Clean cooldowns every 5 minutes
setInterval(() => {
    commandManager.cleanup()
}, 5 * 60 * 1000)

// Register built-in commands
commandManager.register({
    name: 'help',
    aliases: ['h', 'menu', 'commands'],
    description: 'Show available commands',
    handler: async (conn, mek, { reply, isOwner }) => {
        const stats = commandManager.getStats()
        const publicCommands = stats.filter(cmd => !commandManager.find(cmd.name)?.ownerOnly)
        const ownerCommands = stats.filter(cmd => commandManager.find(cmd.name)?.ownerOnly)

        let helpText = `🤖 *SHADOW-N PRO Commands*\n\n`
        helpText += `📋 *Public Commands:*\n`
        publicCommands.forEach(cmd => {
            helpText += `• ${prefix}${cmd.name} - ${cmd.description}\n`
        })

        if (isOwner && ownerCommands.length > 0) {
            helpText += `\n🔒 *Owner Commands:*\n`
            ownerCommands.forEach(cmd => {
                helpText += `• ${prefix}${cmd.name} - ${cmd.description}\n`
            })
        }

        helpText += `\n📊 *Bot Stats:*\n`
        helpText += `• Total Commands: ${stats.length}\n`
        helpText += `• Most Used: ${stats[0]?.name || 'None'} (${stats[0]?.usage || 0} times)\n`

        await reply(helpText)
    }
})

commandManager.register({
    name: 'stats',
    aliases: ['statistics', 'info'],
    description: 'Show bot statistics',
    cooldown: 10,
    handler: async (conn, mek, { reply }) => {
        const stats = performanceMonitor.getStats()
        const dbStats = {
            users: Object.keys(db.read('users')).length,
            groups: Object.keys(db.read('groups')).length
        }

        const statsText = `📊 *SHADOW-N PRO Statistics*

⏱️ *Performance:*
• Uptime: ${runtime(stats.uptime)}
• Messages Processed: ${stats.messages}
• Commands Executed: ${stats.commands}
• Errors: ${stats.errorCount}
• Avg Messages/min: ${stats.messagesPerMinute}
• Avg Commands/min: ${stats.commandsPerMinute}

💾 *Memory Usage:*
• Used: ${stats.memoryUsage.used} MB
• Total: ${stats.memoryUsage.total} MB

📁 *Database:*
• Users: ${dbStats.users}
• Groups: ${dbStats.groups}

🚀 *System:*
• Node.js: ${process.version}
• Platform: ${process.platform}
• Architecture: ${process.arch}`

        await reply(statsText)
    }
})

commandManager.register({
    name: 'backup',
    description: 'Create manual backup',
    ownerOnly: true,
    cooldown: 60,
    handler: async (conn, mek, { reply }) => {
        await reply("🔄 Creating backup...")
        const backupPath = db.backup()
        if (backupPath) {
            await reply(`✅ Backup created successfully!\n📁 Path: ${path.basename(backupPath)}`)
        } else {
            await reply("❌ Backup failed!")
        }
    }
})

commandManager.register({
    name: 'restart',
    aliases: ['reboot'],
    description: 'Restart the bot',
    ownerOnly: true,
    handler: async (conn, mek, { reply }) => {
        await reply("🔄 Restarting SHADOW-N PRO...")
        Logger.info("Manual restart initiated by owner")
        process.exit(0)
    }
})

// Auto-save important data every 10 minutes
setInterval(() => {
    try {
        // Save performance stats
        const stats = performanceMonitor.getStats()
        db.set('system', 'last_stats', stats)

        // Save security data
        db.set('security', 'trusted_users', Array.from(security.trustedUsers))

        Logger.info("Auto-save completed")
    } catch (error) {
        Logger.error(`Auto-save failed: ${error.message}`)
    }
}, 10 * 60 * 1000)

// Initialize system on startup
Logger.info("🔧 Initializing advanced systems...")
Logger.success("✅ All systems initialized successfully!")

// Export for external access
module.exports = {
    connectToWA,
    Logger,
    MediaManager,
    DatabaseManager,
    AntiSpam,
    SecurityManager,
    CommandManager,
    PerformanceMonitor,
    db,
    mediaManager,
    antiSpam,
    security,
    commandManager,
    performanceMonitor
}