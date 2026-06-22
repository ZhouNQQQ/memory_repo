const fs = require('fs');

/**
 * 精简知识星球文章标题，用于IMA知识库显示
 * 规则：
 * 1. 从create_time提取日期前缀（如"6.17"）
 * 2. 去掉固定前缀："私募一哥常士杉YouTube"、"私募一哥YouTube"等
 * 3. 去掉【】、《》、直播复盘/录播、星球专供、嵌入日期
 * 4. 格式："M.DD：核心信息"，如 "6.17：华尔街撤退，头部结构判断"
 */
function compactTitle(originalTitle, createTime) {
    let title = originalTitle;

    // Extract date prefix from create_time
    const dateMatch = createTime && createTime.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    let datePrefix = '';
    if (dateMatch) {
        const month = parseInt(dateMatch[2], 10);
        const day = parseInt(dateMatch[3], 10);
        datePrefix = `${month}.${day}`;
    }

    // Remove common prefixes
    title = title.replace(/^【私募一哥常士杉\s*[·•]\s*/, '');
    title = title.replace(/^【私募一哥\s*[·•]\s*/, '');
    title = title.replace(/^私募一哥常士杉YouTube\s*/i, '');
    title = title.replace(/^私募一哥YouTube\s*/i, '');
    title = title.replace(/^常士杉YouTube\s*/i, '');
    title = title.replace(/^常士杉\s*/i, '');
    title = title.replace(/^YouTube\s*/i, '');

    // Remove brackets: 【xxx · yyy】 → yyy (keep content after separator)
    title = title.replace(/【[^】]*[·•]\s*/g, '');
    title = title.replace(/【/g, '').replace(/】/g, '');
    title = title.replace(/《/g, '').replace(/》/g, '');

    // Remove embedded date patterns at start: "6.17xxx" or "（6-20）"
    title = title.replace(/^\d{1,2}[.-]\d{1,2}\s*/, '');
    title = title.replace(/[（(]\d{1,2}[.-]\d{1,2}[）)]\s*/g, '');

    // Remove "直播复盘"/"直播录播"/"直播" and trailing colon/dash
    title = title.replace(/直播复盘[：:\-–—]*\s*/g, '');
    title = title.replace(/直播录播[：:\-–—]*\s*/g, '');
    title = title.replace(/直播[：:\-–—]*\s*/g, '');

    // Remove "星球专供" suffix
    title = title.replace(/\s*星球专供\s*/g, '');

    // Also remove standalone date fragments like "6-11" at the end
    title = title.replace(/\s*\d{1,2}[.-]\d{1,2}\s*$/g, '');

    // Clean up leading/trailing punctuation and whitespace
    title = title.replace(/^[\s\-–—：:，,、]+/, '').trim();
    title = title.replace(/[\s\-–—：:，,、]+$/, '').trim();

    // If title is empty after cleanup, use a simplified original
    if (!title) {
        title = originalTitle
            .replace(/^【私募一哥常士杉\s*[·•]\s*/, '')
            .replace(/^【私募一哥\s*[·•]\s*/, '')
            .replace(/^私募一哥常士杉YouTube\s*/i, '')
            .replace(/^私募一哥YouTube\s*/i, '')
            .replace(/【/g, '').replace(/】/g, '')
            .replace(/《/g, '').replace(/》/g, '')
            .replace(/直播/g, '')
            .replace(/\d{1,2}[.-]\d{1,2}/g, '');
        title = title.replace(/^[\s\-–—：:，,、]+/, '').trim();
        if (title.length > 40) title = title.substring(0, 37) + '...';
        if (!title) title = '笔记';
    }

    // Add date prefix
    if (datePrefix) {
        title = `${datePrefix} ${title}`;
    }

    // Normalize separator: "6.17 " -> "6.17："
    title = title.replace(/^(\d{1,2}\.\d{1,2})\s+/, '$1：');

    // Truncate to 80 chars for IMA
    if (title.length > 80) {
        title = title.substring(0, 77) + '...';
    }

    return title;
}

