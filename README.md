# 投资健康卡 5.2

**稳健进攻 + AI 抽水机主攻仓版。**

本项目是个人投资仓位管理与纪律提醒页面，不是自动交易工具。当前版本已移除前端手动买入/卖出、本地仓位编辑和云端同步设置，仓位唯一来源为：

```text
config/holdings.json
```

你只需要修改 `config/holdings.json`，提交到 GitHub 后运行 GitHub Actions，系统会重新生成：

```text
data/snapshot.json
data/alerts.json
data/alert-state.json
```

页面会读取最新快照，展示投资健康评分、仓位结构、今日动作纪律、价格源状态和邮件触发结果。

---

## 5.2 核心变化

### 1. 仓位来源简化

已移除：

- 前端手动买入 / 卖出入口
- 前端手动更新仓位
- Cloudflare Worker 同步设置
- 手动交易流水叠加逻辑

现在只以 `config/holdings.json` 为准。这样可以避免手机端缓存、本地交易记录、云端同步和 GitHub 快照之间相互覆盖。

### 2. 从防守观察型升级为稳健进攻型

现金目标从原来的偏防守区间，调整为更有进攻性的：

```text
现金成熟目标：40% - 50%
第一阶段目标：现金降到 70%
第二阶段目标：现金降到 60%
```

现金仍有底线：

```text
现金 < 40%：暂停普通加仓
现金 < 35%：停止新增买入
现金 < 30%：进入防守模式
```

### 3. AI 抽水机主攻仓

AI 主题从“小观察仓”升级为“AI 抽水机主攻仓”：

```text
当前阶段目标：8% - 12%
成熟阶段目标：15% - 20%
硬上限：25%
```

AI 抽水机仓不是随便买 AI 概念，而是只关注产业链利润卡口，例如：

- 存储 / HBM
- 光纤 / 玻璃基板
- AI 网络与互联
- 半导体 ETF 篮子
- 先进制程与设备

### 4. GLW 康宁提升权重

你看好的康宁 `GLW` 已经提升到与 `MU`、`DRAM` 同一重视层级。

AI 抽水机核心优先标的：

```text
MU / DRAM / GLW
```

定位：

| 标的 | 定位 |
|---|---|
| MU | AI 存储 / HBM 主攻 |
| DRAM | 存储 ETF / 高弹性主攻 |
| GLW | 光纤 / 玻璃基板 / AI 数据中心基础设施主攻 |

规则上，三者同列优先，但仍受仓位上限约束：

```text
单一优先标的目标：约 5%
单一优先标的硬上限：约 8%
```

---

## 推荐仓位框架

以账户约 1.5 - 1.6 万 USDT 为例，5.2 目标结构是：

| 资产层 | 目标比例 | 说明 |
|---|---:|---|
| 现金 | 40% - 50% | 防守和二次进攻权 |
| BTC / ETH | 12% - 18% | 加密核心仓 |
| VOO / XAUT | 8% - 15% | 长期稳定层 |
| AI 抽水机主攻仓 | 15% - 20% | 收益主攻层 |
| DOGE / BGB | 0% - 2% | 投机清理仓 |

禁止行为：

```text
不加杠杆
不自动交易
不满仓
不把 DOGE/BGB/HYPE 当主攻仓
不把 2 倍 ETF 当长期核心仓
不在现金低于 35% 时新增买入
```

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

现金也要同步调整，例如 USDT 数量减少或增加。

提交到 GitHub 后，进入：

```text
Actions → Investment Health Card 5.2 Monitor → Run workflow
```

运行成功后，页面会读取新生成的 `data/snapshot.json`。

---

## 本地检查

```bash
npm install
npm test
npm run monitor:dry
```

如果只是检查规则和页面结构，运行：

```bash
npm test
```

---

## GitHub Actions

`.github/workflows/monitor.yml` 会定期运行监控，并在以下文件变化时触发：

```text
config/holdings.json
config/rules.json
scripts/monitor.mjs
src/lib/investmentHealth.mjs
```

监控任务会：

1. 读取 `config/holdings.json`
2. 拉取价格源
3. 生成 `data/snapshot.json`
4. 生成 `data/alerts.json`
5. 更新 `data/alert-state.json`
6. 如配置 SMTP，则发送邮件提醒

---

## 风险声明

本项目仅用于个人投资记录、仓位管理和纪律提醒，不构成投资建议。所有买入、卖出、持有决策由使用者自行承担风险。系统规则用于降低冲动交易和仓位失控风险，但不能保证收益，也不能避免市场亏损。

AI 抽水机仓可以提高收益弹性，但也会提高波动；GLW、MU、DRAM 即使被列为优先主攻，也不能突破总仓和单标的风控上限。


## 5.2 RAM短线T仓规则

RAM 是 2倍做多存储板块 ETF，只用于急跌后的技术反抽，不纳入长期主攻仓。反弹到 22.5 附近减半，23.5 附近卖出大部分，24.5 附近清仓；跌破 20 先减半，跌破 19.5 清仓。
