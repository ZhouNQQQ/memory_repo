const https = require('https');

const CLIENT_ID = '522319180eb05aa7ab7b523151601a83';
const API_KEY = 'D6cD4tQGqeU3Zmxlt4kzeSl6VdaDYKusGEQ39P4fS7z66v2aRXveH2EDQ0ayX4goo9XxbByN1g==';
const KB_ID = 'rFf_v3Hm0jE9eWgLgnSdf75ZXHvjCFxYmW2P2CMpEWA=';

/**
 * 精简知识星球文章标题，用于IMA知识库显示
 * 规则：
 * 1. 从date提取日期前缀（如"6.17"）
 * 2. 去掉固定前缀："私募一哥常士杉YouTube"、"私募一哥YouTube"等
 * 3. 去掉【】、《》、直播复盘/录播、星球专供、嵌入日期
 * 4. 格式："M.DD：核心信息"
 */
function compactTitle(originalTitle, dateStr) {
    let title = originalTitle;

    // Extract date prefix
    const dateMatch = dateStr && dateStr.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
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

    // Remove brackets: 【xxx · yyy】 → yyy
    title = title.replace(/【[^】]*[·•]\s*/g, '');
    title = title.replace(/【/g, '').replace(/】/g, '');
    title = title.replace(/《/g, '').replace(/》/g, '');

    // Remove embedded date patterns at start
    title = title.replace(/^\d{1,2}[.-]\d{1,2}\s*/, '');
    title = title.replace(/[（(]\d{1,2}[.-]\d{1,2}[）)]\s*/g, '');

    // Remove 直播复盘/录播/直播
    title = title.replace(/直播复盘[：:\-–—]*\s*/g, '');
    title = title.replace(/直播录播[：:\-–—]*\s*/g, '');
    title = title.replace(/直播[：:\-–—]*\s*/g, '');

    // Remove 星球专供
    title = title.replace(/\s*星球专供\s*/g, '');

    // Remove standalone date fragments at end
    title = title.replace(/\s*\d{1,2}[.-]\d{1,2}\s*$/g, '');

    // Clean up
    title = title.replace(/^[\s\-–—：:，,、]+/, '').trim();
    title = title.replace(/[\s\-–—：:，,、]+$/, '').trim();

    // Fallback if empty
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

    // Normalize separator
    title = title.replace(/^(\d{1,2}\.\d{1,2})\s+/, '$1：');

    // Truncate
    if (title.length > 80) {
        title = title.substring(0, 77) + '...';
    }

    return title;
}

function imaPost(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: 'ima.qq.com', path, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ima-openapi-clientid': CLIENT_ID,
        'ima-openapi-apikey': API_KEY,
        'Content-Length': Buffer.byteLength(data)
      },
      timeout: 30000
    }, (res) => {
      let resp = '';
      res.on('data', c => resp += c);
      res.on('end', () => { try { resolve({ s: res.statusCode, d: JSON.parse(resp) }); } catch(e) { resolve({ s: res.statusCode, r: resp }); } });
    });
    req.on('error', e => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(data);
    req.end();
  });
}

async function uploadArticle(title, markdown, dateStr) {
  const compacted = compactTitle(title, dateStr || '');
  const noteTitle = compacted.slice(0, 36);
  console.error(`  Title: "${title}" -> "${noteTitle}"`);
  try {
    const r1 = await imaPost('/openapi/note/v1/import_doc', { title: noteTitle, content: markdown, content_format: 1 });
    if (r1.d?.code !== 0) return { ok: false, step: 'import_doc', resp: r1.d };
    const noteId = r1.d?.data?.note_id;
    if (!noteId) return { ok: false, step: 'no_note_id', resp: r1.d };
    
    const r2 = await imaPost('/openapi/wiki/v1/add_knowledge', { knowledge_base_id: KB_ID, title: noteTitle, media_type: 11, note_info: { content_id: noteId } });
    if (r2.d?.code !== 0) return { ok: false, step: 'add_knowledge', noteId, resp: r2.d };
    return { ok: true, noteId };
  } catch(e) {
    return { ok: false, step: 'exception', error: e.message };
  }
}

