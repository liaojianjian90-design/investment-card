# 投资健康卡 5.0：手动交易云端同步版

本版本默认不接入 Bitget 私人账户 API，也不会自动交易。仓位更新方式是：前端手动录入买入/卖出记录 → 本机立即更新；如部署 Cloudflare Worker，可把交易流水写入 GitHub 的 `data/manual-trades.json`，再由 GitHub Actions 重新生成快照和邮件提醒。

# 投资健康卡 5.0：核心配置 + AI观察 + 邮件风控版

这是一个 GitHub Pages 静态投资纪律仪表盘。它不会自动下单，也不会把交易所 API Key 放到前端。系统只根据公开行情、默认持仓和规则生成：仓位结构、投资健康评分、今日允许动作、今日禁止动作、邮件提醒和再平衡提醒。

## 5.0 核心定位

5.0 版本的判断顺序是：

```text
数据有效 → 现金安全 → 回撤可控 → 冷却期通过 → 仓位合规 → 价格触发 → 是否发送邮件
```

系统目标不是频繁交易，而是：少交易、慢配置、强风控、邮件只在真正需要处理时触发。

## 中文名称与简介

- 中文名称：**投资健康卡 5.0**
- 副标题：**核心配置 + AI观察 + 邮件风控版**
- 页面简介：先看数据，再看现金，再看回撤，再看仓位和冷却，最后才看价格；BTC/ETH 做加密核心，VOO/XAUT 做长期稳定层，AI 观察仓只做收益增强，DOGE/BGB 只减不补。

## 资产五层结构

1. **安全现金层**：USDT、USDGO。成熟目标 55%-60%，阶段目标 75% 和 65%。现金低于 40% 暂停普通加仓，低于 35% 停止新增买入，低于 30% 进入防守模式。
2. **核心增长层**：BTC、ETH。BTC 第一阶段目标 8%-10%，成熟目标 10%-12%；ETH 第一阶段目标 3%-4%，成熟目标 4%-6%。
3. **长期稳定层**：VOO、XAUT。VOO 第一阶段 4%-6%，成熟目标 10%-12%；XAUT 第一阶段 2%-3%，成熟目标 5%-7%。
4. **AI观察仓**：AVGO、MRVL、ANET、MU、WDC、DRAM、SNDK、TSM、ASML、SMH、SOXX、FN、AAOI、GLW、ASX。当前阶段建议不超过 5%，成熟阶段 8%-10%，硬上限 15%。
5. **投机清理层**：DOGE、BGB。目标 0%-2%；2.5% 以上禁止新增；3% 以上只减不补；4% 以上高风险警告。

## MRVL 规则

MRVL 已加入 AI 观察池，定位为 **AI互联 / 定制芯片 / 数据中心网络观察仓**。

- 第一笔试仓：0.5%
- 正常观察仓：1%
- 上限：1.5%
- 硬上限：2%
- 核心仓未达标前：只观察，不发买入邮件
- 核心仓基本达标且 AI观察仓 <5%：才允许小额试仓提醒

MRVL 不是核心仓，单只 AI 股票不能替代 BTC/ETH/VOO/XAUT。

## 邮件触发规则

### 高优先级：立即提醒

- 数据超过 30 分钟或关键价格源失败
- 现金低于 35%
- 账户回撤超过 20%
- AI观察仓超过 15%
- DOGE+BGB 超过 4%
- BTC 5 分钟急跌达到观察阈值

### 中优先级：触发后提醒

- 现金低于 40%，暂停普通加仓
- DOGE+BGB ≥2.5%，禁止新增投机仓
- DOGE+BGB ≥3%，只减不补
- BTC/ETH/VOO/XAUT 价格买点触发
- DOGE 止盈价触发
- BTC/ETH/VOO/XAUT 或主题仓达到再平衡线

### 低优先级：结构提醒，每周最多一次

- 现金超过 80%，资金效率偏低
- BTC <8% 或 ETH <3%，且现金 ≥75%
- VOO = 0 或 XAUT = 0，且现金 ≥75%
- MRVL 可加入 AI 观察池，但核心仓未达标前只观察

### 不发邮件，只在网页显示

- 普通观察池说明
- 未触发买点的价格变化
- 未超过阈值的仓位变化
- 没有行动意义的噪音信号

## 邮件标题规则

- 风控：`【投资风控提醒】`
- 结构：`【投资结构提醒】`
- 监控：`【投资监控提醒】`
- 止盈/再平衡：`【投资再平衡提醒】`

