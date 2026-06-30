# 投资健康卡 5.2.1

**有效仓位规则增强版：核心/稳定/AI 主攻买入金额上调，DOGE 作为 BTC 高弹性卫星仓。**

本项目是个人投资仓位管理与纪律提醒页面，不是自动交易工具。当前版本继续保持“仓位唯一来源”为：

```text
config/holdings.json
```

本次已把你上传的现有仓位文件写入 `config/holdings.json`，后续你只需要直接修改这个文件并提交 GitHub，系统会重新生成：

```text
data/snapshot.json
data/alerts.json
data/alert-state.json
```

---

## 5.2.1 核心变化

### 1. 从“安全观察”升级为“有效仓位”

5.2.1 进一步强化“有效仓位”原则：核心仓、稳定仓、AI 主攻仓不再发出 100 USDT 级别买入提醒；BTC/ETH、VOO/XAUT、MU/DRAM/GLW/SMH 等主线单笔建议提升到 500 USDT 级别，避免看对行情但赚不到钱。

目标结构：

| 资产层 | 目标比例 | 说明 |
|---|---:|---|
| 现金 | 40% - 45% | 保留防守和二次进攻权 |
| BTC / ETH | 12% - 16% | 加密核心底盘 |
| VOO / XAUT | 8% - 13% | 长期稳定层 |
| AI 抽水机主攻仓 | 20% - 30% | 收益主攻层 |
| DOGE / BGB | 0% - 4% | BTC 高弹性卫星仓，4.5% 后禁止新增 |

现金纪律仍保留：

```text
现金 < 40%：暂停普通加仓
现金 < 35%：停止新增买入
现金 < 30%：进入防守模式
```

### 2. AI 主攻仓目标提高到 20%-30%

AI 主攻仓不是概念股杂货铺，而是集中在产业链利润卡口：

第一主攻层：

```text
MU / DRAM / GLW
```

第二主攻层：

```text
SMH / MRVL / ANET / AVGO / TSM / ASML / SOXX
```

补充和高波动层：

```text
WDC / SNDK / FN / AAOI / ASX
```

### 3. 康宁 GLW 提升到和 MU、DRAM 同级

5.2.1 继续将 `GLW` 正式放在第一主攻层，与 `MU`、`DRAM` 同等重视；同时提高有效买入金额，避免 GLW 只停留在心理仓。

| 标的 | 定位 | 规则 |
|---|---|---|
| MU | AI 存储 / HBM 主攻 | 单项目标 4%-7%，硬上限 8% |
| DRAM | 存储 ETF / 高弹性主攻 | 单项目标 4%-7%，硬上限 8% |
| GLW | 光纤 / 玻璃基板 / AI 数据中心基础设施主攻 | 单项目标 4%-7%，硬上限 8% |
| SMH | 半导体 ETF 篮子 | 目标 4%-6%，可替代过多单一 AI 个股 |

### 4. 单笔主攻买入不宜过小

新增有效仓位规则：

```text
核心/稳定/AI 主攻仓单笔建议 500 USDT 起
观察仓单笔建议 150 USDT 起
DOGE 可作为 BTC 上涨放大器适度提高上限；BGB 仍保持小仓，不随 DOGE 放大
```

这不是自动下单规则，只是页面和邮件提醒的纪律边界。

---

## 当前仓位文件

本版本仍使用你上传的 `holdings.json` 作为 `config/holdings.json`，并以该文件作为唯一仓位来源。当前文件包含 USDT、USDGO、BTC、ETH、DOGE、BGB、VOO、MU、SNDK、DRAM、WDC、GLW、MRVL 等仓位。

---

## 如何更新仓位

打开：

```text
config/holdings.json
```

修改数量和成本价，例如：

```json
{
  "symbol": "GLW",
  "quantity": 1.2,
  "cost": 221.5,
  "type": "watch"
}
```

现金也要同步调整，例如买入后减少 USDT 数量。

提交到 GitHub 后，进入：

```text
Actions → Investment Health Card 5.2 Monitor → Run workflow
```

---

## 本地检查

```bash
npm install
npm test
npm run monitor:dry
```

---

## 风险声明

本项目仅用于个人投资记录、仓位管理和纪律提醒，不构成投资建议。所有买入、卖出、持有决策由使用者自行承担风险。系统规则用于降低冲动交易和仓位失控风险，但不能保证收益，也不能避免市场亏损。

5.2 提高了 AI 主攻仓目标，这意味着组合波动也会变大。MU、DRAM、GLW 即使被列为第一主攻层，也不能突破单标的 8% 硬上限和 AI 总仓 30% 硬上限。


## 5.2.1 买入规则升级

### BTC / ETH 分批规则

| 条件 | 新买入金额 |
|---|---:|
| BTC ≤ 58,000 | BTC 450 + ETH 250 |
| BTC ≤ 57,000 | BTC 650 + ETH 350 |
| BTC ≤ 56,000 | BTC 850 + ETH 450 |
| BTC ≤ 55,000 | BTC 1,100 + ETH 600 |
| ETH ≤ 1,500 | ETH 500 |
| ETH ≤ 1,350 | ETH 800 |

核心仓不再使用 100 USDT 级别小单。每周核心仓合计买入上限提高到总资产 5%，但仍受现金底线、回撤刹车、数据有效性约束。

### VOO / XAUT 稳定层

| 条件 | 新买入金额 |
|---|---:|
| VOO ≤ 655 | 500 USDT |
| VOO ≤ 625 | 700 USDT |
| XAUT ≤ 4000 | 500 USDT |
| XAUT ≤ 3850 | 700 USDT |

稳定层的作用是账户底盘，不是短线交易。既然要建仓，就要做到有效仓位。

### AI 抽水机主攻仓

| 标的层级 | 标的 | 单笔建议 |
|---|---|---:|
| 第一主攻层 | MU / DRAM / GLW / SMH | 500 USDT 起 |
| 第二梯队 | MRVL / ANET / AVGO / TSM / ASML / SOXX | 350 USDT 起 |
| 存储补充 | WDC / SNDK | 250-350 USDT |
| 高波动小票 | AAOI / FN / ASX | 150-350 USDT，严格小仓 |

### DOGE 新定位

DOGE 可以作为 BTC 上涨周期的高弹性卫星仓，而不是绝对只减不补。但它仍然不是核心仓。

| 条件 | 动作 |
|---|---|
| DOGE+BGB ≤ 4% | 可以观察；DOGE 只在 BTC 趋势确认时考虑小额 |
| DOGE+BGB ≥ 4.5% | 禁止新增 |
| DOGE+BGB ≥ 5% | 只允许趋势止盈或反弹减仓 |
| DOGE+BGB ≥ 6% | 高风险警戒 |
| DOGE 单独 > 5.5% | 卖出 25% 回现金 |

BGB 不享受 DOGE 的放大器逻辑，BGB 仍按小投机仓管理。

### 止盈与再平衡

- MU / DRAM / GLW 超过 10%：卖出 15% 回现金。
- SMH / SOXX 超过 10%：复核半导体 ETF 仓位。
- MRVL / ANET / AVGO / TSM / ASML 超过 6%：降低单股集中度。
- DOGE 到 0.10 / 0.12 或仓位超过 5.5%：分批止盈。
- AI 总仓超过 30%：停止新增并复盘。

