const ytdl = require('ytdl-core');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { exec } = require('child_process');
const util = require('util');
// Try different possible paths for the command module
let cmd;
try {
    cmd = require('../command').cmd;
} catch (e) {
    try {
        cmd = require('./command').cmd;
    } catch (e2) {
        try {
            cmd = require('../../command').cmd;
        } catch (e3) {
            console.error('Could not find command module. Please check the path.');
            // Fallback: create a simple cmd function
            const commands = [];
            cmd = (pattern, desc, type = "general") => {
                return function(handler) {
                    const command = { pattern, desc, type, handler };
                    commands.push(command);
                    console.log(`📝 Registered command: ${pattern}`);
                    return command;
                };
            };
        }
    }
}
const execPromise = util.promisify(exec);

// YouTube MP3 Downloader Class - Limits Removed
class YouTubeMP3Downloader {
    constructor() {
        this.downloadPath = path.join(__dirname, 'media', 'audio');
        this.tempPath = path.join(__dirname, 'media', 'temp');
        // Removed file size and duration limits
        
        // Ensure directories exist
        this.ensureDirectories();
    }

    // Ensure required directories exist
    ensureDirectories() {
        [this.downloadPath, this.tempPath].forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        });
    }

    // Validate YouTube URL
    isValidYouTubeUrl(url) {
        const youtubeRegex = /^(https?\:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/;
        return youtubeRegex.test(url);
    }

    // Extract video ID from URL
    extractVideoId(url) {
        const regex = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/;
        const match = url.match(regex);
        return match ? match[1] : null;
    }

    // Get video info with better error handling - No duration limit
    async getVideoInfo(url) {
        try {
            if (!this.isValidYouTubeUrl(url)) {
                throw new Error('Invalid YouTube URL');
            }

            const agents = [
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            ];

            let info;
            for (const agent of agents) {
                try {
                    info = await ytdl.getInfo(url, {
                        requestOptions: {
                            headers: {
                                'User-Agent': agent,
                                'Accept-Language': 'en-US,en;q=0.9',
                                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
                            }
                        }
                    });
                    break;
                } catch (e) {
                    console.log(`Failed with agent ${agent.substring(0, 20)}...`);
                    if (agents.indexOf(agent) === agents.length - 1) throw e;
                }
            }

            const videoDetails = info.videoDetails;

            // Removed duration check - no limits

            return {
                title: videoDetails.title,
                duration: videoDetails.lengthSeconds,
                thumbnail: videoDetails.thumbnails[videoDetails.thumbnails.length - 1]?.url,
                author: videoDetails.author.name,
                views: videoDetails.viewCount,
                description: videoDetails.shortDescription
            };
        } catch (error) {
            throw new Error(`Failed to get video info: ${error.message}`);
        }
    }

    // Download audio with no size limits
    async downloadWithYtdlCore(url, outputPath) {
        return new Promise((resolve, reject) => {
            try {
                const stream = ytdl(url, {
                    filter: 'audioonly',
                    quality: 'highestaudio',
                    format: 'mp4',
                    requestOptions: {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                        }
                    }
                });

                const writeStream = fs.createWriteStream(outputPath);
                let downloadedBytes = 0;

                stream.on('data', (chunk) => {
                    downloadedBytes += chunk.length;
                    // Removed size limit check
                });

                stream.pipe(writeStream);

                writeStream.on('finish', () => {
                    resolve(outputPath);
                });

                writeStream.on('error', (error) => {
                    if (fs.existsSync(outputPath)) {
                        fs.unlinkSync(outputPath);
                    }
                    reject(error);
                });

                stream.on('error', (error) => {
                    if (fs.existsSync(outputPath)) {
                        fs.unlinkSync(outputPath);
                    }
                    reject(error);
                });

            } catch (error) {
                reject(error);
            }
        });
    }

    // Convert to MP3 using FFmpeg
    async convertToMP3(inputPath, outputPath) {
        try {
            const command = `ffmpeg -i "${inputPath}" -vn -acodec libmp3lame -b:a 192k "${outputPath}"`; // Increased bitrate
            await execPromise(command);

            // Remove original file
            if (fs.existsSync(inputPath)) {
                fs.unlinkSync(inputPath);
            }

            return outputPath;
        } catch (error) {
            throw new Error(`Conversion failed: ${error.message}`);
        }
    }

    // Clean filename for file system
    cleanFilename(filename) {
        return filename
            .replace(/[^\w\s-]/g, '') // Remove special characters
            .replace(/\s+/g, '_') // Replace spaces with underscores
            .substring(0, 150); // Increased length limit
    }

    // Main download function - tries ytdl-core first, then yt2mate
    async download(url) {
        try {
            // Get video info first
            const videoInfo = await this.getVideoInfo(url);
            const cleanTitle = this.cleanFilename(videoInfo.title);
            const filename = `${cleanTitle}_${Date.now()}.mp4`;
            const mp3Filename = `${cleanTitle}_${Date.now()}.mp3`;

            // Try ytdl-core first
            try {
                const audioPath = await this.downloadWithYtdlCore(url, path.join(this.downloadPath, filename));
                
                // Try to convert to MP3 if FFmpeg is available
                let finalPath = audioPath;
                try {
                    const mp3Path = path.join(this.downloadPath, mp3Filename);
                    finalPath = await this.convertToMP3(audioPath, mp3Path);
                } catch (conversionError) {
                    console.log('FFmpeg conversion failed, keeping original format');
                }

                return {
                    success: true,
                    filePath: finalPath,
                    videoInfo,
                    fileSize: fs.statSync(finalPath).size
                };

            } catch (ytdlError) {
                console.log('ytdl-core failed, trying yt2mate API...');
                
                // Fallback to yt2mate API
                return await this.downloadWithYt2mate(url, videoInfo);
            }

        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Download using yt2mate API
    async downloadWithYt2mate(url, videoInfo = null) {
        try {
            const videoId = this.extractVideoId(url);
            if (!videoId) {
                throw new Error('Could not extract video ID');
            }

            // Step 1: Get download links from yt2mate
            console.log('Getting download links from yt2mate...');
            
            const analyzeResponse = await axios.post('https://www.yt2mate.com/mates/analyzeV2/ajax', 
                new URLSearchParams({
                    k_query: url,
                    k_page: 'home',
                    hl: 'en',
                    q_auto: '0'
                }), {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'X-Requested-With': 'XMLHttpRequest',
                    'Referer': 'https://www.yt2mate.com/',
                    'Origin': 'https://www.yt2mate.com'
                },
                timeout: 30000
            });

            if (analyzeResponse.data.status !== 'ok') {
                throw new Error('Failed to analyze video');
            }

            // Parse the HTML response to find MP3 download options
            const htmlData = analyzeResponse.data.result;
            
            // Look for MP3 128kbps option (most common)
            const mp3Match = htmlData.match(/data-ftype="mp3"[^>]*data-fquality="128"[^>]*onclick="[^"]*'([^']+)'[^"]*"[^>]*>[\s\S]*?Download/i);
            
            if (!mp3Match) {
                throw new Error('No MP3 download option found');
            }

            const kValue = mp3Match[1];
            
            // Step 2: Convert and get download link
            console.log('Converting to MP3...');
            
            const convertResponse = await axios.post('https://www.yt2mate.com/mates/convertV2/ajax', 
                new URLSearchParams({
                    vid: videoId,
                    k: kValue
                }), {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'X-Requested-With': 'XMLHttpRequest',
                    'Referer': 'https://www.yt2mate.com/',
                    'Origin': 'https://www.yt2mate.com'
                },
                timeout: 60000
            });

            if (convertResponse.data.status !== 'ok') {
                throw new Error('Conversion failed');
            }

            // Extract download URL
            const downloadMatch = convertResponse.data.result.match(/href="([^"]+)"/);
            if (!downloadMatch) {
                throw new Error('Download URL not found');
            }

            const downloadUrl = downloadMatch[1];
            
            // Step 3: Download the file
            console.log('Downloading MP3 file...');
            
            const cleanTitle = videoInfo ? this.cleanFilename(videoInfo.title) : `youtube_audio_${Date.now()}`;
            const filename = `${cleanTitle}.mp3`;
            const filePath = path.join(this.downloadPath, filename);

            const downloadResponse = await axios({
                method: 'GET',
                url: downloadUrl,
                responseType: 'stream',
                timeout: 300000, // 5 minutes timeout for large files
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Referer': 'https://www.yt2mate.com/'
                }
            });

            const writer = fs.createWriteStream(filePath);
            downloadResponse.data.pipe(writer);

            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });

            return {
                success: true,
                filePath: filePath,
                videoInfo: videoInfo || { title: cleanTitle, author: 'Unknown', duration: 'Unknown' },
                fileSize: fs.statSync(filePath).size
            };

        } catch (error) {
            throw new Error(`yt2mate download failed: ${error.message}`);
        }
    }

    // Cleanup old files
    cleanup() {
        try {
            const files = fs.readdirSync(this.downloadPath);
            const now = Date.now();
            const maxAge = 2 * 60 * 60 * 1000; // 2 hours (increased from 1 hour)

            files.forEach(file => {
                const filePath = path.join(this.downloadPath, file);
                const stats = fs.statSync(filePath);

                if (now - stats.mtime.getTime() > maxAge) {
                    fs.unlinkSync(filePath);
                    console.log(`Cleaned up old file: ${file}`);
                }
            });
        } catch (error) {
            console.error('Cleanup error:', error.message);
        }
    }
}