// IMA credentials
const CLIENT_ID = '522319180eb05aa7ab7b523151601a83';
const API_KEY = 'D6cD4tQGqeU3Zmxlt4kzeSl6VdaDYKusGEQ39P4fS7z66v2aRXveH2EDQ0ayX4goo9XxbByN1g==';
const KB_ID = 'rFf_v3Hm0jE9eWgLgnSdf75ZXHvjCFxYmW2P2CMpEWA=';
const BASE_URL = 'https://ima.qq.com';

const HEADERS = {
    'Content-Type': 'application/json',
    'ima-openapi-clientid': CLIENT_ID,
    'ima-openapi-apikey': API_KEY
};

// 2 unique new articles
const articles = [
    {
        topic_id: '55522541442255256',
        create_time: '2026-06-21T03:21:54.984+0800',
        title: '中国市场周报（6-20）：创业板创反弹新高，请给中国科技一个慢牛',
        text: `中国市场周报（6-20）星球专供 🌎\n\n《创业板创反弹新高，但请不要疯牛，请给中国科技一个慢牛》\n\n本周最大的变化，不是指数涨了多少。\n\n而是市场开始重新相信科技。\n\n创业板本周大涨约11%，创出历史新高；科创50更是大涨近15%，资金重新回流半导体、算力、AI硬件、通信设备等核心科技方向。\n\n很多人开始兴奋了。\n\n但我想告诉星球家人一句话：\n\n真正的大牛市，从来不是疯出来的，而是熬出来的。\n\n一、本周市场最大的信号\n\n不是地产。不是消费。而是：科技重新成为主线\n\n从半导体到AI算力，从PCB到CPO，从先进封装到国产AI芯片，资金开始重新拥抱中国科技资产。\n\n创业板和科创板同步走强。市场开始从"防御思维"切换到"成长思维"。\n\n二、最担心的是什么？\n\n不是上涨，而是上涨太快。疯牛必死，慢牛长生。2015年的教训历历在目。\n\n三、中国科技真正的机会\n\n未来三年最重要的主线：AI、算力、半导体、机器人、军工太空、数据资产、新能源电力基础设施。这些领域不是在讲故事，而是在解决国家竞争力。\n\n四、当前策略\n\n维持仓位35%-45%，不追高，不满仓，不加仓，等待机会。市场永远会给耐心的人礼物。\n\n五、下周重点观察\n\n① 创业板是否继续放量创新高 ② AI算力链是否持续扩散 ③ 半导体能否形成趋势行情 ④ 量能是否持续维持高位 ⑤ 美股AI与SpaceX产业链是否继续影响全球科技风险偏好\n\n疯牛制造神话。慢牛创造财富。请给中国科技十年慢牛。`
    },
    {
        topic_id: '82255248445522450',
        create_time: '2026-06-21T03:33:44.398+0800',
        title: '投资哲学系列之六：资本共振哲学',
        text: `【私募一哥常士杉 · 投资哲学系列之六】《资本共振哲学》\n\n核心结论：真正让股价起飞的，是资本共振。一只股票涨3倍、5倍、10倍，绝不是一个人的力量。它来自三股力量同时出现：产业资本看懂未来、市场资金形成共识、股价结构完成突破。\n\n什么是资本共振？\n产业认知 × 市场共识 × 资金加速度 × 时间发酵\n\n三层力量：\n1. 产业资本（大股东、产业基金、上下游企业）→ 代表方向\n2. 市场资金（机构、游资、ETF、公募、私募）→ 代表趋势\n3. 价格结构（放量突破、底部抬高、利空不跌）→ 代表共振显性化\n\n三大实战信号：\n信号一：产业资本真金白银行动（增持、回购、产业基金入股、战略合作）\n信号二：市场资金持续确认（ETF增长、机构席位、基金增仓、温和放量）\n信号三：股价结构从弱转强（跌不动、压不住、回调有人接、利空不跌反涨）\n\n三段式路径：分歧期→发酵期→共振期\n\n最高维心法：最懂行业的人，和最有钱的人，在同一时间，相信了同一个未来。\n\n实战筛选框架：产业趋势→产业资本动作→市场资金跟进→结构突破\n\n三个致命误区：只看题材不看产业资本、只看逻辑不看市场承接、共振疯狂时重仓追高\n\n风险纪律：不追高、不满仓、不加杠杆、单票控制、20%强止损\n\n终极总结：大牛股的本质，不是一个人看对，而是一群最聪明的钱，在同一时间，看懂了同一个未来。`
    }
];

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function importDoc(title, content) {
    const body = JSON.stringify({
        title: title.substring(0, 80),
        content: content,
        content_format: 1
    });
    const resp = await fetch(`${BASE_URL}/openapi/note/v1/import_doc`, {
        method: 'POST',
        headers: HEADERS,
        body
    });
    const data = await resp.json();
    if (data.code !== 0) {
        throw new Error(`import_doc failed: ${JSON.stringify(data)}`);
    }
    return data.data.note_id || data.data.doc_id;
}

