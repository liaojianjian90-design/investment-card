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