const articles = [
  {
    title: '时代的热点，时代的科技，时代的未来-投资哲学',
    author: 'Cedar',
    date: '2026-06-18 16:27',
    content: `# 时代的热点，时代的科技，时代的未来

**作者:** Cedar (常士杉星球团队)
**日期:** 2026-06-18 16:27

---

投资最大的悲剧，不是亏损。而是时代已经发生了巨变，你却还活在上一个时代。

2000年，是互联网。2010年，是移动互联网。2020年，是新能源。2025年以后，是AI、太空、机器人、能源革命。

每一个时代，都会诞生属于自己的财富机器。每一个时代，也都会淘汰一批拒绝改变的人。

## 一、投资的本质：买未来，而不是买过去

绝大多数投资者都有一个共同错误：喜欢研究过去。研究过去的利润、PE、业绩。

而资本市场从来不为过去买单，资本市场只为未来定价。未来十年增长100倍的公司，今天往往最贵；未来十年消失的公司，今天往往最便宜。

**看后视镜的人，永远跑不过看前挡风玻璃的人。**

## 二、时代热点就是资金流向

很多人看不起热点，认为热点是炒作。其实热点本质上是：全球资本对于未来的投票。

从微软到苹果；从英伟达到OpenAI；从特斯拉到SpaceX——每一个时代热点，都成就了一批时代的赢家。

## 三、核心启示

- 不要用过去的逻辑判断未来
- 热点不是用来追的，是用来理解的
- 时代的科技龙头才是长期赢家

> 不负热点，不负时代。`
  },
  {
    title: '美股深蹲悄然而至？6-7月必有血雨腥风',
    author: 'Cedar',
    date: '2026-06-18 19:45',
    content: `# 美股深蹲悄然而至？

**作者:** Cedar (常士杉星球团队)
**日期:** 2026-06-18 19:45

---

## 核心观点

- 美股深蹲悄然而至
- 6-7月必有血雨腥风
- 太空板块10-100倍大牛股华尔街大资金已悄然布局建仓

## YouTube直播预告

常士杉YouTube直播：揭秘美股调整与太空板块机会

> 纽约时间8:48，北京时间20:48分揭秘！`
  },
  {
    title: '致中国星球家人们的一封信-端午安康',
    author: '常士杉',
    date: '2026-06-19 15:15',
    content: `# 致中国星球家人们的一封信

**作者:** 常士杉
**日期:** 2026-06-19 15:15

---

## 端午安康，一路同行，感恩有你

亲爱的中国星球家人们：端午安康！

中国星球已经陪伴大家近120天了。这120天，不仅仅是一个星球的成立，更像是认识了一群志同道合的家人。

## 我们一起经历的

这120天里，我们一起经历了市场的狂热，也一起经历了市场的冷静。

一起研究产业，一起研究公司，一起研究人性，一起研究风险。更重要的是：**我们一起成长。**

## 家人们的改变

越来越多家人开始懂得等待，懂得控制仓位，懂得敬畏市场，懂得风险管理。

**懂得什么叫机会来时重拳出击，机会没有时耐心等待。**

看到这些变化，是我最大的欣慰。`
  },
  {
    title: '私募一哥YouTube6.18直播复盘-市场高位控仓',
    author: '常士杉',
    date: '2026-06-19 09:14',
    content: `# 私募一哥常士杉YouTube6.18直播复盘

**作者:** 常士杉
**日期:** 2026-06-19 09:14

---

## 一、关于马斯克及其太空公司

- 该太空龙头市值达3万亿美元，视为太空估值天花板
- 杉哥关键判断：正在"深蹲"洗盘，极限调整位预计1.6~2万亿美元市值区间
- 逻辑延伸：龙头大跌反而为太空基础设施类小市值股票打开10倍~100倍空间

## 二、关于美股整体大势

- 当前美股处于高位放量滞涨阶段，头部特征明显
- **明确警告：美股"躺着赚钱"的黄金时期已过去，6月底至7月中旬将迎来血雨腥风式洗盘**
- 建议严格控制总仓位30%~40%

## 三、关于A股

- 中国科技股（科创板、创业板）已占市值30%以上
- 反映硬科技从0到1的跨越式发展
- 聚焦主线交易性机会与小市值成长机会`
  },
  {
    title: '私募一哥YouTube6.18直播录播',
    author: '常士杉',
    date: '2026-06-19 08:44',
    content: `# 私募一哥常士杉YouTube6.18直播录播

**作者:** 常士杉
**日期:** 2026-06-19 08:44

---

## 直播录播链接

- **百度网盘:** https://pan.baidu.com/s/1SheteXkPy3Fre7Lmt6aYTg
- **夸克网盘:** 夸克网盘分享

本期重点：市场高位控仓，聚焦主线交易性机会与小市值成长机会。`
  },
  {
    title: '私募一哥YouTube6.17直播复盘-华尔街撤退',
    author: '常士杉',
    date: '2026-06-18 08:14',
    content: `# 私募一哥常士杉YouTube6.17直播复盘

**作者:** 常士杉
**日期:** 2026-06-18 08:14

---

## 一、华尔街资本动态：全面战略性卖出

- 整体净卖出：仅最近一天，华尔街机构净卖出约270亿美元
- 卖出对象：大型科技龙头、某太空探索股、部分中概股
- 买入方：主要是散户和跟风资金，机构在高位完成筹码转移

## 二、卖出原因

- 历史高位需要"接盘侠"
- AI等科技赛道预期已被充分定价
- 调仓换股，整体仍是净卖出

## 三、具体案例

- 某太空概念股：3万亿美元市值被明确判定为"天花板"
- 某操作系统巨头：连续减持，股价形成三次头部
- 某AI芯片龙头：财报前后必跌

## 四、核心策略

- 不追涨、不满仓、不All in
- 任何反弹都是减仓或做空机会
- 当前美股仅视为反弹，而非反转
- A股关注科技主线，采用"买跌不买涨"策略`
  }
];

