import nodemailer from 'nodemailer';
import { prisma } from './prisma.ts';

const RETRY_SECONDS = [60, 300, 900];
export const MAX_FEEDBACK_MAIL_ATTEMPTS = RETRY_SECONDS.length + 1;
const CLAIM_TIMEOUT_MS = 10 * 60_000;
const SCREENSHOT_EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

export function feedbackMailEnabled() {
  return process.env.FEEDBACK_MAIL_ENABLED === 'true';
}

function mailSettings() {
  const { FEEDBACK_SMTP_HOST: host, FEEDBACK_SMTP_USER: user, FEEDBACK_SMTP_PASSWORD: pass,
    FEEDBACK_MAIL_FROM: from, FEEDBACK_MAIL_TO: to } = process.env;
  const port = Number(process.env.FEEDBACK_SMTP_PORT || '587');
  const security = process.env.FEEDBACK_SMTP_SECURITY || (port === 465 ? 'implicit' : 'starttls');
  const email = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z0-9-]+$/i;
  if (!host?.trim() || !user || !pass || !from || !to || !email.test(from) || !email.test(to)
    || !Number.isInteger(port) || port < 1 || port > 65535 || port === 25
    || (security !== 'implicit' && security !== 'starttls')) return null;
  return { host: host.trim(), port, security, user, pass, from, to };
}

function smtpErrorFields(error: unknown) {
  if (!error || typeof error !== 'object') return {};
  return error as {
    responseCode?: number; code?: string; originalCode?: string; timeoutType?: string; command?: string;
  };
}

export function smtpFailure(error: unknown): 'retry' | 'failed' | 'unknown' {
  const { responseCode, code, originalCode, timeoutType } = smtpErrorFields(error);
  if (responseCode && responseCode >= 400 && responseCode < 500) return 'retry';
  if (responseCode && responseCode >= 500 && responseCode < 600) return 'failed';
  if (code === 'EAUTH' || code === 'EENVELOPE') return 'failed';
  // Socket errors can also occur after DATA. Only retry when SMTP acceptance is ruled out.
  if (code === 'EDNS' || originalCode === 'ECONNREFUSED' || timeoutType === 'CONNECT_TIMEOUT'
    || timeoutType === 'GREETING_TIMEOUT' || timeoutType === 'UPGRADE_TIMEOUT') return 'retry';
  return 'unknown';
}

function diagnosticCode(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,31}$/.test(value) ? value : undefined;
}

export function smtpFailureDiagnostics(error: unknown) {
  const { responseCode, code, originalCode, timeoutType, command } = smtpErrorFields(error);
  const stage = typeof command === 'string' ? command.split(' ', 1)[0] : '';
  return {
    code: diagnosticCode(code),
    originalCode: diagnosticCode(originalCode),
    responseCode: typeof responseCode === 'number' && Number.isInteger(responseCode)
      && responseCode >= 400 && responseCode < 600 ? responseCode : undefined,
    timeoutType: diagnosticCode(timeoutType),
    stage: /^(CONN|EHLO|HELO|STARTTLS|AUTH|MAIL|RCPT|DATA|API|RSET|QUIT)$/.test(stage) ? stage : undefined,
  };
}

export function feedbackMailRetrySeconds(attempt: number): number | undefined {
  return RETRY_SECONDS[attempt - 1];
}

export async function expireFeedbackMailClaims(id?: string) {
  await prisma.siteFeedback.updateMany({
    where: { id, mailStatus: 'sending', mailClaimedAt: { lte: new Date(Date.now() - CLAIM_TIMEOUT_MS) } },
    data: { mailStatus: 'unknown', mailClaimedAt: null, mailNextAttemptAt: null },
  });
}

export async function sendFeedbackMail(id: string): Promise<number | undefined> {
  if (!feedbackMailEnabled()) return;

  await expireFeedbackMailClaims(id);
  const config = mailSettings();
  if (!config) {
    const result = await prisma.siteFeedback.updateMany({
      where: { id, mailStatus: 'pending' },
      data: { mailStatus: 'failed', mailNextAttemptAt: null },
    });
    if (result.count) console.error('[feedback-mail] Invalid SMTP configuration');
    return;
  }

  const now = new Date();
  const [row] = await prisma.siteFeedback.updateManyAndReturn({
    where: { id, mailStatus: 'pending', mailAttempts: { lt: MAX_FEEDBACK_MAIL_ATTEMPTS }, mailNextAttemptAt: { lte: now } },
    data: { mailStatus: 'sending', mailClaimedAt: now, mailAttempts: { increment: 1 } },
    select: { message: true, createdAt: true, mailAttempts: true, screenshotBytes: true, screenshotMimeType: true },
  });
  if (!row) {
    const state = await prisma.siteFeedback.findUnique({
      where: { id }, select: { mailStatus: true, mailNextAttemptAt: true, mailAttempts: true },
    });
    if (state?.mailStatus === 'sending') return 30;
    if (state?.mailStatus === 'pending' && state.mailNextAttemptAt && state.mailAttempts < MAX_FEEDBACK_MAIL_ATTEMPTS) {
      return Math.max(1, Math.ceil((state.mailNextAttemptAt.getTime() - now.getTime()) / 1000));
    }
    return;
  }

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
  let outcome: 'sent' | ReturnType<typeof smtpFailure> = 'unknown';
  const startedAt = Date.now();
  try {
    const mimeType = row.screenshotMimeType ?? '';
    const extension = SCREENSHOT_EXTENSIONS[mimeType];
    const info = await transport.sendMail({
      from: { name: '网站任意门', address: config.from },
      to: { name: '', address: config.to },
      envelope: { from: config.from, to: [config.to] },
      messageId: `<site-feedback-${id}@${config.from.split('@')[1]}>`,
      subject: '网站任意门收到一条新反馈',
      text: `提交时间 ${row.createdAt.toISOString()}\n反馈编号 ${id}\n\n${row.message}`,
      attachments: row.screenshotBytes && extension ? [{
        filename: `screenshot.${extension}`,
        contentType: mimeType,
        content: Buffer.from(row.screenshotBytes),
      }] : [],
    });
    const [accepted] = info.accepted;
    if (info.accepted.length === 1 && typeof accepted === 'string' && accepted.toLowerCase() === config.to.toLowerCase()) {
      outcome = 'sent';
    }
  } catch (error) {
    outcome = smtpFailure(error);
    console.warn('[feedback-mail] SMTP attempt failed', {
      feedbackId: id,
      attempt: row.mailAttempts,
      outcome,
      durationMs: Date.now() - startedAt,
      ...smtpFailureDiagnostics(error),
    });
  } finally {
    transport.close();
  }

  const delay = outcome === 'retry' ? feedbackMailRetrySeconds(row.mailAttempts) : undefined;
  const mailStatus = outcome === 'retry' ? (delay ? 'pending' : 'failed') : outcome;
  const finishedAt = new Date();
  // Keep persistence separate from SMTP errors. A failed DB write leaves the claim to expire as unknown.
  const result = await prisma.siteFeedback.updateMany({
    where: { id, mailStatus: 'sending', mailAttempts: row.mailAttempts, mailClaimedAt: now },
    data: {
      mailStatus,
      mailClaimedAt: null,
      mailNextAttemptAt: delay ? new Date(finishedAt.getTime() + delay * 1000) : null,
      mailSentAt: mailStatus === 'sent' ? finishedAt : null,
    },
  });
  return result.count ? delay : undefined;
}