// Create instance
const ytDownloader = new YouTubeMP3Downloader();

// Cleanup old files every 2 hours
setInterval(() => {
    ytDownloader.cleanup();
}, 2 * 60 * 60 * 1000);

// Helper function to edit messages
async function editMessage(conn, key, text) {
    try {
        if (conn.edite) {
            return await conn.edite(key, text);
        } else if (conn.sendMessage) {
            await conn.sendMessage(key.remoteJid, { text: text });
            return await conn.sendMessage(key.remoteJid, { delete: key });
        }
    } catch (error) {
        console.log('Edit message failed:', error.message);
    }
}

// YTMP3 Command - No limits
cmd('ytmp3', 'Download YouTube video as MP3', 'media')(async (conn, mek, m) => {
    try {
        const text = m.body?.split(' ').slice(1).join(' ') || m.text?.split(' ').slice(1).join(' ') || '';

        if (!text) {
            return await m.reply(`❌ Please provide a YouTube URL!\n\nUsage: .ytmp3 <YouTube URL>`);
        }

        const url = text.trim();

        if (!ytDownloader.isValidYouTubeUrl(url)) {
            return await m.reply('❌ Please provide a valid YouTube URL!');
        }

        // Send processing message
        const processingMsg = await m.reply('🔄 Processing your request...\n⏳ Getting video information...');

        try {
            const result = await ytDownloader.download(url);

            if (result.success) {
                await editMessage(conn, processingMsg.key, '📥 Uploading audio file...');

                // Send the audio file
                const audioBuffer = fs.readFileSync(result.filePath);
                const fileExtension = path.extname(result.filePath);
                const fileName = `${result.videoInfo.title}${fileExtension}`;

                // Format file size
                const fileSize = (result.fileSize / (1024 * 1024)).toFixed(2);

                const caption = `🎵 *YouTube MP3 Download*

📝 *Title:* ${result.videoInfo.title}
👤 *Author:* ${result.videoInfo.author}
⏱️ *Duration:* ${result.videoInfo.duration ? `${Math.floor(result.videoInfo.duration / 60)}:${(result.videoInfo.duration % 60).toString().padStart(2, '0')}` : 'Unknown'}
📊 *File Size:* ${fileSize} MB
👁️ *Views:* ${result.videoInfo.views ? parseInt(result.videoInfo.views).toLocaleString() : 'Unknown'}

🤖 Downloaded by SHADOW-N PRO
🚀 No file size or duration limits!`;

                // Get thumbnail
                let thumbnailBuffer = null;
                if (result.videoInfo.thumbnail) {
                    try {
                        const thumbnailResponse = await axios.get(result.videoInfo.thumbnail, { responseType: 'arraybuffer', timeout: 10000 });
                        thumbnailBuffer = thumbnailResponse.data;
                    } catch (err) {
                        console.log('Failed to fetch thumbnail:', err.message);
                    }
                }

                await conn.sendMessage(m.from, {
                    audio: audioBuffer,
                    mimetype: 'audio/mpeg',
                    fileName: fileName,
                    caption: caption,
                    contextInfo: {
                        externalAdReply: {
                            title: result.videoInfo.title,
                            body: `By ${result.videoInfo.author}`,
                            thumbnail: thumbnailBuffer,
                            mediaType: 2,
                            mediaUrl: url,
                            sourceUrl: url
                        }
                    }
                });

                // Delete processing message
                try {
                    await conn.sendMessage(m.from, { delete: processingMsg.key });
                } catch (err) {
                    console.log('Failed to delete processing message:', err.message);
                }

                // Clean up downloaded file after 30 seconds
                setTimeout(() => {
                    if (fs.existsSync(result.filePath)) {
                        fs.unlinkSync(result.filePath);
                    }
                }, 30000);

            } else {
                await editMessage(conn, processingMsg.key, `❌ Download failed: ${result.error}\n\n💡 Try again or use a different YouTube URL.`);
            }

        } catch (error) {
            await editMessage(conn, processingMsg.key, `❌ Error: ${error.message}`);
        }

    } catch (error) {
        console.error('YTMP3 Command Error:', error);
        await m.reply(`❌ An error occurred: ${error.message}`);
    }
});