async function main() {
  console.log(`Uploading ${articles.length} articles to IMA...\n`);
  
  const results = [];
  for (let i = 0; i < articles.length; i++) {
    const a = articles[i];
    console.log(`[${i+1}/${articles.length}] ${a.title.slice(0,40)}...`);
    const r = await uploadArticle(a.title, a.content, a.date);
    results.push({ title: a.title.slice(0,30), author: a.author, date: a.date, ...r });
    console.log(`  -> ${r.ok ? 'OK note_id='+r.noteId : 'FAIL '+r.step+': '+JSON.stringify(r.resp||r.error)}`);
    
    if (i < articles.length - 1) await new Promise(r => setTimeout(r, 2500));
  }
  
  const ok = results.filter(r => r.ok).length;
  console.log(`\n=== DONE: ${ok}/${articles.length} uploaded ===`);
  console.log(JSON.stringify(results, null, 2));
  
  const fs = require('fs');
  fs.writeFileSync('C:/Users/77299/.qclaw/workspace/zsxq_upload_20260620.json', JSON.stringify(results, null, 2));
  fs.writeFileSync('C:/Users/77299/.qclaw/workspace/zsxq_sync_state.json', JSON.stringify({
    last_sync_time: new Date().toISOString(),
    last_sync_date: new Date().toISOString().slice(0,10),
    last_check_time: new Date().toISOString(),
    latest_topic_time: '2026-06-19T15:15:00.000+0800',
    kb_id: KB_ID,
    articles_synced: ok,
    total_new: articles.length,
    note: 'API blocked(1059), articles extracted via DOM/CDP',
    group_88882452212242_last_sync_time: new Date().toISOString(),
    group_88882452212242_last_topic_time: '2026-06-19T15:15:00.000+0800'
  }, null, 2));
}

main().catch(e => { console.log('FATAL:', e.message); process.exit(1); });
