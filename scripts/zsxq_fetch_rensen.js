// Fetch 人生要选对 (group 222588821821) topics via CDP
const WebSocket = require('ws');
const https = require('https');

const WS_URL = 'ws://127.0.0.1:9222/devtools/page/2A06AB4D6793B5371F1ACEF6CB15E9EA';
const GROUP_ID = '222588821821';
const LAST_CHECK = '2026-06-22T00:46:00.000Z';

// Helper: send CDP command and get response
function sendCommand(ws, method, params = {}) {
    const id = Math.floor(Math.random() * 1000000);
    return new Promise((resolve, reject) => {
        const handler = (data) => {
            try {
                const msg = JSON.parse(data.toString());
                if (msg.id === id) {
                    ws.removeListener('message', handler);
                    resolve(msg.result);
                }
            } catch(e) {}
        };
        ws.on('message', handler);
        ws.send(JSON.stringify({ id, method, params }));
        setTimeout(() => {
            ws.removeListener('message', handler);
            reject(new Error(`Timeout: ${method}`));
        }, 15000);
    });
}

async function main() {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(WS_URL);
        const captured = [];
        
        ws.on('open', async () => {
            console.log('[CDP] Connected');
            
            try {
                // Enable Network domain
                await sendCommand(ws, 'Network.enable');
                console.log('[CDP] Network enabled');
                
                // Listen for API responses
                ws.on('message', (data) => {
                    try {
                        const msg = JSON.parse(data.toString());
                        if (msg.method === 'Network.responseReceived') {
                            const url = msg.params.response.url;
                            if (url && url.includes('api.zsxq.com') && url.includes('topics')) {
                                captured.push({ requestId: msg.params.requestId, url });
                                console.log('[CDP] Captured API response:', url.substring(0, 120));
                            }
                        }
                    } catch(e) {}
                });
                
                // Navigate to refresh the page (trigger React to fetch API)
                console.log('[CDP] Navigating to group page...');
                await sendCommand(ws, 'Page.navigate', { url: `https://wx.zsxq.com/group/${GROUP_ID}` });
                
                // Wait for API calls
                console.log('[CDP] Waiting 20s for API responses...');
                await new Promise(r => setTimeout(r, 20000));
                
                console.log(`[CDP] Captured ${captured.length} API responses`);
                
                if (captured.length === 0) {
                    console.log('[CDP] No API responses captured - trying direct JS fetch...');
                    
                    // Fallback: try direct fetch via Runtime.evaluate
                    const fetchResult = await sendCommand(ws, 'Runtime.evaluate', {
                        expression: `
                            (async () => {
                                try {
                                    const resp = await fetch('https://api.zsxq.com/v2/groups/${GROUP_ID}/topics?scope=all&count=20');
                                    const text = await resp.text();
                                    return JSON.stringify({ ok: resp.ok, status: resp.status, preview: text.substring(0, 300) });
                                } catch(e) {
                                    return JSON.stringify({ error: e.message });
                                }
                            })()
                        `,
                        returnByValue: true,
                        awaitPromise: true
                    });
                    console.log('[CDP] Direct fetch result:', JSON.stringify(fetchResult, null, 2));
                    resolve({ topics: [], error: 'No API responses captured and direct fetch failed', fetchResult });
                    return;
                }
                
                // Get response bodies
                const topics = [];
                for (const cap of captured) {
                    try {
                        const bodyResult = await sendCommand(ws, 'Network.getResponseBody', { requestId: cap.requestId });
                        if (bodyResult && bodyResult.body) {
                            const data = JSON.parse(bodyResult.body);
                            if (data.resp_data && data.resp_data.topics) {
                                for (const t of data.resp_data.topics) {
                                    topics.push({
                                        topic_id: t.topic_id,
                                        create_time: t.create_time,
                                        type: t.type,
                                        title: t.title || '',
                                        text: t.talk ? (t.talk.text || '') : (t.text || ''),
                                        author: t.talk && t.talk.author ? (t.talk.author.name || '匿名') : '匿名',
                                        comments_count: t.comments_count || 0,
                                        likes_count: t.likes_count || 0,
                                        reading_count: t.reading_count || 0
                                    });
                                }
                            }
                        }
                    } catch(e) {
                        console.error('[CDP] Error getting body for', cap.requestId, e.message);
                    }
                }
                
                resolve({ topics, total: topics.length });
                
            } catch(e) {
                reject(e);
            } finally {
                ws.close();
            }
        });
        
        ws.on('error', reject);
        setTimeout(() => reject(new Error('Overall timeout')), 60000);
    });
}

main().then(result => {
    // Filter new topics since last check
    const lastCheck = new Date(LAST_CHECK).getTime();
    const newTopics = (result.topics || []).filter(t => {
        return new Date(t.create_time).getTime() > lastCheck;
    });
    
    const output = {
        total_fetched: result.total || 0,
        new_count: newTopics.length,
        new_topics: newTopics,
        last_check: LAST_CHECK,
        error: result.error || null
    };
    
    console.log('\n=== RESULT ===');
    console.log(JSON.stringify(output, null, 2));
}).catch(err => {
    console.error('FATAL:', err.message);
    process.exit(1);
});
