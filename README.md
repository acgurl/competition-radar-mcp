# 竞赛雷达 MCP

面向大学生竞赛信息检索的 MCP 服务：聚合赛氪、我爱竞赛网与官方竞赛目录，提供搜索、详情、报名截止日历和权威目录查询。

## 功能

- 关键词 + 类别 + 级别 + 状态 + 截止时间组合检索；
- 单条竞赛详情，按需抓取正文并缓存；
- 未来 N 天报名截止日历；
- 官方「全国普通高校大学生竞赛排行榜」84 项核心赛事目录（含官网、别名、常见月份）；
- 跨源去重与官目录匹配；
- 本地 SQLite 缓存，支持 stdio、Streamable HTTP 与 SSE 三种运行方式。

## 环境要求

- Node.js ≥ 20（开发环境验证于 Node 24）
- Windows / macOS / Linux
- 首次运行需要联网抓取数据

## 快速开始

```bash
cd D:\sai
npm install
npm run build

# 首次拉取数据（赛氪 1 页 + 我爱竞赛网 6 个频道各 1 页，约 15 秒）
npm run refresh -- --source all --pages 1

# 查看缓存与数据源状态
npm run doctor
```

构建产物：`dist/index.js`；缓存数据库：`data/competitions.db`。

## 接入 MCP 客户端

### stdio（推荐）

在 MCP 客户端配置中加入（路径按实际位置调整）：

```json
{
  "mcpServers": {
    "competition-radar": {
      "command": "node",
      "args": ["D:/sai/dist/index.js"],
      "env": {
        "COMP_RADAR_DB": "D:/sai/data/competitions.db"
      }
    }
  }
}
```

Windows 下也可使用 `npx tsx D:/sai/src/index.ts` 免构建运行，但生产使用建议编译后的 `dist/index.js`。

### Streamable HTTP（可选）

```bash
export COMP_RADAR_HTTP_TOKEN="change-me"
node dist/index.js --http --port 8787 --host 127.0.0.1
```

- Standard HTTP 端点：`http://127.0.0.1:8787/mcp`
- SSE 端点：`http://127.0.0.1:8787/sse`（消息入口 `/messages`）
- 健康检查：`GET /health`
- 认证：`Authorization: Bearer <token>`；SSE 客户端不便设置请求头时，也可用 `?token=<token>`（仅建议本机使用）
- 监听非回环地址时**必须**设置 `COMP_RADAR_HTTP_TOKEN`，否则启动失败

启动 SSE 模式：

```bash
node dist/index.js --sse --port 8790
```

本机 8787 可能被其他服务占用，可用 `--port 8790` 等空闲端口。

SSE 客户端配置（无 Token，仅本机）：

```json
{
  "mcpServers": {
    "competition-radar-sse": {
      "type": "sse",
      "url": "http://127.0.0.1:8790/sse"
    }
  }
}
```

带 Token 时：

```json
{
  "mcpServers": {
    "competition-radar-sse": {
      "type": "sse",
      "url": "http://127.0.0.1:8790/sse",
      "headers": {
        "Authorization": "Bearer change-me"
      }
    }
  }
}
```

若客户端不支持自定义 Header，可使用：

```text
http://127.0.0.1:8790/sse?token=change-me
```

### 与已有 MCP 服务共存的完整配置

把竞赛雷达与已有的 `cuc-http`（8788 端口，`X-API-Key` 鉴权）放进同一个 `mcpServers`：

```json
{
  "mcpServers": {
    "cuc-http": {
      "type": "streamableHttp",
      "url": "http://127.0.0.1:8788/mcp",
      "headers": {
        "X-API-Key": "<your-cuc-api-key>"
      }
    },
    "competition-radar": {
      "type": "sse",
      "url": "http://127.0.0.1:8790/sse"
    }
  }
}
```

如果客户端希望统一使用 Streamable HTTP，把 `competition-radar` 换成：

```json
{
  "type": "streamableHttp",
  "url": "http://127.0.0.1:8790/mcp"
}
```

## MCP 工具

| 工具 | 作用 | 主要参数 |
| --- | --- | --- |
| `search_competitions` | 搜索竞赛 | `query`、`category`、`level`、`status`、`deadline_within_days`、`official_only`、`live`、`limit` |
| `get_competition` | 获取详情 | `id` 或 `source`+`source_id`、`include_content`、`refresh` |
| `list_deadlines` | 报名截止日历 | `days`、`category`、`level`、`official_only` |
| `search_catalog` | 查官方目录 | `query`、`month`、`category` |
| `list_sources` | 数据源状态 | 无 |
| `refresh_data` | 刷新数据 | `source`、`max_pages`、`force` |
| `get_stats` | 缓存统计 | 无 |

示例提问：