## 当前默认仓位

默认配置来自 `config/holdings.json`：

- USDT: `12218.88430083`
- USDGO: `1502.54376978`
- BTC: `0.01841215`，成本 `59741.49`
- ETH: `0.1592747`，成本 `1569.49`
- DOGE: `5073.6003142`，成本 `0.07489`
- BGB: `25.91259087`，成本 `1.978`
- MU: `0.17540371`，成本 `1139.16`
- WDC: `0.3305247`，成本 `604.3`
- 其他观察池标的数量默认为 `0`。

## 价格源

当前监控优先使用 Bitget 公开行情。前端和 GitHub Actions 都不会保存交易所 API Key。

- BTC: `BTCUSDT`
- ETH: `ETHUSDT`
- DOGE: `DOGEUSDT`
- BGB: `BGBUSDT`
- XAUT: `XAUTUSDT`
- VOO: `RVOOUSDT`
- AVGO: `RAVGOUSDT`
- FN: `RFNUSDT`
- MU: `RMUUSDT`
- SNDK: `RSNDKUSDT`
- DRAM: `RDRAMUSDT`
- WDC: `RWDCUSDT`
- ASX: `RASXUSDT`
- AAOI: `RAAOIUSDT`
- GLW: `RGLWUSDT`

MRVL、ANET、TSM、ASML、SMH、SOXX 已加入规则观察池，但默认不强制拉取价格，避免因未配置价格源造成错误买入提醒。

## GitHub Actions 文件

自动监控文件位于：

```text
.github/workflows/monitor.yml
```

5.0 版本已更新：

- Workflow 名称：`Investment Health Card 5.0 Monitor`
- 运行前会先执行 `npm test`
- 使用 concurrency 避免上一次监控未结束时重复运行
- 每 5 分钟检查一次，但邮件触发受规则节流控制

## GitHub Pages 设置

仓库页面进入：

```text
Settings -> Pages -> Build and deployment
```

选择：

- Source: `Deploy from a branch`
- Branch: `main`
- Folder: `/ (root)`

保存后访问：

```text
https://你的GitHub用户名.github.io/investment-card/
```

## GitHub Actions Secrets

仓库页面进入：

```text
Settings -> Secrets and variables -> Actions -> New repository secret
```

至少添加：

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `ALERT_EMAIL_TO`

可选：

- `ALERT_EMAIL_FROM`

QQ 邮箱常见配置：

- `SMTP_HOST`: `smtp.qq.com`
- `SMTP_PORT`: `465`
- `SMTP_USER`: 你的 QQ 邮箱地址
- `SMTP_PASS`: QQ 邮箱生成的 SMTP 授权码，不是 QQ 登录密码
- `ALERT_EMAIL_TO`: 接收提醒的邮箱

## 测试邮件

仓库页面进入：

```text
Actions -> Investment Health Card 5.0 Monitor -> Run workflow
```

然后：

1. Branch 保持 `main`。
2. 勾选或打开 `test_email`。
3. 点击绿色 `Run workflow`。
4. 等待运行成功。
5. 检查邮箱是否收到测试邮件。

## 本地运行

```bash
npm install
npm test
npm run monitor:dry
```

## 手机页面缓存

如果上传后手机仍显示旧页面：

1. 打开页面。
2. 在网址后加 `?v=5` 强制刷新。
3. 或清理该网站缓存后重新打开。

本版本已升级 Service Worker 缓存名，正常上传后会自动替换旧缓存。

## 风险声明

本项目仅用于个人投资记录、仓位管理和纪律提醒，不构成投资建议。所有买入、卖出、持有决策由使用者自行承担风险。系统规则用于降低冲动交易和仓位失控风险，但不能保证收益，也不能避免市场亏损。

## Bitget 只读 API 同步

5.0.1 已加入 Bitget 只读 API 同步能力。它只读取现货账户资产数量，不下单、不撤单、不划转、不提现。

数据流：

```text
Bitget 只读 API
  ↓
GitHub Actions / 后台脚本
  ↓
更新 data/snapshot.json
  ↓
GitHub Pages 页面重新计算健康评分、今日动作和邮件提醒
```

安全原则：

- API Key、Passphrase、RSA 私钥不能写进 `index.html`、`config/*.json`、`data/*.json` 或任何公开仓库文件。
- 前端网页永远不接触 API Key。
- Bitget 权限只开“只读权限”。
- 不开读写、交易、划转、提现、跟单、C2C、子账户等权限。
- 有固定服务器 IP 时建议绑定 IP；如果使用普通 GitHub Actions，出口 IP 不固定，IP 白名单需要另外设计。

