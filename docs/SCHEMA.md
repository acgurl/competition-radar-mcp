# 数据模型与 MCP 工具契约

> 首版实现基准。字段命名为 `snake_case`（JSON / SQLite 一致）。

## 1. 统一竞赛对象

```json
{
  "id": "saikr:58100",
  "source": "saikr",
  "source_id": "58100",
  "title": "2026大学生“麟创杯”创新数学竞赛",
  "url": "https://www.saikr.com/vse/LCBCXSX",
  "summary": "中国技术市场协会数智技术专业委员会 等 · 全国性 · 报名至 2026-10-25",
  "cover_url": "https://publicqn.saikr.com/...png",
  "organizer": ["中国技术市场协会数智技术专业委员会"],
  "level": "national",
  "level_label": "全国性",
  "category": "math",
  "category_label": "数学",
  "tags": ["数学竞赛", "单机位答题"],
  "registration_start": "2026-04-29T00:00:00+08:00",
  "registration_end": "2026-10-25T20:00:00+08:00",
  "event_start": "2026-10-24T10:00:00+08:00",
  "event_end": "2026-10-25T23:00:00+08:00",
  "fee": null,
  "eligibility": "全国高校在校学生...",
  "format": "unknown",
  "status": "registering",
  "official": false,
  "catalog_id": null,
  "catalog_url": null,
  "canonical_key": "创新数学竞赛",
  "fetched_at": "2026-10-25T15:50:00+08:00",
  "updated_at": "2026-10-25T15:50:00+08:00"
}
```

### 1.1 字段说明

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | `source:source_id`，跨源唯一 |
| `source` | enum | `saikr` / `jingsai52` |
| `source_id` | string | 源站 ID（赛氪 `contest_id`；52 为文章数字 ID） |
| `title` | string | 原始标题（保留营销前缀） |
| `url` | string | 源站详情页绝对 URL |
| `summary` | string? | 摘要；无摘要时可由主办方/级别/截止日拼装 |
| `cover_url` | string? | 封面图 |
| `organizer` | string[] | 主办方；单值也存数组 |
| `level` | enum | 见 1.2 |
| `level_label` | string? | 源站原始级别文案 |
| `category` | enum | 见 1.3 |
| `category_label` | string? | 源站原始分类文案 |
| `tags` | string[] | 标签 |
| `registration_start` / `registration_end` | ISO 8601? | 东八区时间；只有日期时用 `00:00:00+08:00` / `23:59:59+08:00` |
| `event_start` / `event_end` | ISO 8601? | 比赛时间 |
| `fee` | string? | 费用线索原文，不强行转数字 |
| `eligibility` | string? | 参赛对象/范围 |
| `format` | enum | `online` / `offline` / `hybrid` / `unknown` |
| `status` | enum | 读取时按当前时间计算，见 1.4 |
| `official` | boolean | 是否命中官方 84 项目录 |
| `catalog_id` / `catalog_url` | string? | 命中的官目录条目与官网 |
| `canonical_key` | string | 标题归一化键，用于跨源去重 |
| `fetched_at` | ISO 8601 | 最近一次抓取 |
| `updated_at` | ISO 8601 | 记录最近变更 |
| `content` | string? | 仅详情返回：正文纯文本 |
| `links` | string[]? | 仅详情返回：正文中的链接 |
| `extracted` | object? | 仅详情返回：正文线索，见 1.5 |

### 1.2 级别枚举

| 值 | 含义 | 识别来源 |
| --- | --- | --- |
| `school` | 校级 | 赛氪 `level=1` / 标题含“校赛” |
| `city` | 市级 | 赛氪 `level=2` |
| `province` | 省级 | 赛氪 `level=3` / 标题含“省赛”“省级” |
| `national` | 全国性 | 赛氪 `level=4` / 标题含“全国”“国家级”“榜单” |
| `global` | 全球性 | 赛氪 `level=5` / 标题含“国际”“全球” |
| `free` | 自由 | 赛氪 `level=6` |
| `other` | 其他 | 赛氪 `level=7` |
| `unknown` | 未知 | 无可靠依据；**不猜测** |

