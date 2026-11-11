# 站点意见反馈部署

访客可以从首页导航打开意见反馈。留言最多 500 字，可以附一张不超过 2 MiB 的 PNG、JPEG 或 WebP 截图。Base64 用于浏览器传输，数据库和邮件附件使用校验后的原图字节。

## 数据库

部署前在目标 PostgreSQL 数据库应用 [增量 SQL](../prisma/changes/20261110-site-feedback.sql)。该脚本新建私有的 `site_feedback` 表并启用 RLS，适用于已经初始化的数据库，可重复执行。安装依赖时重新生成 Prisma Client。可以在 Supabase 的 SQL 编辑器执行，或在仓库根目录用直连地址执行。

```sh
psql "$POSTGRES_URL_NON_POOLING" -X -v ON_ERROR_STOP=1 -f prisma/changes/20261110-site-feedback.sql
```

站主可在 Supabase 数据库管理界面或 Prisma Studio 的 `SiteFeedback` 查看正文、时间、反馈 ID 和邮件状态。使用现有的服务端数据库环境变量导出指定截图：

```sh
pnpm feedback:export <反馈ID> [输出路径]
```

省略输出路径时，文件会按实际格式保存在当前目录。命令会拒绝覆盖同名文件。若在本地使用 `.env.local`，可用 `node --env-file=.env.local scripts/export-feedback-screenshot.mjs <反馈ID>`。

## 邮箱转发

使用现有 Vercel 项目，选择 Node.js 22 或更新版本并启用 Fluid Compute。保持 **Settings → Environment Variables → Enable access to System Environment Variables** 和项目的 OIDC 启用，队列使用平台提供的部署 ID 和认证。

在同一页面为 **Production** 添加以下服务端变量。`FEEDBACK_MAIL_TO` 是你的收件地址，`FEEDBACK_MAIL_FROM` 是 SMTP 账号获准使用的发件地址，SMTP 主机、端口、账号和授权码由发信服务提供。

```dotenv
FEEDBACK_MAIL_ENABLED=true
FEEDBACK_MAIL_TO=owner@example.com
FEEDBACK_MAIL_FROM=feedback@example.com
FEEDBACK_SMTP_HOST=smtp.example.com
FEEDBACK_SMTP_PORT=587
FEEDBACK_SMTP_SECURITY=starttls
FEEDBACK_SMTP_USER=feedback@example.com
FEEDBACK_SMTP_PASSWORD=
CRON_SECRET=
```

按 SMTP 服务要求选择端口和加密方式，常见配置是 587 配 `starttls`，或 465 配 `implicit`。把 `FEEDBACK_SMTP_PASSWORD` 和 `CRON_SECRET` 设为 **Secret**。每日补投沿用项目已有的 `CRON_SECRET`，也可以用 `openssl rand -hex 32` 生成新值。保存变量后，下一次部署读取新值。

反馈保存后，应用立即把反馈 ID 放入 Vercel Queues。Vercel 函数用 ID 从数据库读取正文及附件，通过 SMTP 发给固定收件人。对明确的暂时失败，队列安排 1、5、15 分钟的三次重试。同一个反馈由数据库原子领取，避免队列重复投递时重复发信。

Vercel Cron 每天在生产部署补投长期滞留在 `pending` 的记录，例如数据库保存成功、队列接口暂时不可用的情况。日常发信在提交后触发。预览环境可以单独测试提交与队列发信。

启用后，用一条自己提交的带图反馈确认实际收件和附件。

| 邮件状态 | 含义 |
| --- | --- |
| `disabled` | 收到反馈时转发未启用，反馈可在数据库查看 |
| `pending` | 等待发送，或在明确的暂时失败后等待重试 |
| `sending` | 发信任务已领取 |
| `sent` | SMTP 服务已接受邮件 |
| `failed` | SMTP 配置不完整、SMTP 明确拒绝，或已用完重试次数 |
| `unknown` | 发信过程异常，无法确认 SMTP 是否接受 |

`unknown` 时，可先在邮箱中按反馈 ID 搜索。确认需要补发时，通过受限的数据库管理入口将该记录的 `mailStatus` 改为 `pending`、`mailAttempts` 改为 `0`、`mailNextAttemptAt` 设为当前 UTC 时间，等待每日补投任务处理。关闭转发期间收到的反馈不会自动补发。

## 代理与回退

部署前确认入口代理允许 `POST /api/site-feedback` 的 2.75 MiB 请求，并在代理层按可信来源设置请求频率限制。应用也会按匿名访客限制为每小时 5 条。

将 `FEEDBACK_MAIL_ENABLED` 设为 `false` 并重新部署后，新反馈停止排队。旧部署已接受的队列任务可能继续运行，消息保留时间为一小时。如需撤下反馈入口，再恢复旧应用版本。已保存的反馈可保留在数据库。
