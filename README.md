# 投资监控卡 GitHub Pages 发布文件

这是一个不需要 Bitget API Key 的投资纪律监控页。它不会自动下单，只会根据公开行情、默认持仓和规则触发邮件提醒。

## 当前版本

- GitHub Actions 默认每 5 分钟运行一次。
- 加密与黄金优先使用 Bitget 公开行情。
- 代币化证券优先使用 Bitget 公开行情。
- 页面和邮件均显示价格源与数据是否过期。
- 数据 10 分钟内视为正常，10-30 分钟为偏旧，超过 30 分钟禁止按信号买入。
- 已移除此前的旧投机仓标的。
- 当前观察池：VOO、XAUT、AVGO、FN、MU、SNDK、DRAM、WDC、ASX、AAOI、GLW。

## 当前默认仓位

默认配置来自 2026-06-27 截图：

- USDT: `12618.88430083`
- USDGO: `1502.54376978`
- BTC: `0.01841215`，成本 `59741.49`
- ETH: `0.1592747`，成本 `1569.49`
- DOGE: `5073.6003142`，成本 `0.07489`
- BGB: `25.91259087`，成本 `1.978`
- 观察池标的数量均为 `0`，只用于监控买点。

## 核心纪律

- 现金低于 35%：停止所有新增买入。
- 现金低于 40%：暂停普通加仓。
- 每天最多一笔主动交易提醒。
- BTC 急跌触发后，当天不再触发 AI 观察池买入。
- DOGE 与 BGB 不补仓，只止盈或反弹清理。
- 不做合约、不做杠杆、不做自动下单。

## 价格源

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

## GitHub Pages 设置

仓库页面进入：

`Settings -> Pages -> Build and deployment`

选择：

- Source: `Deploy from a branch`
- Branch: `main`
- Folder: `/ (root)`

保存后访问：

`https://你的GitHub用户名.github.io/investment-card/`

## GitHub Actions Secrets

仓库页面进入：

`Settings -> Secrets and variables -> Actions -> New repository secret`

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
- `ALERT_EMAIL_TO`: `410097506@qq.com`

## 测试邮件

仓库页面进入：

`Actions -> Investment Monitor -> Run workflow`

然后：

1. Branch 保持 `main`。
2. 勾选或打开 `test_email`。
3. 点击绿色 `Run workflow`。
4. 等待运行成功。
5. 检查邮箱是否收到测试邮件。

如果运行成功但没有收到邮件，检查 `data/alerts.json`：

- `email.sent` 是否为 `true`
- `email.missing` 是否提示缺少 Secret

## 手机页面缓存

如果上传后手机仍显示旧页面：

1. 打开 Chrome 页面。
2. 在网址后加 `?v=3` 强制刷新。
3. 或清理该网站缓存后重新打开。

本版本已升级 Service Worker 缓存名，正常上传后会自动替换旧缓存。