### 1.3 类别枚举

`ai` / `computer` / `math` / `engineering` / `science` / `business` / `design` / `language` / `humanities` / `sports` / `comprehensive` / `other` / `unknown`

映射规则：

- 赛氪按 `class_id` 映射（见 SOURCES.md 2.2），例：`1006 → ai`、`6 → computer`、`1 → math`、`21 → design`、`19 → language`、`8/3/26 → business`；
- 我爱竞赛网按频道映射，并用标题关键词兜底；
- 官方目录按名称关键词映射（创新/创业 → business，设计 → design，英语/外语 → language，机器人/电子/机械 → engineering 等）；
- 无法判断时 `unknown`，不强行归类。

### 1.4 状态计算（Asia/Shanghai）

按优先级：

```text
无任何日期                          → unknown
now < registration_start            → upcoming
registration_start ≤ now ≤ end      → registering
now > registration_end:
    event_end 存在且 now > event_end → ended
    event_start 存在且 now ≥ start   → ongoing
    event_start 存在且 now < start   → registration_closed
    event_end 缺失                   → registration_closed
仅 event_start/event_end:
    now < event_start                → upcoming
    event_start ≤ now ≤ event_end    → ongoing
    now > event_end                  → ended
```

> `registration_closed` 表示报名已截止但比赛可能尚未开始；不要合并进 `ended`。

### 1.5 详情线索 `extracted`

```json
{
  "registration_text": "即日起至2026年10月31日",
  "event_text": "2026年11月15日",
  "fee_text": "30元/人",
  "format_text": "线上答题",
  "organizer_text": "中国商业统计学会",
  "official_url": "http://www.china-css.org/"
}
```

规则：

- 仅从摘要、正文、meta 描述中提取原文片段；
- 找不到就是 `null`，不从标题脑补；
- 正文里的链接单独放在 `links`，并优先识别 `官网/官方网站/大赛官网` 附近的 URL。

---

## 2. 官方目录对象

```json
{
  "id": "official-001",
  "no": 1,
  "name": "中国国际大学生创新大赛",
  "aliases": ["互联网+", "国创赛"],
  "url": "https://cy.ncss.cn/",
  "category": "comprehensive",
  "typical_months": [5, 6, 7, 8, 9],
  "note": null
}
```

- `url` 可为 `null`（仅微信公众号或无官网）；
- `typical_months` 可为空数组；
- 目录版本写在文件级 `version` / `updated_at`。

---

## 3. SQLite Schema

```sql
CREATE TABLE IF NOT EXISTS competitions (
  id                 TEXT PRIMARY KEY,
  source             TEXT NOT NULL,
  source_id          TEXT NOT NULL,
  title              TEXT NOT NULL,
  url                TEXT NOT NULL,
  summary            TEXT,
  cover_url          TEXT,
  organizer          TEXT,              -- JSON array
  level              TEXT NOT NULL DEFAULT 'unknown',
  level_label        TEXT,
  category           TEXT NOT NULL DEFAULT 'unknown',
  category_label     TEXT,
  tags               TEXT,              -- JSON array
  registration_start TEXT,
  registration_end   TEXT,
  event_start        TEXT,
  event_end          TEXT,
  fee                TEXT,
  eligibility        TEXT,
  format             TEXT NOT NULL DEFAULT 'unknown',
  official           INTEGER NOT NULL DEFAULT 0,
  catalog_id         TEXT,
  catalog_url        TEXT,
  canonical_key      TEXT NOT NULL,
  raw                TEXT,              -- 原始条目 JSON，排查用
  fetched_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  UNIQUE(source, source_id)
);

CREATE INDEX idx_comp_status ON competitions(registration_end, event_start, event_end);
CREATE INDEX idx_comp_category ON competitions(category);
CREATE INDEX idx_comp_level ON competitions(level);
CREATE INDEX idx_comp_canonical ON competitions(canonical_key);
CREATE INDEX idx_comp_official ON competitions(official);

CREATE TABLE IF NOT EXISTS details (
  id          TEXT PRIMARY KEY REFERENCES competitions(id) ON DELETE CASCADE,
  content     TEXT,
  links       TEXT,              -- JSON array
  extracted   TEXT,              -- JSON object
  fetched_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS catalog (
  id             TEXT PRIMARY KEY,
  no             INTEGER,
  name           TEXT NOT NULL,
  aliases        TEXT,           -- JSON array
  url            TEXT,
  category       TEXT NOT NULL DEFAULT 'unknown',
  typical_months TEXT,           -- JSON array
  note           TEXT,
  version        TEXT
);

CREATE TABLE IF NOT EXISTS source_state (
  source      TEXT PRIMARY KEY,
  last_sync   TEXT,
  last_error  TEXT,
  item_count  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
```

