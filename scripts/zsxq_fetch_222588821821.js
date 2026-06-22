// Fetch 人生要选对 group topics via CDP - immediate body capture
const http = require('http');
const WebSocket = require('ws');

const GROUP_ID = '222588821821';
const LAST_SYNC_TIME = '2026-06-20T17:03:30.000Z';
const CDP_PORT = 9222;

async function main() {
  // 1. Get tab
  const tabs = await getJSON(`http://127.0.0.1:${CDP_PORT}/json`);
  const targetTab = tabs.find(t => t.url && t.url.includes(`group/${GROUP_ID}`));
  if (!targetTab) { console.error('NO_TAB'); process.exit(1); }
  console.error(`Tab: ${targetTab.url}`);

  // 2. Connect WebSocket
  const ws = new WebSocket(targetTab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
    setTimeout(() => reject(new Error('ws timeout')), 10000);
  });

  let msgId = 1;
  const pending = new Map();
  function send(method, params = {}) {
    const id = msgId++;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`Timeout: ${method}`)); } }, 30000);
    });
  }

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    } catch (e) {}
  });

  // 3. Real-time capture: intercept response bodies immediately
  const allTopics = [];
  const seenTopicIds = new Set();
  let captureResolve;
  const captureDone = new Promise(r => { captureResolve = r; });

  // Buffer for partial body chunks (for dataReceived events)
  const bodyChunks = new Map();

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      
      if (msg.method === 'Network.responseReceived') {
        const url = msg.params.response.url;
        if (url && url.includes('api.zsxq.com') && url.includes('topics')) {
          console.error(`Response: ${url.substring(0, 100)}`);
          bodyChunks.set(msg.params.requestId, []);
        }
      }
      
      if (msg.method === 'Network.dataReceived') {
        const rid = msg.params.requestId;
        if (bodyChunks.has(rid)) {
          // body might be base64 encoded
          const chunk = msg.params.data || '';
          bodyChunks.get(rid).push(chunk);
        }
      }
      
      if (msg.method === 'Network.loadingFinished') {
        const rid = msg.params.requestId;
        if (bodyChunks.has(rid)) {
          // Try to get full body via CDP
          try {
            const result = await send('Network.getResponseBody', { requestId: rid });
            if (result && result.body) {
              const json = JSON.parse(result.body);
              if (json.resp_data && json.resp_data.topics) {
                for (const topic of json.resp_data.topics) {
                  if (!seenTopicIds.has(topic.topic_id)) {
                    seenTopicIds.add(topic.topic_id);
                    allTopics.push(topic);
                  }
                }
              }
            }
          } catch (e) {
            // Try to assemble from chunks if getResponseBody fails
            try {
              const chunks = bodyChunks.get(rid) || [];
              if (chunks.length > 0) {
                // Chunks are base64-encoded
                let body = chunks.join('');
                // Try decoding base64
                try {
                  body = Buffer.from(body, 'base64').toString('utf8');
                } catch (be) {}
                const json = JSON.parse(body);
                if (json.resp_data && json.resp_data.topics) {
                  for (const topic of json.resp_data.topics) {
                    if (!seenTopicIds.has(topic.topic_id)) {
                      seenTopicIds.add(topic.topic_id);
                      allTopics.push(topic);
                    }
                  }
                }
              }
            } catch (e2) {
              console.error(`Body fail for ${rid}: ${e2.message}`);
            }
          }
          bodyChunks.delete(rid);
        }
      }
    } catch (e) {}
  });

  // 4. Enable Network and navigate
  await send('Network.enable');
  
  // Navigate to group page
  await send('Page.navigate', { url: `https://wx.zsxq.com/group/${GROUP_ID}` });
  console.error('Navigated...');

  // 5. Wait for all network activity to settle
  await sleep(25000);
  
  // Also try to explicitly fetch via Runtime.evaluate as fallback
  console.error('Trying Runtime.evaluate fallback...');
  try {
    const result = await send('Runtime.evaluate', {
      expression: `
        (async () => {
          try {
            const resp = await fetch('https://api.zsxq.com/v2/groups/${GROUP_ID}/topics?scope=all&count=20');
            const text = await resp.text();
            return text;
          } catch(e) {
            return 'FETCH_ERROR:' + e.message;
          }
        })()
      `,
      returnByValue: true,
      awaitPromise: true,
      timeout: 20000
    });
    if (result && result.result && result.result.value) {
      const val = result.result.value;
      if (!val.startsWith('FETCH_ERROR')) {
        try {
          const json = JSON.parse(val);
          if (json.resp_data && json.resp_data.topics) {
            for (const topic of json.resp_data.topics) {
              if (!seenTopicIds.has(topic.topic_id)) {
                seenTopicIds.add(topic.topic_id);
                allTopics.push(topic);
              }
            }
          }
        } catch (e) {
          console.error(`Fallback parse error: ${e.message}, val preview: ${val.substring(0, 200)}`);
        }
      } else {
        console.error(`Fallback fetch error: ${val}`);
      }
    }
  } catch (e) {
    console.error(`Runtime.evaluate error: ${e.message}`);
  }

  captureResolve();
  await captureDone;
  ws.close();

  console.error(`Total topics: ${allTopics.length}`);

  // 6. Filter new topics
  const lastSync = new Date(LAST_SYNC_TIME);
  const newTopics = allTopics.filter(t => new Date(t.create_time) > lastSync);
  console.error(`New since ${LAST_SYNC_TIME}: ${newTopics.length}`);

  // Print latest topic times for debugging
  if (allTopics.length > 0) {
    const sorted = [...allTopics].sort((a, b) => new Date(b.create_time) - new Date(a.create_time));
    console.error(`Latest topic: ${sorted[0].create_time} - "${(sorted[0].talk?.text || sorted[0].title || '').substring(0, 60)}"`);
  }

  const result = {
    total: allTopics.length,
    new_count: newTopics.length,
    last_sync_time: LAST_SYNC_TIME,
    topics: newTopics.map(t => ({
      topic_id: t.topic_id,
      create_time: t.create_time,
      type: t.type,
      talk: t.talk ? {
        text: t.talk.text || '',
        author: t.talk.author ? (t.talk.author.name || '未知') : '未知',
      } : null,
      title: t.title || '',
      comments_count: t.comments_count || 0,
      likes_count: t.likes_count || 0,
    }))
  };

  console.log(JSON.stringify(result));
}

function getJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve(JSON.parse(body)));
      res.on('error', reject);
    });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(e => { console.error(`ERROR: ${e.message}`); process.exit(1); });
