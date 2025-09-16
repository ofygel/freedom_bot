import { Telegraf, Telegram } from 'telegraf';

import { logger } from '../../config';

import type { BotContext } from '../types';
import {
  createModerationQueue,
  type ModerationRejectionContext,
  type ModerationQueue,
  type ModerationQueueItemBase,
  type PublishModerationResult,
} from './queue';

const DEFAULT_TITLE = '🛡️ Заявка на верификацию исполнителя';
const DEFAULT_REASONS = [
  'Документы нечитабельны',
  'Данные не совпадают',
  'Не подходит',
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

const normaliseSummary = (value?: string | string[]): string[] => {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
};

export interface VerificationApplicant {
  telegramId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
}

export interface VerificationApplication extends ModerationQueueItemBase<VerificationApplication> {
  applicant: VerificationApplicant;
  /**
   * Optional custom title for the moderation message.
   * When omitted, a default heading is used.
   */
  title?: string;
  /** Additional summary text shown after the applicant details. */
  summary?: string | string[];
  /** Any extra notes or comments appended to the end of the message. */
  notes?: string[];
  /** Number of photos attached to the application. */
  photoCount?: number;
  /** Timestamp when the application was submitted. */
  submittedAt?: Date | number | string;
}

const buildVerificationMessage = (application: VerificationApplication): string => {
  const lines: string[] = [];
  lines.push(application.title?.trim() || DEFAULT_TITLE);
  lines.push('');
  lines.push(`ID заявки: ${application.id}`);
  lines.push(`Telegram ID: ${application.applicant.telegramId}`);

  if (application.applicant.username) {
    lines.push(`Username: @${application.applicant.username}`);
  }

  const fullName = buildFullName(application.applicant.firstName, application.applicant.lastName);
  if (fullName) {
    lines.push(`Имя: ${fullName}`);
  }

  if (application.applicant.phone) {
    lines.push(`Телефон: ${application.applicant.phone}`);
  }

  if (application.photoCount !== undefined) {
    lines.push(`Фотографии: ${application.photoCount}`);
  }

  const submittedAt = formatDateTime(application.submittedAt);
  if (submittedAt) {
    lines.push(`Отправлено: ${submittedAt}`);
  }

  const summaryLines = normaliseSummary(application.summary);
  if (summaryLines.length > 0) {
    lines.push('');
    lines.push(...summaryLines);
  }

  if (application.notes && application.notes.length > 0) {
    lines.push('');
    lines.push(...application.notes);
  }

  return lines.join('\n');
};

const normaliseReasonSuffix = (reason: string): string => {
  const trimmed = reason.trim();
  if (!trimmed) {
    return 'не указана.';
  }

  if (/[.!?]$/.test(trimmed)) {
    return trimmed;
  }

  return `${trimmed}.`;
};

const handleVerificationRejection = async (
  context: ModerationRejectionContext<VerificationApplication>,
): Promise<void> => {
  const { item, telegram, reason } = context;
  const applicantId = item.applicant.telegramId;
  if (!applicantId) {
    return;
  }

  const reasonLine = normaliseReasonSuffix(reason);
  const message = [
    '❌ Ваша заявка на верификацию отклонена.',
    `Причина: ${reasonLine}`,
    'Вы можете обновить данные и отправить новую заявку через меню бота.',
  ].join('\n');

  try {
    await telegram.sendMessage(applicantId, message);
  } catch (error) {
    logger.error(
      {
        err: error,
        applicationId: item.id,
        applicantId,
      },
      'Failed to notify applicant about verification rejection',
    );
  }
};

const queue: ModerationQueue<VerificationApplication> = createModerationQueue<VerificationApplication>({
  type: 'verify',
  channelType: 'verify',
  defaultRejectionReasons: DEFAULT_REASONS,
  renderMessage: buildVerificationMessage,
});

export const publishVerificationApplication = async (
  telegram: Telegram,
  application: VerificationApplication,
): Promise<PublishModerationResult> => {
  const existingOnReject = application.onReject;

  const item: VerificationApplication = {
    ...application,
    onReject: async (context) => {
      if (existingOnReject) {
        try {
          await existingOnReject(context);
        } catch (error) {
          logger.error(
            {
              err: error,
              applicationId: application.id,
              applicantId: application.applicant.telegramId,
            },
            'Verification rejection callback failed',
          );
        }
      }

      await handleVerificationRejection(context);
    },
  };

  return queue.publish(telegram, item);
};

export const registerVerificationModerationQueue = (
  bot: Telegraf<BotContext>,
): void => {
  queue.register(bot);
};

export type { PublishModerationResult } from './queue';
