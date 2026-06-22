# mem0 自动读取方案C — 开发交接文档

## 一、当前系统架构

### 1.1 双记忆系统

```
┌─────────────────────────────────────────────────────────────────┐
│                     QClaw (OpenClaw Agent)                       │
│                                                                  │
│  ┌──────────────────┐    ┌─────────────────────────────────┐    │
│  │  文件记忆         │    │  语义记忆 (kimiclaw-memory MCP)  │    │
│  │                  │    │                                  │    │
│  │  memory/YYYY-MM-DD.md  │  │  Chroma向量库 (本地)              │    │
│  │  MEMORY.md       │    │  ├─ collection: kimiclaw_memories  │    │
│  │                  │    │  │  ├─ 48条记录 (截至2026-06-22)     │    │
│  │  写入: write工具  │    │  │  └─ embedding: 智谱embedding-3   │    │
│  │  读取: read工具   │    │                                  │    │
│  │                  │    │  history.db (SQLite)              │    │
│  │                  │    │  ├─ 完整记忆写入历史                 │    │
│  │                  │    │  └─ GitHub备份: ZhouNQQQ/memory_repo │    │
│  └──────────────────┘    └─────────────────────────────────┘    │
│                                                                  │
│  读取路径:                                                       │
│  ├─ memorySearch.provider="auto" → 只读文件系统memory/目录       │
│  ├─ kimiclaw-memory__memory_search → 语义搜索 (MCP工具)         │
│  └─ kimiclaw-memory__memory_get_all → 列出所有记忆 (MCP工具)    │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 MCP连接机制

- **配置位置**: `openclaw.json` → `mcp.servers.kimiclaw-memory`
- **启动方式**: QClaw每次创建新会话时，通过stdio启动一个 `kimiclaw-memory-mcp.exe` 子进程
- **通信协议**: JSON-RPC over stdio
- **问题**: QClaw不会清理旧MCP子进程，导致进程堆积（当前已确认10+个僵尸进程同时存在）

### 1.3 kimiclaw-memory 内部结构

```
C:\Users\77299\.venv-kimiclaw\  (Python 3.12 venv)
├─ Scripts\kimiclaw-memory-mcp.exe  (MCP入口)
└─ Lib\site-packages\kimiclaw_memory\
   ├─ mcp_server.py    (FastMCP工具注册: memory_add/search/get_all/delete/compact)
   ├─ facade.py        (门面层: Memory类，组合操作)
   ├─ config.py        (配置加载: 三级合并 默认<yaml<环境变量)
   └─ __init__.py

C:\Users\77299\.kimiclaw_memory\  (数据目录)
├─ chroma\                         (向量库持久化)
│  └─ kimiclaw_memories collection  (48条记录)
└─ history.db                      (SQLite写入历史)
```

**MCP工具列表**:
| 工具名 | 功能 | 当前状态 |
|--------|------|---------|
| `memory_add` | 写入记忆 | ✅ 可用 |
| `memory_search` | 语义搜索 | ⚠️ 冷启动慢(首次超时) |
| `memory_get_all` | 列出所有记忆 | ✅ 可用 |
| `memory_delete` | 删除记忆 | ✅ 可用 |
| `memory_compact` | 压缩整理 | ✅ 可用 |

**Embedding配置**:
- Provider: `openai` (OpenAI兼容接口)
- Model: `embedding-3` (智谱)
- Base URL: `https://open.bigmodel.cn/api/paas/v4`
- API Key: 通过环境变量 `ZHIPU_API_KEY` 传递

### 1.4 当前问题

#### 问题1: MCP进程堆积
**根因**: QClaw每次新会话/子agent/cron任务启动时都会spawn一个新的 `kimiclaw-memory-mcp.exe` 进程，但不会在会话结束时清理。所有进程共享同一个Chroma数据目录（`C:\Users\77299\.kimiclaw_memory\chroma`），导致SQLite锁冲突。

**证据**: 
- 2026-06-21发现13个僵尸进程
- 2026-06-22发现10个进程（从8:46到13:10，每个对应一个会话创建事件）
- 所有进程父PID相同（QClaw.exe PID 6120）

**影响**: 
- memory_add/search返回"Error finding id"
- MCP调用超时（-32001）
- Chroma向量库可能损坏

#### 问题2: mem0只写不读
**根因**: 
1. `memorySearch.provider="auto"` 只搜索文件系统 `memory/` 目录，不调用kimiclaw-memory MCP
2. AGENTS.md虽然写了"Session Startup时搜索kimiclaw-memory"，但只是文字约定，不保证执行
3. 没有自动化机制将语义记忆中的关键信息同步到文件系统

## 二、方案C详细设计

### 2.1 目标
创建一个cron定时任务，定期从kimiclaw-memory中提取关键记忆，同步到文件系统 `memory/` 目录，使 `memorySearch.provider="auto"` 能够搜索到这些内容。

### 2.2 设计方案

