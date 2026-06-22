const WebSocket = require('ws');
const fs = require('fs');

const WS_URL = 'ws://127.0.0.1:9222/devtools/page/8EE14A8E88A1FF90D6FF1B8E83B11A2A';
const GROUP_ID = '88882452212242';
const TARGET_URL = `https://wx.zsxq.com/group/${GROUP_ID}`;
const OUTPUT_FILE = 'C:\\Users\\77299\\.qclaw\\workspace\\zsxq_captured_topics.json';

let msgId = 0;
const callbacks = new Map();

function send(ws, method, params = {}) {
    const id = ++msgId;
    const msg = JSON.stringify({ id, method, params });
    ws.send(msg);
    return new Promise((resolve, reject) => {
        callbacks.set(id, { resolve, reject, method });
        setTimeout(() => {
            if (callbacks.has(id)) {
                callbacks.delete(id);
                reject(new Error(`Timeout: ${method}`));
            }
        }, 30000);
    });
}

async function main() {
    const ws = new WebSocket(WS_URL);
    
    await new Promise((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
        setTimeout(() => reject(new Error('Connection timeout')), 10000);
    });

    console.log('Connected to CDP');

    // Store captured API responses
    const capturedRequests = [];

    ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        
        // Handle method responses
        if (msg.id && callbacks.has(msg.id)) {
            const cb = callbacks.get(msg.id);
            callbacks.delete(msg.id);
            if (msg.error) {
                cb.reject(new Error(`${cb.method}: ${JSON.stringify(msg.error)}`));
            } else {
                cb.resolve(msg.result);
            }
        }
        
        // Capture API responses
        if (msg.method === 'Network.responseReceived') {
            const url = msg.params.response.url;
            if (url && url.includes('api.zsxq.com') && url.includes('topics')) {
                capturedRequests.push({
                    requestId: msg.params.requestId,
                    url: url,
                    timestamp: Date.now()
                });
                console.log(`Captured API: ${url}`);
            }
        }
    });

    // Enable Network
    await send(ws, 'Network.enable');
    console.log('Network enabled');

    // Navigate to war planet
    await send(ws, 'Page.navigate', { url: TARGET_URL });
    console.log(`Navigated to ${TARGET_URL}`);

    // Wait for API responses (React loads and makes API calls)
    console.log('Waiting for page to load and make API calls...');
    await new Promise(r => setTimeout(r, 15000));

    // Also try scrolling to load more
    await send(ws, 'Runtime.evaluate', { 
        expression: 'window.scrollTo(0, document.body.scrollHeight)',
        returnByValue: true 
    });
    await new Promise(r => setTimeout(r, 5000));

    console.log(`Captured ${capturedRequests.length} API requests`);

    // Get response bodies
    const allTopics = [];
    for (const req of capturedRequests) {
        try {
            const result = await send(ws, 'Network.getResponseBody', { requestId: req.requestId });
            if (result && result.body) {
                const parsed = JSON.parse(result.body);
                if (parsed.resp_data && parsed.resp_data.topics) {
                    const topics = parsed.resp_data.topics;
                    console.log(`Got ${topics.length} topics from ${req.url}`);
                    for (const t of topics) {
                        allTopics.push({
                            topic_id: t.topic_id,
                            create_time: t.create_time,
                            type: t.type,
                            talk: t.talk ? {
                                text: t.talk.text || '',
                                author: t.talk.author ? {
                                    name: t.talk.author.name || '未知作者'
                                } : { name: '未知作者' }
                            } : null,
                            title: t.title || '',
                            show_comments: t.show_comments || []
                        });
                    }
                }
            }
        } catch (e) {
            console.log(`Failed to get body for ${req.requestId}: ${e.message}`);
        }
    }

    // Deduplicate by topic_id
    const seen = new Set();
    const uniqueTopics = allTopics.filter(t => {
        if (seen.has(t.topic_id)) return false;
        seen.add(t.topic_id);
        return true;
    });

    console.log(`Total unique topics: ${uniqueTopics.length}`);

    // Save to file
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(uniqueTopics, null, 2), 'utf-8');
    console.log(`Saved to ${OUTPUT_FILE}`);

    // Print topic summaries
    for (const t of uniqueTopics) {
        const time = t.create_time || 'unknown';
        const author = t.talk?.author?.name || '未知作者';
        const textPreview = (t.talk?.text || t.title || '').replace(/<[^>]+>/g, '').substring(0, 100);
        console.log(`[${time}] ${author}: ${textPreview}...`);
    }

    ws.close();
    console.log('Done');
}

main().catch(e => {
    console.error('Error:', e.message);
    process.exit(1);
});