### 1. 生成 RSA 密钥

在本地电脑运行：

```bash
openssl genrsa -out bitget_rsa_private.pem 2048
openssl rsa -in bitget_rsa_private.pem -pubout -out bitget_rsa_public.pem
```

把 `bitget_rsa_public.pem` 里的内容粘贴到 Bitget API 创建页面的“您的公钥”。

不要上传、发送或公开 `bitget_rsa_private.pem`。

### 2. 创建 Bitget API

建议填写：

- 备注名：`investment-card-readonly`
- Passphrase：自己生成并保存到密码管理器
- 权限：只读权限
- 具体权限：现货交易/现货账户读取相关权限
- 绑定 IP：有固定服务器 IP 就填；没有固定 IP 时不要开启交易权限

### 3. 把私钥转成 Base64

macOS：

```bash
base64 -i bitget_rsa_private.pem | pbcopy
```

Linux：

```bash
base64 -w0 bitget_rsa_private.pem
```

### 4. 添加 GitHub Secrets

仓库页面进入：

```text
Settings -> Secrets and variables -> Actions -> New repository secret
```

新增：

- `BITGET_READONLY_ENABLED`：`true`
- `BITGET_API_KEY`：Bitget 创建后给你的 API Key
- `BITGET_PASSPHRASE`：你创建 API 时设置的 Passphrase
- `BITGET_RSA_PRIVATE_KEY_BASE64`：上一步生成的私钥 Base64 字符串
- `BITGET_SYNC_SYMBOLS`：可选，默认 `USDT,USDGO,BTC,ETH,DOGE,BGB,XAUT`

如果你暂时不想同步 Bitget，把 `BITGET_READONLY_ENABLED` 改成 `false` 或删除即可。

### 5. 测试 Bitget 只读连接

本地测试：

```bash
npm run bitget:check
```

GitHub Actions 测试：

```text
Actions -> Investment Health Card 5.0 Monitor -> Run workflow
```

运行成功后检查 `data/snapshot.json` 是否出现：

```json
"bitgetSync": {
  "enabled": true,
  "used": true,
  "source": "bitget-readonly-spot-assets"
}
```

### 6. 成本价说明

Bitget 只读同步只会更新数量，例如 BTC、ETH、DOGE、BGB、USDT 的数量。

它不会自动计算成本价。`config/holdings.json` 里的 `cost` 仍需要你手动维护，避免错误的浮盈/浮亏判断。

### 7. 文件说明

新增文件：

- `scripts/bitget-readonly.mjs`：Bitget RSA 签名、只读请求、现货资产同步
- `scripts/bitget-readonly-check.mjs`：只读 API 连接测试

修改文件：

- `scripts/monitor.mjs`：监控运行前可先同步 Bitget 现货资产数量
- `.github/workflows/monitor.yml`：从 GitHub Secrets 注入 Bitget 只读配置
- `config/rules.json`：增加只读同步规则说明
- `package.json`：增加 Bitget 检查命令



## 手动买入 / 卖出入口与云端同步

5.0 手动同步版支持在前端录入买入或卖出记录，用于不接入 Bitget API 的情况下更新仓位。

### 两种使用方式

1. **本机模式**：在网页里填写方向、标的、数量、成交价和手续费，点击“保存到本机并更新仓位”。页面会立刻重新计算仓位、健康评分、今日允许动作和今日禁止动作。这个模式只影响当前浏览器，不会触发邮件。

2. **云端模式**：部署 `cloudflare-worker/manual-sync-worker.js`，在网页里填写 Worker 地址和同步 PIN，然后点击“提交到云端”。Worker 会把交易追加到 `data/manual-trades.json`，GitHub Actions 会重新运行监控并生成新的 `data/snapshot.json`、`data/alerts.json` 和邮件判断。

### 云端模式安全边界

- 前端不保存 GitHub Token。
- 前端不保存交易所 API Key。
- GitHub Token 只放在 Cloudflare Worker 的 Secrets 里。
- Worker 只追加交易流水，不会自动下单。
- 邮件提醒仍然只做纪律提醒，不构成投资建议。

### Cloudflare Worker 需要的变量