```
┌──────────────┐    cron (每6小时)    ┌──────────────────────┐
│  kimiclaw     │ ──────────────────→  │  memory/             │
│  memory MCP   │    同步脚本          │  semantic_sync/       │
│              │                      │  ├─ 2026-06-22.md     │
│  memory_get_all│                    │  ├─ 2026-06-21.md     │
│  memory_search│                     │  └─ ...               │
└──────────────┘                      └──────────────────────┘
                                              │
                                              ↓
                                     memorySearch.provider="auto"
                                     自动读取并注入会话上下文
```

### 2.3 实现步骤

**Step 1: 创建同步脚本 `sync_semantic_memory.py`**

```python
"""
定期从kimiclaw-memory提取记忆，同步到文件系统memory/目录
使memorySearch.provider="auto"能自动检索到语义记忆内容

运行方式:
  py -3 sync_semantic_memory.py [--user-id zhou] [--output-dir memory/semantic_sync]
  
cron配置:
  每6小时运行一次
"""
import os
import json
import sys
from datetime import datetime, timedelta
from pathlib import Path

# kimiclaw-memory的venv
VENV_PYTHON = r"C:\Users\77299\.venv-kimiclaw\Scripts\python.exe"

def sync_memories(user_id="zhou", output_dir="memory/semantic_sync"):
    """
    1. 调用kimiclaw-memory的memory_get_all获取所有记忆
    2. 按日期分组
    3. 写入memory/semantic_sync/YYYY-MM-DD.md
    """
    # 方案A: 直接用Python调用kimiclaw-memory门面
    os.environ['ZHIPU_API_KEY'] = '27c1d0a9fda74bea858206ef4661cae2.6ESUKS8Iq7j9Eg5h'
    os.environ['EMBEDDING_MODEL'] = 'embedding-3'
    os.environ['KIMICLAW_DATA_DIR'] = r'C:\Users\77299\.kimiclaw_memory'
    
    from kimiclaw_memory import Memory
    with Memory.from_env() as mem:
        all_memories = mem.get_all(user_id=user_id, limit=100)
    
    # 按日期分组
    by_date = {}
    for m in all_memories:
        # 记忆可能有created_at或updated_at字段
        created = m.get('created_at', m.get('updated_at', datetime.now().isoformat()))
        date_str = created[:10] if isinstance(created, str) else str(created)[:10]
        by_date.setdefault(date_str, []).append(m)
    
    # 写入文件
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    
    for date_str, memories in sorted(by_date.items(), reverse=True):
        filepath = output_path / f"{date_str}.md"
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(f"# 语义记忆同步 {date_str}\n\n")
            for m in memories:
                text = m.get('memory', m.get('data', ''))
                mid = m.get('id', 'unknown')
                f.write(f"- [{mid[:8]}] {text}\n")
    
    print(f"Synced {len(all_memories)} memories to {output_dir}")

if __name__ == '__main__':
    sync_memories()
```

**Step 2: 配置cron定时任务**

```bash
openclaw cron add \
  --name "semantic-memory-sync" \
  --schedule "0 */6 * * *" \
  --model "qclaw/pool-deepseek-v4-pro" \
  --task "运行同步脚本: py -3 C:\Users\77299\.qclaw\workspace\sync_semantic_memory.py, 然后报告同步结果" \
  --timeout-seconds 120
```

**Step 3: 验证**

1. 手动运行同步脚本确认输出正确
2. 确认 `memory/semantic_sync/` 目录下的文件被 `memorySearch` 检索到
3. 新建会话，验证语义记忆内容自动出现在上下文中

### 2.4 注意事项

1. **进程安全**: 同步脚本直接用Python调用 `kimiclaw_memory.Memory`，不走MCP，避免进程堆积问题
2. **增量同步**: 记录上次同步时间，只提取新记忆（通过 `memory_get_all` 的 `limit` 和记忆的 `created_at`）
3. **去重**: 避免与手动 `memory/YYYY-MM-DD.md` 中的内容重复
4. **权限**: 同步脚本需要 `ZHIPU_API_KEY` 环境变量
5. **文件位置**: `memory/semantic_sync/` 作为独立子目录，与手动 `memory/YYYY-MM-DD.md` 隔离

### 2.5 替代方案（如果方案C不够优雅）

**方案B+: 修改QClaw的memorySearch配置**

如果QClaw支持自定义memorySearch provider，可以创建一个provider直接查询kimiclaw-memory MCP。需要查看OpenClaw文档确认是否支持。

```json
// openclaw.json 假设支持
{
  "agents": {
    "defaults": {
      "memorySearch": {
        "provider": "custom",
        "mcpServer": "kimiclaw-memory",
        "tool": "memory_search",
        "userId": "zhou"
      }
    }
  }
}
```

**方案D: 在kimiclaw-memory MCP中加单例锁**

在MCP server启动时检查是否已有实例运行，如果有则退出。这解决了进程堆积问题，但不解决自动读取。

## 三、Chroma多进程竞争根因分析

### 发生过程

