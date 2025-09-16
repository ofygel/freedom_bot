import type { BotContext, ExecutorFlowState } from '../types';
import { EXECUTOR_VERIFICATION_PHOTO_COUNT } from '../types';

import { getExecutorRoleCopy } from '../flows/executor/roleCopy';

import { MINUTE, remainingTime } from '../../utils/time';

const DEFAULT_COOLDOWN_MS = 10 * MINUTE;

export interface VerificationPromptOptions {
  requiredPhotos?: number;
}

export const buildVerificationPrompt = (
  options: VerificationPromptOptions = {},
): string => {
  const required = Math.max(1, options.requiredPhotos ?? EXECUTOR_VERIFICATION_PHOTO_COUNT);
  const lines = [
    'Для доступа к заказам пришлите фотографии документов:',
    '1. Удостоверение личности — лицевая сторона.',
    '2. Удостоверение личности — обратная сторона.',
    '3. Селфи с удостоверением в руках.',
  ];

  if (required > 3) {
    lines.push(`Дополнительно требуется всего фотографий: ${required}.`);
  }

  lines.push('', 'Отправляйте фотографии по одному сообщению в этот чат.');
  return lines.join('\n');
};

export interface VerificationSummaryOptions {
  photoCount?: number;
}

export const buildVerificationSummary = (
  ctx: BotContext,
  state: ExecutorFlowState,
  options: VerificationSummaryOptions = {},
): string => {
  const applicant = ctx.session.user;
  const copy = getExecutorRoleCopy(state.role);
  const lines = [
    `🆕 Новая заявка на верификацию ${copy.genitive}.`,
    `Telegram ID: ${ctx.from?.id ?? 'неизвестно'}`,
  ];

  if (applicant?.username) {
    lines.push(`Username: @${applicant.username}`);
  }

  const fullName = [applicant?.firstName, applicant?.lastName]
    .filter((part) => Boolean(part && part.trim().length > 0))
    .join(' ')
    .trim();

  if (fullName) {
    lines.push(`Имя: ${fullName}`);
  }

  if (ctx.session.phoneNumber) {
    lines.push(`Телефон: ${ctx.session.phoneNumber}`);
  }

  const uploaded = options.photoCount ?? state.verification.uploadedPhotos.length;
  lines.push(`Фотографии: ${uploaded}/${state.verification.requiredPhotos}.`);

  if (state.verification.submittedAt) {
    lines.push(`Отправлено: ${new Date(state.verification.submittedAt).toLocaleString('ru-RU')}`);
  }

  return lines.join('\n');
};

export const remainingVerificationCooldown = (
  state: ExecutorFlowState,
  now = Date.now(),
  cooldownMs = DEFAULT_COOLDOWN_MS,
): number => {
  if (!state.verification.submittedAt) {
    return 0;
  }

  const until = state.verification.submittedAt + cooldownMs;
  return Math.max(0, remainingTime(until, now) ?? 0);
};

export const shouldThrottleVerification = (
  state: ExecutorFlowState,
  now = Date.now(),
  cooldownMs = DEFAULT_COOLDOWN_MS,
): boolean => remainingVerificationCooldown(state, now, cooldownMs) > 0;
