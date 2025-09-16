import { Telegraf, Telegram } from 'telegraf';

import type { BotContext } from '../types';
import {
  createModerationQueue,
  type ModerationQueue,
  type ModerationQueueItemBase,
  type PublishModerationResult,
} from './queue';

const DEFAULT_TITLE = '💳 Проверка платежа по подписке';
const DEFAULT_REASONS = [
  'Нет подтверждения оплаты',
  'Сумма не совпадает',
  'Недостаточно данных',
];

const formatDateTime = (value?: Date | number | string): string | undefined => {
  if (!value) {
    return undefined;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
};

const buildFullName = (first?: string, last?: string): string | undefined => {
  const full = [first?.trim(), last?.trim()].filter(Boolean).join(' ').trim();
  return full || undefined;
};

const normaliseLines = (value?: string | string[]): string[] => {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
};

const formatAmount = (amount: number, currency: string): string =>
  `${new Intl.NumberFormat('ru-RU').format(amount)} ${currency}`;

export interface PaymentPayer {
  telegramId?: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
}

export interface PaymentReviewItem extends ModerationQueueItemBase<PaymentReviewItem> {
  /** Identifier of the payment under review. */
  id: string | number;
  /** Identifier of the related subscription, if any. */
  subscriptionId?: string;
  /** Amount of the payment. */
  amount: { value: number; currency: string };
  /** Payer details used for the moderation summary. */
  payer?: PaymentPayer;
  /** Optional custom title for the moderation message. */
  title?: string;
  /** Additional description of the payment. */
  description?: string;
  /** Link to the invoice or receipt. */
  invoiceUrl?: string;
  /** Time when the payment was made. */
  paidAt?: Date | number | string;
  /** Billing period covered by the payment. */
  period?: { start?: Date | number | string; end?: Date | number | string };
  /** Additional free-form lines appended at the end of the message. */
  notes?: string[];
  /** Optional summary text inserted before the notes. */
  summary?: string | string[];
}

const buildPayerSection = (payer?: PaymentPayer): string[] => {
  if (!payer) {
    return [];
  }

  const lines: string[] = [];
  const fullName = buildFullName(payer.firstName, payer.lastName);
  if (fullName) {
    lines.push(`Плательщик: ${fullName}`);
  }

  if (payer.username) {
    lines.push(`Username: @${payer.username}`);
  }

  if (payer.telegramId !== undefined) {
    lines.push(`Telegram ID: ${payer.telegramId}`);
  }

  if (payer.phone) {
    lines.push(`Телефон: ${payer.phone}`);
  }

  return lines;
};

const buildPeriodLabel = (period?: PaymentReviewItem['period']): string | undefined => {
  if (!period) {
    return undefined;
  }

  const start = formatDateTime(period.start);
  const end = formatDateTime(period.end);
  if (start && end) {
    return `Период: ${start} — ${end}`;
  }

  if (start) {
    return `Период начинается: ${start}`;
  }

  if (end) {
    return `Период заканчивается: ${end}`;
  }

  return undefined;
};

const buildPaymentMessage = (payment: PaymentReviewItem): string => {
  const lines: string[] = [];
  lines.push(payment.title?.trim() || DEFAULT_TITLE);
  lines.push('');
  lines.push(`ID платежа: ${payment.id}`);

  if (payment.subscriptionId) {
    lines.push(`Подписка: ${payment.subscriptionId}`);
  }

  const amountLabel = formatAmount(payment.amount.value, payment.amount.currency);
  lines.push(`Сумма: ${amountLabel}`);

  const paidAt = formatDateTime(payment.paidAt);
  if (paidAt) {
    lines.push(`Оплачен: ${paidAt}`);
  }

  const periodLabel = buildPeriodLabel(payment.period);
  if (periodLabel) {
    lines.push(periodLabel);
  }

  const payerLines = buildPayerSection(payment.payer);
  if (payerLines.length > 0) {
    lines.push('');
    lines.push(...payerLines);
  }

  if (payment.description) {
    lines.push('');
    lines.push(payment.description);
  }

  if (payment.invoiceUrl) {
    lines.push('');
    lines.push(`Квитанция: ${payment.invoiceUrl}`);
  }

  const summaryLines = normaliseLines(payment.summary);
  if (summaryLines.length > 0) {
    lines.push('');
    lines.push(...summaryLines);
  }

  if (payment.notes && payment.notes.length > 0) {
    lines.push('');
    lines.push(...payment.notes);
  }

  return lines.join('\n');
};

const queue: ModerationQueue<PaymentReviewItem> = createModerationQueue<PaymentReviewItem>({
  type: 'payment',
  channelType: 'moderation',
  defaultRejectionReasons: DEFAULT_REASONS,
  renderMessage: buildPaymentMessage,
});

export const publishPaymentReview = async (
  telegram: Telegram,
  payment: PaymentReviewItem,
): Promise<PublishModerationResult> => queue.publish(telegram, payment);

export const registerPaymentModerationQueue = (bot: Telegraf<BotContext>): void => {
  queue.register(bot);
};

export type { PublishModerationResult } from './queue';