```text
GITHUB_TOKEN=Fine-grained GitHub token，只给当前仓库 Contents Read and Write 权限
GITHUB_OWNER=你的 GitHub 用户名
GITHUB_REPO=仓库名
GITHUB_BRANCH=main
SYNC_PIN=你自己设置的同步 PIN
ALLOWED_ORIGIN=https://你的用户名.github.io
```

### 手动交易文件格式

交易记录会保存到：

```text
data/manual-trades.json
```

格式示例：

```json
{
  "updatedAt": "2026-06-28T00:00:00.000Z",
  "trades": [
    {
      "id": "2026-06-28-buy-btc-001",
      "action": "buy",
      "symbol": "BTC",
      "quantity": 0.001,
      "price": 60000,
      "fee": 0.2,
      "cashSymbol": "USDT",
      "tradedAt": "2026-06-28T00:00:00.000Z",
      "note": "手动买入 BTC"
    }
  ]
}
```

`npm run monitor` 会从 `config/holdings.json` 作为基础仓位，叠加 `data/manual-trades.json` 的交易流水，再生成最新快照。这样不会把前端写成自动交易工具，也不会把敏感密钥暴露在 GitHub Pages 前端。


### GitHub Actions 长时间运行或卡住

5.0 手动云端版已为行情请求增加 10 秒超时，并为 `Run 5.0 monitor` 步骤设置 3 分钟超时。
如果 GitHub Actions 页面显示黄色圆圈 `In progress`，先点左侧 `monitor` 查看具体卡在哪一步；如果是行情 API 超时，系统会把该标的标记为价格源异常，而不是无限等待。


### GitHub Actions npm ci 卡住修复

如果工作流卡在 `Install dependencies / npm ci`，请确认 `package-lock.json` 中的 `nodemailer` 下载地址是 `https://registry.npmjs.org/`，不要使用本地或私有镜像地址。本版本已把安装步骤改为使用 npm 官方 registry，并设置 2 分钟安装超时，避免任务长期卡住。

## 5.0 修复说明：手动同步仓位与美股价格源

本版修复两个问题：

1. **MU / WDC 仓位在前端消失**：前端原来使用内置默认持仓作为本地交易基准，默认值里 MU / WDC 为 0。现在前端会优先读取 `config/holdings.json` 作为基准持仓，并且已更新本地缓存 key，避免旧浏览器缓存覆盖真实仓位。
2. **MRVL / ANET / TSM / ASML / SMH / SOXX 价格源失败**：新增 Yahoo Finance 与 Stooq 作为美股和 ETF 的备用价格源。Bitget tokenized stock 行情不可用时，系统会自动尝试备用源。

上传本版后，请在网页端刷新并可追加 `?v=503` 清缓存；如果仍看到旧仓位，可点击“恢复默认配置”清除旧本地缓存。

### v5 手机端价格源修复说明

如果电脑端价格正常、手机端显示 MRVL/ANET/TSM/ASML/SMH/SOXX 价格源失败，通常是手机端存在本地交易缓存，浏览器会尝试前端直连 Yahoo/Stooq；移动端网络或跨域策略可能失败。v5 已改为：优先使用 GitHub Actions 生成的 `data/snapshot.json` 价格作为手机端备用价格，前端直连失败时不再把这些美股/ETF 标记为价格源失败。

手机端更新后建议访问：`?v=505`，必要时清除浏览器站点数据或点击页面中的“恢复默认配置”。


## 5.0 v6 修复说明

- 页面端不再让零仓位观察标的触发“价格源失败”。MRVL / ANET / TSM / ASML / SMH / SOXX 如未持仓，只作为观察池展示，不要求手机端实时拉价。
- 当 GitHub Actions 生成的 `data/snapshot.json` 超过 30 分钟时，页面会尝试用浏览器重新计算一份当前展示快照；如果手机端无法直连行情源，会使用上一次 GitHub 快照价格作为展示兜底，并在来源中标记“快照备用”。
- 监控脚本会读取上一份 `snapshot.json` 作为价格兜底，避免某一次行情 API 抖动导致仓位消失或整页价格失败；零仓位标的不再计入价格错误。



## v7 手机端视觉优化

本版本不改变投资系统结构、规则和内容，只优化手机端展示体验：

- 缩小手机端卡片间距、标题字号和表单高度。
- 账户快照、资产五层、今日动作改为更紧凑的双列展示。
- 分阶段计划和规则说明在手机端改为横向滑动卡片，内容不删除。
- 零仓位观察标的和手动交易区保持原功能，仅减少视觉占用。
- Service Worker 缓存升级到 v506，手机端可用 `?v=506` 强制刷新。
