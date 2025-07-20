const { cmd } = require('../command');

cmd(/^alive$/i, 'Check if bot is alive', 'general')(async (conn, mek, context) => {
    const { from, reply } = context;

    await reply(`🤖 *QUEEN-NELUMI-MD is alive!*

✅ Bot Status: Online
🔋 Uptime: ${process.uptime().toFixed(2)}s
📱 WhatsApp: Connected
🔧 Plugins: Working

_Made with ❤️ by QUEEN-NELUMI-MD_`);
});