- 「搜索人工智能类、全国性、正在报名的竞赛」
- 「看看未来 30 天报名截止的榜单赛事」
- 「获取 `saikr:58100` 的详情和费用」
- 「官方目录里数学建模的官网是什么？」

### 搜索语义

- `query` 多关键词按 AND 匹配标题、摘要、主办方与标签；
- 有 `query` 且 `live=true` 时，会向赛氪补充最多 50 条在线结果并写入缓存；
- `total` 是本地合并/过滤后的数量；在线补充时 `source_total` 是赛氪返回的命中总数；
- 默认排除已结束赛事；`include_past=true` 或显式 `status="ended"` 可包含。

## 数据源

| 来源 | 内容 | 说明 |
| --- | --- | --- |
| 赛氪 | 列表、搜索、详情 | 匿名 JSON 接口；字段规整，但属站点内部接口 |
| 我爱竞赛网 | 榜单/科技/IT/学科/创业/英语频道 | GBK HTML；每页 15 条；详情按需抓取 |
| 官方目录 | 84 项核心赛事 | 2025 版；含官网与常用别名 |

详细接口、字段与合规说明见 [docs/SOURCES.md](docs/SOURCES.md)。

## 配置

| 环境变量 | 默认 | 说明 |
| --- | --- | --- |
| `COMP_RADAR_DB` | `./data/competitions.db` | SQLite 路径 |
| `SAIKR_ENABLED` | `true` | 关闭赛氪源 |
| `JINGSAI52_ENABLED` | `true` | 关闭我爱竞赛网源 |
| `SAIKR_MIN_INTERVAL_MS` | `1500` | 赛氪请求最小间隔 |
| `JINGSAI52_MIN_INTERVAL_MS` | `2000` | 我爱竞赛网请求最小间隔 |
| `COMP_RADAR_LIST_TTL_HOURS` | `12` | 列表同步 TTL |
| `COMP_RADAR_DETAIL_TTL_HOURS` | `168` | 详情缓存 TTL |
| `COMP_RADAR_HTTP_PORT` | `8787` | HTTP 端口 |
| `COMP_RADAR_HTTP_HOST` | `127.0.0.1` | HTTP 监听地址 |
| `COMP_RADAR_HTTP_TOKEN` | 空 | HTTP Bearer Token |
| `COMP_RADAR_LOG_LEVEL` | `info` | `debug`/`info`/`warn`/`error` |

## 常用命令

```bash
npm run build                      # 编译
npm test                           # 单元测试
npm run smoke                      # stdio 端到端冒烟
npm run smoke:http                 # Streamable HTTP 端到端冒烟
npm run smoke:sse                  # SSE 端到端冒烟
npx tsx scripts/check-sse.ts http://127.0.0.1:8790/sse  # 检查已启动的 SSE 实例
npm run doctor -- --live           # 真实网络检查
npm run refresh -- --source saikr --pages 1
npm run refresh -- --source jingsai52 --pages 1 --force
```

## 已知限制

- **赛氪接口非公开**：可能变更或限制访问；`www.saikr.com/robots.txt` 禁止 `/api/` 与带查询串路径。本项目按个人低频使用设计，缓存优先、支持 `SAIKR_ENABLED=false` 关闭，请勿对外批量镜像或再分发数据。
- **部分赛氪链接为数字 ID**：形如 `/vse/58394` 可能跳转首页；优先使用标题搜索，或到官网核对。
- **我爱竞赛网字段不完整**：费用、赛制、日期常散落在正文，`extracted` 只提供原文线索，不保证结构化；正文可能以图片为主。
- **跨源合并按标题归一化**：会去掉年份与「第 X 届」，同一赛事的多年份可能合并显示；以 `sources` 中的原始链接为准。
- **官方目录为 2025 版**：每年人工复核更新 `data/official-catalog.json`；`typical_months` 仅对可确认赛事填写。
- **不含微信公众号/QQ 群**：封闭渠道无法稳定抓取，需要人工补充。

## 项目结构

```text
src/
  index.ts              入口（stdio / HTTP）
  server.ts             MCP 工具注册
  httpServer.ts         Streamable HTTP、SSE 与 Bearer 鉴权
  services/competitions.ts  搜索、去重、详情、刷新
  sources/              赛氪、我爱竞赛网、官方目录、HTTP 客户端
  store.ts              SQLite 缓存与查询
  normalize.ts          日期、状态、标题、类别、目录匹配
data/official-catalog.json  官方 84 项目录
docs/                   规划、信源、Schema
test/                   单元测试与 HTML/JSON fixtures
```

更多设计细节见 [docs/PLAN.md](docs/PLAN.md) 与 [docs/SCHEMA.md](docs/SCHEMA.md)。