查询策略：数据量在万级以内，中文检索用 `LIKE '%关键词%'`（按空格拆分多关键词 AND），不使用 FTS5，避免中文分词与短词限制。

---

## 4. 跨源去重

### 4.1 归一化

```text
1. 去 HTML 实体、全角转半角空格；
2. 去开头/结尾的【...】、[...] 营销前缀；
3. 去 20xx / 20xx-20xx；
4. 去“第X届”“第X届”；
5. 去标点与空白；
6. 去结尾的“报名通知/通知/启动/火热报名中”等营销尾巴。
```

例：

```text
【榜单竞赛】第十七届全国大学生市场调查与分析大赛
→ 全国大学生市场调查与分析大赛

2026年第十七届全国大学生市场调查与分析大赛报名通知
→ 全国大学生市场调查与分析大赛
```

### 4.2 合并

- `canonical_key` 相同的记录在搜索时合并；
- 选择「信息更完整」的一条作为主记录（有报名时间 > 有摘要 > 有封面）；
- 输出 `sources` 数组保留所有来源链接；
- 不物理删除，避免丢失来源信息。

### 4.3 官目录匹配

1. 归一化标题；
2. 与目录 `name` / `aliases` 归一化后精确比较；
3. 否则计算字符二元组 Dice 相似度，≥0.86 视为命中；
4. 只做一对一匹配；歧义时宁可 `official=false`。

---

## 5. MCP 工具

所有工具返回：

```json
{
  "content": [{ "type": "text", "text": "<可读摘要或 JSON>" }],
  "structuredContent": { "...": "..." },
  "isError": false
}
```

业务失败不抛异常：`isError=false`，在结果中返回 `errors`；参数非法时 `isError=true`。

### 5.1 `search_competitions`

输入：

```json
{
  "query": "人工智能",
  "source": "saikr",
  "category": "ai",
  "level": "national",
  "status": "registering",
  "deadline_within_days": 30,
  "official_only": false,
  "include_past": false,
  "live": true,
  "sort": "deadline",
  "limit": 10,
  "offset": 0
}
```

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `query` | 空 | 多关键词空格分隔，AND |
| `source` | 全部 | `saikr` / `jingsai52` |
| `category` | 全部 | 1.3 枚举 |
| `level` | 全部 | 1.2 枚举 |
| `status` | 全部 | 1.4 枚举 |
| `deadline_within_days` | 空 | 只看 N 天内报名截止 |
| `official_only` | false | 只返回官目录命中 |
| `include_past` | false | 是否包含 `ended` |
| `live` | true | 有 query 时是否调用赛氪在线搜索补充 |
| `sort` | `relevance` | `relevance` / `deadline` / `event_start` / `updated` |
| `limit` | 10 | 1–50 |
| `offset` | 0 | ≥0 |

输出：

