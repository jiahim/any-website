import nodemailer from 'nodemailer';
import { PrismaClient } from '@prisma/client';

const RETRY_MINUTES = [1, 5, 15];
const MAX_PER_RUN = 10;
const CLAIM_TIMEOUT_MS = 10 * 60_000;
const subject = '网站任意门收到一条新反馈';
const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

function settings() {
  const { FEEDBACK_SMTP_HOST: host, FEEDBACK_SMTP_USER: user, FEEDBACK_SMTP_PASSWORD: pass,
    FEEDBACK_MAIL_FROM: from, FEEDBACK_MAIL_TO: to } = process.env;
  const port = Number(process.env.FEEDBACK_SMTP_PORT || '587');
  const security = process.env.FEEDBACK_SMTP_SECURITY || (port === 465 ? 'implicit' : 'starttls');
  const email = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z0-9-]+$/i;
  if (!host?.trim() || !user || !pass || !email.test(from ?? '') || !email.test(to ?? '')
    || !Number.isInteger(port) || port < 1 || port > 65535
    || !['implicit', 'starttls'].includes(security)) {
    throw new Error('检查 FEEDBACK_SMTP_* 和 FEEDBACK_MAIL_FROM / FEEDBACK_MAIL_TO 配置');
  }
  return { host: host.trim(), port, security, user, pass, from, to };
}

function failureStatus(error) {
  if (error?.responseCode >= 400 && error.responseCode < 500) return 'retry';
  if (error?.responseCode >= 500 && error.responseCode < 600) return 'failed';
  if (error?.code === 'EAUTH' || error?.code === 'EENVELOPE') return 'failed';
  // A generic socket error can also occur after DATA has been sent.
  if (error?.code === 'EDNS' || error?.originalCode === 'ECONNREFUSED'
    || ['CONNECT_TIMEOUT', 'GREETING_TIMEOUT', 'UPGRADE_TIMEOUT'].includes(error?.timeoutType)) return 'retry';
  return 'unknown';
}

async function claimNext(prisma) {
  // Prisma stores these timestamps as UTC without a timezone.
  const rows = await prisma.$queryRaw`
    WITH next AS (
      SELECT "id" FROM "site_feedback"
      WHERE "mailStatus" = 'pending' AND "mailAttempts" < 4
        AND "mailNextAttemptAt" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
      ORDER BY "mailNextAttemptAt", "id"
      LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    UPDATE "site_feedback" AS feedback
    SET "mailStatus" = 'sending', "mailClaimedAt" = CURRENT_TIMESTAMP AT TIME ZONE 'UTC', "mailAttempts" = "mailAttempts" + 1
    FROM next WHERE feedback."id" = next."id"
    RETURNING feedback."id", feedback."message", feedback."createdAt", feedback."mailAttempts",
      feedback."screenshotBytes", feedback."screenshotMimeType"
  `;
  return rows[0];
}

async function send(prisma, transport, config, row) {
  let outcome = 'unknown';
  try {
    const info = await transport.sendMail({
      from: { name: '网站任意门', address: config.from },
      to: { name: '', address: config.to },
      envelope: { from: config.from, to: [config.to] },
      messageId: `<site-feedback-${row.id}@${config.from.split('@')[1]}>`,
      subject,
      text: `提交时间 ${row.createdAt.toISOString()}\n反馈编号 ${row.id}\n\n${row.message}`,
      attachments: row.screenshotBytes ? [{
        filename: `screenshot.${extension[row.screenshotMimeType]}`,
        contentType: row.screenshotMimeType,
        content: Buffer.from(row.screenshotBytes),
      }] : [],
    });
    if (info.accepted.length === 1 && info.accepted[0].toLowerCase() === config.to.toLowerCase()) {
      outcome = 'sent';
    }
  } catch (error) {
    outcome = failureStatus(error);
  }

  const retryMinutes = outcome === 'retry' ? RETRY_MINUTES[row.mailAttempts - 1] : undefined;
  const mailStatus = outcome === 'retry' ? (retryMinutes ? 'pending' : 'failed') : outcome;
  const now = new Date();
  const result = await prisma.siteFeedback.updateMany({
    where: { id: row.id, mailStatus: 'sending', mailAttempts: row.mailAttempts },
    data: {
      mailStatus,
      mailClaimedAt: null,
      mailNextAttemptAt: retryMinutes ? new Date(now.getTime() + retryMinutes * 60_000) : null,
      mailSentAt: mailStatus === 'sent' ? now : null,
    },
  });
  console.log(`[feedback-mail] ${row.id} ${result.count ? mailStatus : 'claim-expired'}`);
}

async function main() {
  if (process.env.FEEDBACK_MAIL_ENABLED !== 'true') {
    console.log('[feedback-mail] 邮箱转发未启用');
    return;
  }
  let config;
  try {
    config = settings();
  } catch (error) {
    console.error(`[feedback-mail] ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const prisma = new PrismaClient();
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.security === 'implicit',
    requireTLS: config.security === 'starttls',
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: 8_000,
    greetingTimeout: 8_000,
    socketTimeout: 15_000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  try {
    // A crashed sender may already have delivered the message. Expired claims need review.
    const expired = await prisma.siteFeedback.updateMany({
      where: { mailStatus: 'sending', mailClaimedAt: { lt: new Date(Date.now() - CLAIM_TIMEOUT_MS) } },
      data: { mailStatus: 'unknown', mailClaimedAt: null, mailNextAttemptAt: null },
    });
    if (expired.count) console.warn(`[feedback-mail] ${expired.count} 条通知需要核对`);
    for (let sent = 0; sent < MAX_PER_RUN; sent += 1) {
      const row = await claimNext(prisma);
      if (!row) break;
      await send(prisma, transport, config, row);
    }
  } catch {
    console.error('[feedback-mail] 数据库操作或任务运行失败');
    process.exitCode = 1;
  } finally {
    transport.close();
    await prisma.$disconnect();
  }
}

await main();
