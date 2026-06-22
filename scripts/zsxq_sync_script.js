// ZSXQ sync script - CDP Network interception approach
const { WebSocket } = require('ws');
const GROUP_ID = '88882452212242';
const CDP_BASE = 'http://127.0.0.1:9222';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function wsSend(ws, method, params = {}) {
  const id = Math.floor(Math.random() * 100000);
  const payload = JSON.stringify({ id, method, params });
  ws.send(payload);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timeout: ${method}`)), 30000);
    const handler = (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.id === id) {
          clearTimeout(timeout);
          ws.removeListener('message', handler);
          if (msg.error) reject(new Error(`${method}: ${JSON.stringify(msg.error)}`));
          else resolve(msg.result);
        }
      } catch (e) { /* ignore non-JSON */ }
    };
    ws.on('message', handler);
  });
}

async function main() {
  // Step 1: Get page list
  const resp = await fetch(`${CDP_BASE}/json`);
  const pages = await resp.json();
  
  let targetPage = pages.find(p => p.url && p.url.includes('zsxq.com') && p.url.includes(GROUP_ID));
  let wsUrl;
  
  if (targetPage) {
    console.log(`Found existing tab: ${targetPage.title} (${targetPage.id})`);
    wsUrl = targetPage.webSocketDebuggerUrl;
  } else {
    // Create new tab with PUT
    console.log('No existing zsxq tab for this group, creating new tab...');
    const newPageResp = await fetch(`${CDP_BASE}/json/new?url=about:blank`, { method: 'PUT' });
    const newPage = await newPageResp.json();
    wsUrl = newPage.webSocketDebuggerUrl;
    console.log(`Created new tab: ${newPage.id}`);
  }

  // Step 2: Connect WebSocket
  const ws = new WebSocket(wsUrl);
  
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
    setTimeout(() => reject(new Error('WebSocket connect timeout')), 10000);
  });
  
  console.log('WebSocket connected');

  // Step 3: Enable Network domain and set up response capture
  await wsSend(ws, 'Network.enable');
  
  const capturedResponses = [];
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.method === 'Network.responseReceived') {
        const url = msg.params.response.url;
        if (url && url.includes('api.zsxq.com') && url.includes('topics')) {
          capturedResponses.push({ 
            requestId: msg.params.requestId, 
            url: url
          });
          console.log(`Captured API response: ${url}`);
        }
      }
    } catch (e) { /* ignore */ }
  });

  // Step 4: Navigate to the group page to trigger API calls
  await wsSend(ws, 'Page.enable');
  
  // If we're on a tab that's already on zsxq, reload; otherwise navigate
  if (targetPage) {
    await wsSend(ws, 'Page.reload');
    console.log('Reloading existing page...');
  } else {
    await wsSend(ws, 'Page.navigate', { url: `https://wx.zsxq.com/group/${GROUP_ID}` });
    console.log('Navigated to group page...');
  }
  
  // Wait for page to load and API calls to happen
  console.log('Waiting for API responses (20s)...');
  await sleep(20000);

  // Step 5: Get response bodies
  console.log(`\nTotal API responses captured: ${capturedResponses.length}`);
  const allTopics = [];
  
  for (const resp of capturedResponses) {
    try {
      const bodyResult = await wsSend(ws, 'Network.getResponseBody', { requestId: resp.requestId });
      if (bodyResult && bodyResult.body) {
        const parsed = JSON.parse(bodyResult.body);
        if (parsed.resp_data && parsed.resp_data.topics) {
          allTopics.push(...parsed.resp_data.topics);
          console.log(`Got ${parsed.resp_data.topics.length} topics from ${resp.url}`);
        }
      }
    } catch (e) {
      console.log(`Failed to get body for ${resp.url}: ${e.message}`);
    }
  }

  // Deduplicate by topic_id
  const seen = new Set();
  const uniqueTopics = allTopics.filter(t => {
    if (seen.has(t.topic_id)) return false;
    seen.add(t.topic_id);
    return true;
  });
  
  // Sort by create_time descending
  uniqueTopics.sort((a, b) => new Date(b.create_time) - new Date(a.create_time));
  
  console.log(`\nTotal unique topics: ${uniqueTopics.length}`);
  
  // Output topics as JSON
  console.log('---TOPICS_JSON_START---');
  console.log(JSON.stringify(uniqueTopics, null, 2));
  console.log('---TOPICS_JSON_END---');

  ws.close();
}

main().catch(e => {
  console.error('ERROR:', e.message);
  console.error(e.stack);
  process.exit(1);
});