```json
{
  "total": 1,
  "returned": 1,
  "items": [{
    "id": "saikr:58100",
    "source": "saikr",
    "title": "...",
    "url": "...",
    "registration_end": "...",
    "status": "registering",
    "official": false,
    "sources": [{ "source": "saikr", "id": "saikr:58100", "url": "..." }]
  }],
  "errors": [],
  "cached": false,
  "source_total": 883
}
```

- `total`：本地合并、过滤后的结果数；
- `source_total`：在线补充时赛氪返回的命中总数（仅取前 50 条入缓存，因此可能大于 `total`）；
- `cached`：本次是否完全来自缓存（在线补充失败也为 `true`）。

### 5.2 `get_competition`

输入（二选一）：

```json
{ "id": "saikr:58100", "include_content": true, "refresh": false }
```

```json
{ "source": "jingsai52", "source_id": "24110", "include_content": true }
```

输出：竞赛对象 + `content` + `links` + `extracted` + `catalog`（命中的目录条目）。

### 5.3 `list_deadlines`

输入：

```json
{ "days": 30, "category": "ai", "level": "national", "official_only": false, "limit": 20 }
```

输出：按 `registration_end` 升序；每项附加 `days_left`（整数，向上取整，0 表示今天）。

### 5.4 `search_catalog`

输入：

```json
{ "query": "数学建模", "month": 9, "category": "math", "limit": 20 }
```

输出：

```json
{
  "total": 1,
  "items": [{
    "id": "official-005",
    "name": "全国大学生数学建模竞赛",
    "url": "http://www.mcm.edu.cn/",
    "category": "math",
    "typical_months": [9],
    "matched_competitions": 3
  }]
}
```

### 5.5 `list_sources`

输出：每个源的 `enabled`、`capabilities`、`last_sync`、`item_count`、`last_error`、`rate_limit`、`notes`。

### 5.6 `refresh_data`

输入：

```json
{ "source": "all", "max_pages": 3, "force": false }
```

- `source`: `all` / `saikr` / `jingsai52` / `catalog`
- `max_pages`: 1–20；赛氪每页 100，52 每页约 20
- `force=false` 时，距上次同步不足 TTL 则跳过
- 只刷新列表，不抓详情

输出：每个源的 `added` / `updated` / `unchanged` / `matched` / `duration_ms` / `error`。`matched` 仅目录刷新时返回，表示命中官目录的赛事条数。

### 5.7 `get_stats`

输出：

```json
{
  "competitions": 1234,
  "by_source": { "saikr": 1000, "jingsai52": 234 },
  "by_status": { "registering": 120, "upcoming": 300, "ended": 700, "unknown": 114 },
  "by_category": { "ai": 90, "computer": 210 },
  "official": 88,
  "catalog": 84,
  "last_sync": { "saikr": "...", "jingsai52": "..." }
}
```

---

## 6. 错误与降级

```json
{
  "source": "saikr",
  "code": "HTTP_403",
  "message": "source returned 403",
  "retryable": true
}
```

- 单源失败不影响其他源；
- 在线补充失败时返回缓存结果，`cached=true`；
- 日志写 stderr（stdio 模式不能污染 stdout）；
- 不把上游 HTML 错误页当作正文缓存。

---

## 7. 配置

| 环境变量 | 默认 | 说明 |
| --- | --- | --- |
| `COMP_RADAR_DB` | `./data/competitions.db` | SQLite 路径 |
| `SAIKR_ENABLED` | `true` | 关闭赛氪适配器 |
| `JINGSAI52_ENABLED` | `true` | 关闭我爱竞赛网适配器 |
| `SAIKR_MIN_INTERVAL_MS` | `1500` | 赛氪请求最小间隔 |
| `JINGSAI52_MIN_INTERVAL_MS` | `2000` | 我爱竞赛网请求最小间隔 |
| `COMP_RADAR_HTTP_PORT` | `8787` | HTTP 模式端口 |
| `COMP_RADAR_HTTP_TOKEN` | 空 | HTTP Bearer Token；非本机监听时必填 |
| `COMP_RADAR_LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
