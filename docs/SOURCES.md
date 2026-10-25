# 信源与接口分析

> 抓取与接口验证时间：2026-10-25。平台可能随时调整，适配器需按「源 + 版本」维护。

## 1. 选源结论

| 优先级 | 来源 | 类型 | 稳定性 | 首版 |
| --- | --- | --- | --- | --- |
| P0 | 赛氪 saikr.com | 匿名 JSON API | 字段规整，但属内部接口 | 接入 |
| P0 | 我爱竞赛网 52jingsai.com | GBK HTML | 结构稳定，适合补榜单与正文 | 接入 |
| P0 | 官方竞赛目录 | 静态数据 | 年度更新，权威 | 接入 |
| P1 | 赛欢网 saihuan.net | UTF-8 HTML | 可用，详情结构弱 | 暂缓 |
| P1 | 创赛云 newunivs.com | WordPress REST | 以通知为主，字段不统一 | 暂缓 |
| P2 | 各赛事官网 | 各自为政 | 高价值但维护量大 | 后续按需 |

---

## 2. 赛氪（saikr.com）

### 2.1 概况

- 站点前台是 Vue SPA；列表、搜索、详情均由 JSON 接口驱动。
- API 主机：`https://apiv4buffer.saikr.com`
- 前台：`https://www.saikr.com`（详情页路径 `/vse/<slug>`）
- 无需登录即可读取公开数据。
- 列表时间字段为 **10 位 Unix 秒**，详情时间为 `YYYY/MM/DD HH:mm:ss`（东八区）。

### 2.2 接口

#### 分类配置

```http
GET https://apiv4buffer.saikr.com/api/pc/contest/listConfig
Referer: https://www.saikr.com/contests
```

返回：

```json
{
  "code": 200,
  "data": {
    "classData": [
      { "name": "工科", "sons": [{ "label": "人工智能", "value": 1006 }] }
    ],
    "recomTopLists": [{ "title": "...", "img": "...", "url": "..." }],
    "traffic_url": "...",
    "set_univs_name": "清华大学",
    "set_univs_id": "1001"
  }
}
```

主要分类 ID（`class_id`）：

| 一级 | 分类 | ID |
| --- | --- | --- |
| 工科 | 数学建模 / 程序设计 / 机器人 / 工程机械 / 土木建筑 | 1 / 2 / 4 / 9 / 10 |
| 工科 | 大数据 / 交通车辆 / 航空航天 / 船舶海洋 / 环境能源 | 34 / 11 / 12 / 13 / 15 |
| 工科 | 计算机&信息技术 / 材料高分子 / 电子&自动化 | 6 / 14 / 5 |
| 工科 | 人工智能 | 1006 |
| 文科 | 工业&创意设计 / 外语 / 演讲主持&辩论 / 模特 | 21 / 19 / 24 / 23 |
| 文科 | 歌舞书画&摄影 / 体育 / 科技文化艺术节 / UI 设计 | 25 / 32 / 33 / 20 |
| 文科 | 服装设计 / 电子竞技 / 艺术素养 | 22 / 31 / 36 |
| 理科 | 数学 / 物理 / 化学化工 / 健康生命&医学 / 力学 | 16 / 17 / 18 / 30 / 35 |
| 商科 | 创业 / 商业 / 创青春 | 3 / 26 / 8 |
| 综合 | 职业技能 / 挑战杯 / 环保公益 / 社会综合 | 28 / 7 / 27 / 29 |

#### 列表

```http
GET https://apiv4buffer.saikr.com/api/pc/contest/lists
    ?page=1&limit=10&class_id=1006&level=4&sort=0&univs_id=
Referer: https://www.saikr.com/contests
```

参数：

| 参数 | 说明 |
| --- | --- |
| `page` | 从 1 开始 |
| `limit` | 实测最大 100（默认 10） |
| `class_id` | 二级分类 ID，可留空 |
| `level` | `0` 不限、`1` 校级、`2` 市级、`3` 省级、`4` 全国性、`5` 全球性、`6` 自由、`7` 其他 |
| `sort` | `0` 报名时间、`1` 开赛时间、`2` 最近更新、`3` 最多浏览 |
| `univs_id` | 学校过滤，通常留空 |

响应：

```json
{
  "code": 200,
  "data": {
    "total": 5161,
    "list": [{
      "contest_id": 58100,
      "contest_name": "2026大学生“麟创杯”创新数学竞赛",
      "contest_url": "vse/LCBCXSX",
      "regist_start_time": 1777392000,
      "regist_end_time": 1792929600,
      "contest_start_time": 1792807200,
      "contest_end_time": 1792940400,
      "level_name": "全国性",
      "organiser": "中国技术市场协会数智技术专业委员会 等",
      "enter_range": "全国",
      "contest_class_second": "computer",
      "contest_class_second_id": 6,
      "time_status": 22,
      "time_name": "比赛进行中",
      "labels": ["最后一赛", "数学竞赛", "单机位答题"],
      "thumb_pic": "https://publicqn.saikr.com/..."
    }]
  }
}
```

