const fs = require('fs');
const axios = require('axios');
const { cmd } = require('../command');

// Register the .img command using your cmd pattern
cmd(/^img$/i, 'Search and send 3 images from the internet', 'media')(async (conn, mek, context) => {
    const { from, reply, args, q, m } = context;

    try {
        console.log('IMG Command triggered:', { from, q });

        // React with search emoji when command is requested
        if (m && m.react) {
            await m.react('🔍');
        }

        // Check if search query is provided
        if (!q || q.trim() === '') {
            if (m && m.react) await m.react('❌');
            return await reply(`❌ *Please provide a search query!*\n\n📝 *Usage:* .img <search term>\n💡 *Example:* .img cats`);
        }

        console.log('Searching for:', q);

        // Send typing indicator
        await conn.sendPresenceUpdate('composing', from);

        // Show searching message
        await reply(`🔍 *Searching for 3 images...*\n📝 *Query:* ${q}\n⏳ *Please wait...*`);

        // Get 3 images based on query
        const images = await getImages(q.trim());

        if (!images || images.length === 0) {
            if (m && m.react) await m.react('❌');
            await conn.sendPresenceUpdate('paused', from);
            return await reply(`❌ *No images found for "${q}"*\n\n💡 *Try different keywords.*`);
        }

        console.log(`Found ${images.length} images`);

        // Send up to 3 images
        const imagesToSend = images.slice(0, 3);

        for (let i = 0; i < imagesToSend.length; i++) {
            try {
                const imageUrl = imagesToSend[i];
                console.log(`Sending image ${i + 1}:`, imageUrl);

                // Create caption for each image
                const caption = `🎨 *SHADOW-N PRO* | *Image ${i + 1}/${imagesToSend.length}*\n\n` +
                              `📝 *Query:* ${q}\n` +
                              `🖼️ *Image Source:* Free API\n\n` +
                              `✨ *Powered by SHADOW-N PRO*`;

                // Send image directly from URL
                await conn.sendMessage(from, {
                    image: { url: imageUrl },
                    caption: caption
                }, { quoted: mek });

                // Small delay between images
                if (i < imagesToSend.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }

            } catch (imageError) {
                console.error(`Error sending image ${i + 1}:`, imageError);
                continue;
            }
        }

        // Stop typing indicator and react with success emoji
        await conn.sendPresenceUpdate('paused', from);
        if (m && m.react) {
            await m.react('✅');
        }

        console.log('IMG command completed successfully');

    } catch (error) {
        console.error('IMG Command Error:', error);
        if (m && m.react) await m.react('❌');
        await conn.sendPresenceUpdate('paused', from);
        await reply(`❌ *Error occurred while fetching images!*\n\n🔧 *Error:* ${error.message}\n\n💡 *Please try again.*`);
    }
});

// Simplified function to get images based on query
async function getImages(query) {
    const lowerQuery = query.toLowerCase();

    try {
        // Route to appropriate image source based on query
        if (lowerQuery.includes('dog') || lowerQuery.includes('puppy')) {
            return await getDogImages();
        } else if (lowerQuery.includes('cat') || lowerQuery.includes('kitten')) {
            return await getCatImages();
        } else if (lowerQuery.includes('anime') || lowerQuery.includes('waifu')) {
            return await getAnimeImages();
        } else {
            return await getRandomImages(query);
        }
    } catch (error) {
        console.error('Error in getImages:', error);
        // Fallback to random images
        return await getRandomImages(query);
    }
}

// Get dog images from Dog CEO API
async function getDogImages() {
    try {
        const response = await axios.get('https://dog.ceo/api/breeds/image/random/3', {
            timeout: 10000
        });

        if (response.data && response.data.message && Array.isArray(response.data.message)) {
            return response.data.message;
        }
        throw new Error('Invalid dog API response');
    } catch (error) {
        console.error('Dog API Error:', error);
        throw error;
    }
}

// Get cat images from Cat API
async function getCatImages() {
    try {
        const images = [];

        // Get 3 cat images
        for (let i = 0; i < 3; i++) {
            const response = await axios.get('https://api.thecatapi.com/v1/images/search', {
                timeout: 10000
            });

            if (response.data && response.data[0] && response.data[0].url) {
                images.push(response.data[0].url);
            }
        }

        if (images.length === 0) {
            throw new Error('No cat images found');
        }

        return images;
    } catch (error) {
        console.error('Cat API Error:', error);
        throw error;
    }
}

// Get anime images from Waifu API
async function getAnimeImages() {
    try {
        const images = [];
        const animeEndpoints = ['waifu', 'neko', 'shinobu'];

        for (let i = 0; i < 3; i++) {
            const randomEndpoint = animeEndpoints[Math.floor(Math.random() * animeEndpoints.length)];
            const response = await axios.get(`https://api.waifu.pics/sfw/${randomEndpoint}`, {
                timeout: 10000
            });

            if (response.data && response.data.url) {
                images.push(response.data.url);
            }
        }

        if (images.length === 0) {
            throw new Error('No anime images found');
        }

        return images;
    } catch (error) {
        console.error('Anime API Error:', error);
        throw error;
    }
}

// Get random images from Lorem Picsum
async function getRandomImages(query) {
    try {
        const images = [];
        const dimensions = ['800/600', '900/600', '1000/667'];

        for (let i = 0; i < 3; i++) {
            const randomDimension = dimensions[i % dimensions.length];
            const randomId = Math.floor(Math.random() * 1000) + (i * 100);

            // Create unique URLs to avoid duplicates
            const imageUrl = `https://picsum.photos/${randomDimension}?random=${randomId}`;
            images.push(imageUrl);
        }

        return images;
    } catch (error) {
        console.error('Random Image Error:', error);
        throw error;
    }
}