// YT Info Command - No limits
cmd('ytinfo', 'Get YouTube video information', 'media')(async (conn, mek, m) => {
    try {
        const text = m.body?.split(' ').slice(1).join(' ') || m.text?.split(' ').slice(1).join(' ') || '';

        if (!text) {
            return await m.reply(`❌ Please provide a YouTube URL!\n\nUsage: .ytinfo <YouTube URL>`);
        }

        const url = text.trim();

        if (!ytDownloader.isValidYouTubeUrl(url)) {
            return await m.reply('❌ Please provide a valid YouTube URL!');
        }

        const infoMsg = await m.reply('🔍 Getting video information...');

        try {
            const videoInfo = await ytDownloader.getVideoInfo(url);

            const duration = videoInfo.duration ? `${Math.floor(videoInfo.duration / 60)}:${(videoInfo.duration % 60).toString().padStart(2, '0')}` : 'Unknown';
            const views = videoInfo.views ? parseInt(videoInfo.views).toLocaleString() : 'Unknown';

            const infoText = `📺 *YouTube Video Information*

📝 *Title:* ${videoInfo.title}
👤 *Author:* ${videoInfo.author}
⏱️ *Duration:* ${duration}
👁️ *Views:* ${views}

📖 *Description:*
${videoInfo.description ? videoInfo.description.substring(0, 300) + (videoInfo.description.length > 300 ? '...' : '') : 'No description available'}

🔗 *URL:* ${url}

✅ *No size or duration limits for download!*`;

            await editMessage(conn, infoMsg.key, infoText);

        } catch (error) {
            await editMessage(conn, infoMsg.key, `❌ Failed to get video info: ${error.message}`);
        }

    } catch (error) {
        console.error('YTINFO Command Error:', error);
        await m.reply(`❌ An error occurred: ${error.message}`);
    }
});

// Additional aliases
cmd('yta', 'Download YouTube video as MP3', 'media')(async (conn, mek, m) => {
    // Execute ytmp3 command
    const ytmp3Commands = require('./ytmp3');
    const handlers = ytmp3Commands?.handlers || [];
    const ytmp3Handler = handlers.find(h => h.pattern === 'ytmp3');
    
    if (ytmp3Handler) {
        return await ytmp3Handler.handler(conn, mek, m);
    }
    
    // Fallback - call ytmp3 directly
    return await cmd('ytmp3').handler(conn, mek, m);
});

cmd('ytaudio', 'Download YouTube video as MP3', 'media')(async (conn, mek, m) => {
    // Same as yta
    return await cmd('ytmp3').handler(conn, mek, m);
});

module.exports = {
    YouTubeMP3Downloader,
    ytDownloader
};