async function addKnowledge(noteId, title) {
    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const body = JSON.stringify({
            knowledge_base_id: KB_ID,
            media_type: 11,
            title: title.substring(0, 80),
            note_info: { content_id: noteId }
        });
        const resp = await fetch(`${BASE_URL}/openapi/wiki/v1/add_knowledge`, {
            method: 'POST',
            headers: HEADERS,
            body
        });
        const data = await resp.json();
        if (data.code === 0) return data;
        if (attempt < MAX_RETRIES) {
            console.log(`  [add_knowledge] retry ${attempt + 1}/${MAX_RETRIES} after error code=${data.code}...`);
            await sleep(3000);
        } else {
            throw new Error(`add_knowledge failed after ${MAX_RETRIES} attempts: ${JSON.stringify(data)}`);
        }
    }
}

async function main() {
    const results = [];
    for (const article of articles) {
        // Compact title for IMA display
        const imaTitle = compactTitle(article.title, article.create_time);
        console.log(`\nProcessing: ${article.title}`);
        console.log(`  IMA title: ${imaTitle}`);
        try {
            // Step 1: Import doc (use compact title)
            const noteId = await importDoc(imaTitle, article.text);
            console.log(`  import_doc OK, note_id=${noteId}`);
            
            await sleep(1000);
            
            // Step 2: Add to knowledge base (use compact title)
            await addKnowledge(noteId, imaTitle);
            console.log(`  add_knowledge OK`);
            
            results.push({ topic_id: article.topic_id, status: 'ok', note_id: noteId });
        } catch(e) {
            console.error(`  ERROR: ${e.message}`);
            results.push({ topic_id: article.topic_id, status: 'error', error: e.message });
        }
    }
    
    console.log('\n__IMA_RESULT__');
    console.log(JSON.stringify(results));
    
    // Update sync state
    const syncStateFile = 'C:\\Users\\77299\\.qclaw\\workspace\\zsxq_sync_state.json';
    const syncState = JSON.parse(fs.readFileSync(syncStateFile, 'utf8'));
    const now = new Date().toISOString();
    syncState.last_sync_time = now;
    syncState.last_sync_date = now.split('T')[0];
    syncState.last_check_time = now;
    syncState.group_88882452212242_last_sync_time = now;
    syncState.group_88882452212242_last_topic_time = '2026-06-21T03:33:44.398+0800';
    syncState.articles_synced = results.filter(r => r.status === 'ok').length;
    syncState.total_new = results.length;
    fs.writeFileSync(syncStateFile, JSON.stringify(syncState, null, 2), 'utf8');
    console.log('Sync state updated');
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