#### 关键词搜索

```http
GET https://apiv4buffer.saikr.com/api/pc/search/info
    ?keyword=数学&type=0&page=1&limit=20
Referer: https://www.saikr.com/search
```

- `keyword` 必填；`type=0` 为默认聚合结果（实测其他 type 无数据）。
- `limit` 实测最大 50；返回 `total`、`total_page`、`list`（字段同列表）。
- 搜索结果适合做「在线补充」，不建议按页全量翻取。

#### 详情

```http
GET https://apiv4buffer.saikr.com/api/pc/contest/info?contest_id=58100
# 或
GET https://apiv4buffer.saikr.com/api/pc/contest/info?contest_url=LCBCXSX
Referer: https://www.saikr.com/vse/LCBCXSX
```

注意：`contest_url` 只传 slug，不能带 `vse/` 前缀。

主要字段：

| 字段 | 说明 |
| --- | --- |
| `contest_name` | 标题 |
| `organiser` | 主办方数组 |
| `org_real_name` / `org_uid` | 发布组织 |
| `regist_start_time` / `regist_end_time` | 报名起止（`YYYY/MM/DD HH:mm:ss`） |
| `contest_start_time` / `contest_end_time` | 比赛起止 |
| `participation_explain` / `participation_detail` | 参赛范围与说明 |
| `contest_class_first` / `contest_class_second` | 分类 |
| `contest_level` | 数字级别（4 常见为全国性） |
| `content` | 富文本正文（含图片、费用、赛制等） |
| `focus_num` / `look_count` | 关注/浏览 |
| `notice_count` / `news_count` | 通知/新闻数 |
| `is_redirect_external` / `external_link` | 是否跳外链 |
| `customer_info` | 客服信息 |
| `configInfo` | 队伍配置（如 `team_type`） |

### 2.3 合规与限流

`https://www.saikr.com/robots.txt`：

```text
User-agent: *
Allow: /
Disallow: /search
Disallow: /search/
Disallow: /admin/
Disallow: /api/
Disallow: /*?*
Crawl-delay: 10

User-agent: bingbot
Disallow: /
```

- 前台 robots 明确禁止 `/api/` 与带查询串路径；但实际数据位于独立 API 主机，该主机 `/robots.txt` 返回 404。
- 这属于**站点内部接口**，不是公开开放 API；可能随时变更或限制。
- 首版策略：默认只做**按需搜索 + 少量列表刷新**，不并发、不批量镜像；请求间隔 ≥1.5s；失败即降级。
- 不做账号登录、不绕过验证码、不抓非公开数据。
- 建议保留 `SAIKR_ENABLED` 开关，必要时可完全关闭该源。

---

## 3. 我爱竞赛网（52jingsai.com）

### 3.1 概况

- Discuz! X3.2 门户，**GBK 编码**，必须用 `gbk`/`gb18030` 解码。
- 列表与文章均为服务端渲染，适合按频道低频抓取。
- 文章标题常带营销前缀（`【榜单竞赛】`、`【10月24报名截止】`），需要归一化。

### 3.2 列表

频道示例：

| 频道 | URL |
| --- | --- |
| 榜单竞赛 | `https://www.52jingsai.com/bisai/xkjn/bangdan/` |
| 科技大赛 | `https://www.52jingsai.com/bisai/keji/keji/` |
| IT 应用开发 | `https://www.52jingsai.com/bisai/keji/kfyy/` |
| 学科学术 | `https://www.52jingsai.com/bisai/xkjn/xkxs/` |
| 创业大赛 | `https://www.52jingsai.com/bisai/shangyechuangye/chuangye/` |
| 英语竞赛 | `https://www.52jingsai.com/bisai/yingyujingsai/` |
| 设计比赛 | `https://www.52jingsai.com/bisai/keji/sheji/` |

分页：`<频道URL>index.php?page=N`，页码从 1 开始；榜单频道实测 12 页，每页 15 条。

列表项结构：

```html
<dl class="bbda list_bbda cl">
  <div class="atc"><a href="article-24110-1.html"><img ... alt="标题"></a></div>
  <dt class="xs2_tit"><a href="article-24110-1.html">【榜单竞赛】第十七届全国大学生市场调查与分析大赛</a></dt>
  <dd class="xs2 cl">
    【榜单竞赛】...；主办单位：中国商业统计学会；参赛报名：即日起至2026年10月31日；
    <div class="list_info"><span class="xg1">2026-10-12 12:10</span> ...</div>
  </dd>
</dl>
```

可提取：标题、相对链接、封面、摘要、发布时间、阅读数。
摘要中经常直接包含 `报名截止时间`、`主办单位`、`参赛报名`，可作为结构化线索。

### 3.3 详情

