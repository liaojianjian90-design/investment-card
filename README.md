# 投资健康卡 5.2

**有效仓位 + AI 主攻仓版。**

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

## 5.2 核心变化

### 1. 从“安全观察”升级为“有效仓位”

5.2 不再鼓励每个标的只买 50-100 USDT 的心理仓。系统会把仓位太小、现金太高识别为“可能浪费行情”。

目标结构：

| 资产层 | 目标比例 | 说明 |
|---|---:|---|
| 现金 | 40% - 45% | 保留防守和二次进攻权 |
| BTC / ETH | 12% - 16% | 加密核心底盘 |
| VOO / XAUT | 8% - 13% | 长期稳定层 |
| AI 抽水机主攻仓 | 20% - 30% | 收益主攻层 |
| DOGE / BGB | 0% - 2% | 投机清理仓 |

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

5.2 已将 `GLW` 正式提升为第一主攻层，与 `MU`、`DRAM` 同等重视。

| 标的 | 定位 | 规则 |
|---|---|---|
| MU | AI 存储 / HBM 主攻 | 单项目标 4%-7%，硬上限 8% |
| DRAM | 存储 ETF / 高弹性主攻 | 单项目标 4%-7%，硬上限 8% |
| GLW | 光纤 / 玻璃基板 / AI 数据中心基础设施主攻 | 单项目标 4%-7%，硬上限 8% |
| SMH | 半导体 ETF 篮子 | 目标 4%-6%，可替代过多单一 AI 个股 |

### 4. 单笔主攻买入不宜过小

新增有效仓位规则：

```text
主攻仓单笔建议 300 USDT 起
观察仓单笔建议 150 USDT 起
投机仓仍然小额，不能做主攻
```

这不是自动下单规则，只是页面和邮件提醒的纪律边界。

---

## 当前仓位文件

本版本已使用你上传的 `holdings.json` 作为 `config/holdings.json`。当前文件包含 USDT、USDGO、BTC、ETH、DOGE、BGB、VOO、MU、SNDK、DRAM、WDC、GLW、MRVL 等仓位。

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