1. **8:46** — QClaw启动，创建第一个kimiclaw-memory-mcp进程（PID 12524）
2. **8:49** — cron任务"常士杉星球同步-10点"或"人生要选对星球摘要"触发，QClaw为新会话spawn第2、3个MCP进程
3. **8:50** — 另一个cron任务触发，第4个进程
4. **10:00** — 定时任务触发，第5个进程
5. ... 持续累积

**关键**: 不是只有一个QClaw在写入。QClaw的架构是每个会话（主会话 + cron子会话 + 子agent会话）都独立启动MCP子进程。虽然最终都是QClaw.exe的子进程，但它们是**独立的Python进程**，各自独立打开同一个Chroma SQLite数据库。

### SQLite锁冲突机制

Chroma底层用SQLite存储元数据和向量索引。SQLite的锁机制是文件级的：
- **SHARED锁**: 读操作
- **EXCLUSIVE锁**: 写操作（如add记忆时需要写入向量+元数据）

当多个进程同时写Chroma时：
1. 进程A获取EXCLUSIVE锁
2. 进程B尝试获取EXCLUSIVE锁 → 阻塞等待
3. 如果进程A的锁持有时间超过超时阈值 → 进程B报"database is locked"
4. 在kimiclaw-memory中表现为 "Error finding id"

### 为什么不是只有一个QClaw在写入

**因为QClaw的多会话架构**：
- 主会话（你直接对话）
- cron子会话（定时任务，如星球同步）
- 子agent会话（如老韭菜agent的板块资金监控）
- heartbeat会话

**每个会话都是独立的MCP客户端**，各自spawn自己的kimiclaw-memory-mcp进程。这些进程不共享状态，各自独立连接Chroma。

### 根本修复方案

1. **单例MCP进程** — 修改kimiclaw-memory MCP，启动时检查已有实例，通过Unix socket/Named Pipe共享
2. **QClaw侧修复** — 修改QClaw的MCP进程管理，复用已有MCP进程而非每次新建
3. **Chroma加锁** — 在kimiclaw-memory内部加文件锁（如`filelock`库），串行化写操作
4. **临时方案** — 定期杀掉旧MCP进程（当前方案，治标不治本）

## 四、MCP断连根因分析

### 断连发生时间线

1. **2026-06-21 14:49** — 杀掉13个僵尸MCP进程
2. **之后** — 当前会话中的MCP连接指向已死进程的stdio管道，管道断裂
3. **QClaw行为** — 不会自动重新spawn MCP进程来替代被杀的进程
4. **2026-06-22 10:00** — 新的cron会话创建了新MCP进程，但主会话仍使用旧连接
5. **2026-06-22 13:10** — 用户重启QClaw，所有会话重新创建，MCP连接恢复

### 根本原因

**QClaw的MCP连接生命周期绑定到会话创建时刻，而非MCP工具调用时刻。**

具体来说：
1. 会话创建时，QClaw为该会话spawn一个MCP子进程
2. 子进程的stdio管道绑定到该会话
3. 如果子进程被外部杀掉，管道断裂
4. QClaw没有检测管道断裂并自动重连的机制
5. 后续所有MCP工具调用都走断裂的管道 → "Not connected" 或超时

### 解决方案

**短期**: 杀进程后重启QClaw（当前方案）

**长期**: 
1. 在QClaw的MCP客户端代码中增加心跳检测和自动重连逻辑
2. 或者在kimiclaw-memory MCP中增加单例模式，避免多进程问题

## 五、关键配置参考

### openclaw.json (MCP配置)
```json
{
  "mcp": {
    "servers": {
      "kimiclaw-memory": {
        "command": "C:\\Users\\77299\\.venv-kimiclaw\\Scripts\\kimiclaw-memory-mcp.exe",
        "args": [],
        "env": {
          "ZHIPU_API_KEY": "27c1d0a9fda74bea858206ef4661cae2.6ESUKS8Iq7j9Eg5h",
          "EMBEDDING_MODEL": "embedding-3",
          "KIMICLAW_DATA_DIR": "C:\\Users\\77299\\.kimiclaw_memory",
          "GITHUB_REPO": "https://github.com/ZhouNQQQ/memory_repo.git",
          "GITHUB_TOKEN": "github_pat_...",
          "KIMI_API_KEY": ""
        }
      }
    }
  }
}
```

### 环境信息
- Windows 10, PowerShell
- Python 3.12 (kimiclaw venv: `C:\Users\77299\.venv-kimiclaw\`)
- Node.js v22.21.1 (QClaw)
- QClaw v0.2.27.560
- 代理: 127.0.0.1:7897 (不稳定)
- GitHub PAT: Fine-grained, 仅memory_repo仓库的Contents Read & Write权限

### GitHub仓库
- `ZhouNQQQ/memory_repo` — 记忆备份（PAT可推送）
- `ZhouNQQQ/trading` — B1量化选股系统（本地git commit已做好，需开代理后git push）

### 用户标识
- user_id: `zhou`
- GitHub: `ZhouNQQQ`
