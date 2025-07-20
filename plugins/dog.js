const { cmd } = require('../command');

cmd(/^dog$/i, 'Get random dog image', 'fun')(async (conn, mek, context) => {
    const { from, reply } = context;

    try {
        // Send typing indicator
        await conn.sendPresenceUpdate('composing', from);

        const response = await fetch('https://dog.ceo/api/breeds/image/random');
        const data = await response.json();

        await conn.sendMessage(from, {
            image: { url: data.message },
            caption: "🐕 *Here's a random dog for you!*\n\n_Powered by QUEEN-NELUMI-MD_"
        }, { quoted: mek });

        // Stop typing indicator
        await conn.sendPresenceUpdate('paused', from);

    } catch (error) {
        console.error('Dog command error:', error);
        await reply("❌ Failed to fetch dog image. Please try again later.");
    }
});