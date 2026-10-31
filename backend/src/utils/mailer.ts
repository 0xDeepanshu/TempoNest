import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config/env';
import { logger } from '../config/logger';
import { generateUuid } from './crypto';

export type MailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type SentMail = MailMessage & {
  id: string;
  sentAt: Date;
};

const memoryOutbox: SentMail[] = [];
let transporter: Transporter | null = null;

function getSmtpTransport(): Transporter {
  if (!config.mail.smtp.host) {
    throw new Error('SMTP_HOST is not configured');
  }
  transporter ??= nodemailer.createTransport({
    host: config.mail.smtp.host,
    port: config.mail.smtp.port,
    secure: config.mail.smtp.secure,
    ...(config.mail.smtp.user && config.mail.smtp.password
      ? { auth: { user: config.mail.smtp.user, pass: config.mail.smtp.password } }
      : {}),
  });
  return transporter;
}

async function writeOutboxFile(mail: SentMail): Promise<void> {
  await mkdir(config.mail.outboxDir, { recursive: true });
  const file = path.join(config.mail.outboxDir, `${mail.sentAt.getTime()}-${mail.id}.json`);
  await writeFile(
    file,
    JSON.stringify(
      { to: mail.to, subject: mail.subject, html: mail.html, text: mail.text, sentAt: mail.sentAt },
      null,
      2,
    ),
    'utf8',
  );
}

/**
 * Deliver an e-mail through the configured transport. The body is never written
 * to logs: only the recipient and subject are logged when delivery is disabled.
 */
export async function sendMail(message: MailMessage): Promise<SentMail> {
  const sent: SentMail = { id: generateUuid(), sentAt: new Date(), ...message };

  switch (config.mail.transport) {
    case 'memory':
      memoryOutbox.push(sent);
      break;
    case 'file':
      await writeOutboxFile(sent);
      break;
    case 'log':
      logger.info(
        { to: message.to, subject: message.subject, transport: 'log' },
        'outbound e-mail suppressed because MAIL_TRANSPORT=log',
      );
      break;
    case 'smtp':
      await getSmtpTransport().sendMail({
        from: config.mail.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });
      break;
  }

  return sent;
}

/** Test-only inspection of messages captured by the memory transport. */
export function getMemoryOutbox(): readonly SentMail[] {
  return memoryOutbox;
}

export function clearMemoryOutbox(): void {
  memoryOutbox.length = 0;
}