URL：`https://www.52jingsai.com/article-<id>-1.html`

| 区域 | 选择器 | 内容 |
| --- | --- | --- |
| 标题 | `h1.ph` | 原始标题 |
| 摘要 | `div.zhaiyao` | 主办方、报名窗口等 |
| 正文 | `div.d` | 通知全文（含表格、图片） |
| 发布时间 | 页面文本 / `meta` | `YYYY-MM-DD HH:mm` |
| 描述 | `meta[name=description]` | 常含主办单位与报名截止 |

注意：

- 正文可能以图片为主，纯文本提取会缺失细节；详情接口同时返回正文纯文本与原始 HTML 链接列表。
- 字段不保证齐全，缺失时保持 `null`，不根据标题猜测日期。
- 费用、形式（线上/线下）、组队要求多在正文中，首版以「线索文本」返回，不做强结构化。

### 3.4 合规与限流

`https://www.52jingsai.com/robots.txt` 主要限制：

```text
Disallow: /api/
Disallow: /search.php
Disallow: /member.php
Disallow: /admin.php
Disallow: /misc.php
```

- 列表与文章路径未被禁止；没有 `Crawl-delay`。
- 首版请求间隔 ≥2s；只抓配置内频道与页数；不抓用户中心、不抓搜索页。
- 尊重版权：只存标题、链接、摘要与必要正文用于检索展示，注明来源。

---

## 4. 官方竞赛目录

### 4.1 用途

- 判断某个赛事是否属于「全国普通高校大学生竞赛排行榜」核心赛事；
- 补全官方网址；
- 提供稳定别名，帮助跨源合并同一赛事。

### 4.2 数据来源

| 来源 | 内容 | 备注 |
| --- | --- | --- |
| 中国高等教育学会《全国普通高校大学生竞赛分析报告》 | 84 项竞赛目录 + 34 项观察目录 | 每年 3 月前后更新，权威但无稳定 JSON |
| 山东农业工程学院教务处整理页 | 2025 年 84 项目录，含官网 URL | `https://www.sdaeu.edu.cn/jwc/info/1061/2588.htm` |
| 南京工业大学研究生院整理页 | 37 项研究生赛事，含官网与常见报名月份 | `https://gra.njtech.edu.cn/cxsj/info/1004/1027.htm` |

首版把 84 项整理为 `data/official-catalog.json`，随仓库发布；字段：

```json
{
  "version": "2025",
  "source": "https://www.sdaeu.edu.cn/jwc/info/1061/2588.htm",
  "updated_at": "2026-10-25",
  "items": [
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
  ]
}
```

说明：

- 部分条目只有微信号或无官网（如税收风控案例大赛、数智化沙盘大赛），`url` 允许为 `null`。
- `typical_months` 仅对能确认的赛事填写，未知留空，避免误导。
- 每年更新一次；更新时保留旧版本号，便于追溯。

### 4.3 匹配策略

1. 标题归一化：去括号前缀、年份、`第 X 届`、标点、空白；
2. 与 `name + aliases` 做精确匹配；
3. 不精确时用字符二元组 Dice 相似度，阈值 0.86；
4. 命中后写入 `official=true`、`catalog_id`、`catalog_url`，但**保留原始标题与来源 URL**。

---

## 5. 暂缓来源（已调研，首版不接）

### 5.1 赛欢网（saihuan.net）

- UTF-8 HTML，文章路径 `/article/<category>/<id>.html`；
- 有 `/tags/100.html`（学科竞赛榜单赛事）、`/tags/101.html`（国家级赛事）标签；
- 详情页结构化字段少，日期多在正文或图片中，抽取成本高于收益。

### 5.2 创赛云（newunivs.com）

- WordPress + Zibll 主题，开放 `wp-json/wp/v2/posts`，可翻页；
- 内容以赛事通知/新闻为主，不是标准化竞赛条目；
- 适合后续做「官方通知」源，而不是首版主数据源。

### 5.3 官方站点

`cy.ncss.cn`、`tiaozhanbei.net`、`mcm.edu.cn`、`nuedcchina.com`、`ciscn.cn` 等官网信息最权威，但页面结构各异、赛程更新频率低。首版通过官方目录提供入口，后续按赛事优先级逐个增加适配器。

### 5.4 微信公众号 / 社群

无稳定公开接口，且需要登录态；不纳入自动抓取。周报中的人工线索可后续通过导入接口补充。

---

## 6. 合规与使用边界

- 本服务定位为**个人学习与信息整理工具**，不做商业再分发。
- 仅访问公开页面/接口，不登录、不绕过验证码、不破解签名。
- 遵守各站 robots 的明示限制；赛氪内部 API 的限制已在 2.3 单独说明，默认低频率并支持关闭。
- 返回结果始终带 `source` 与原始 `url`，便于核对与署名。
- 若站点明确要求停止访问，应关闭对应适配器，保留本地缓存只读。
