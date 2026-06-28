# 手动交易云端同步 Worker

这个 Worker 用于让 GitHub Pages 前端提交“买入/卖出记录”，但不把 GitHub Token 放到前端。

## 需要配置的环境变量 / Secrets

- `GITHUB_TOKEN`：Fine-grained GitHub token，只给当前仓库 Contents Read and Write 权限。
- `GITHUB_OWNER`：你的 GitHub 用户名。
- `GITHUB_REPO`：仓库名。
- `GITHUB_BRANCH`：通常是 `main`。
- `SYNC_PIN`：你自己设置的提交 PIN。
- `ALLOWED_ORIGIN`：可选，例如 `https://你的用户名.github.io`。

## 工作流

前端提交交易 → Worker 校验 PIN → Worker 追加写入 `data/manual-trades.json` → GitHub Actions 重新生成 `data/snapshot.json` → 投资卡更新仓位。

不要把 `GITHUB_TOKEN` 写进前端或仓库文件。
