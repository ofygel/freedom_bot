import type {
  InlineKeyboardMarkup,
  LinkPreviewOptions,
  ParseMode,
} from 'telegraf/typings/core/types/typegram';

import { logger } from '../config';
import { mergeInlineKeyboards, buildInlineKeyboard } from './keyboards/common';
import type { BotContext, UiSessionState } from './types';

const HOME_BUTTON_LABEL = '🏠 На главную';

const ensureUiState = (ctx: BotContext): UiSessionState => {
  if (!ctx.session.ui) {
    ctx.session.ui = {
      steps: {},
      homeActions: [],
    } satisfies UiSessionState;
  }

  return ctx.session.ui;
};

const registerHomeAction = (state: UiSessionState, action: string): void => {
  if (!state.homeActions.includes(action)) {
    state.homeActions.push(action);
  }
};

const appendHomeButton = (
  keyboard: InlineKeyboardMarkup | undefined,
  action: string,
  label = HOME_BUTTON_LABEL,
): InlineKeyboardMarkup => {
  const homeKeyboard = buildInlineKeyboard([[{ label, action }]]);
  return mergeInlineKeyboards(keyboard, homeKeyboard) ?? homeKeyboard;
};

export interface UiStepOptions {
  /** Unique identifier used to track the step message. */
  id: string;
  /** Text displayed in the step message. */
  text: string;
  /** Optional keyboard shown alongside the message. */
  keyboard?: InlineKeyboardMarkup;
  /** Parse mode used when sending the message. */
  parseMode?: ParseMode;
  /** Link preview behaviour configuration. */
  linkPreviewOptions?: LinkPreviewOptions;
  /**
   * Action triggered when the user presses the automatically added
   * «На главную» button. When omitted, the button is not rendered.
   */
  homeAction?: string;
  /** Custom label for the «На главную» button. */
  homeLabel?: string;
  /** Whether the step should be removed when navigating home. */
  cleanup?: boolean;
}

export interface UiStepResult {
  /** Identifier of the Telegram message associated with the step. */
  messageId: number;
  /** Indicates whether a brand new message was sent. */
  sent: boolean;
}

export const ui = {
  step: async (ctx: BotContext, options: UiStepOptions): Promise<UiStepResult | undefined> => {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      return undefined;
    }

    const state = ensureUiState(ctx);
    const cleanup = options.cleanup ?? Boolean(options.homeAction);

    let replyMarkup = options.keyboard;
    if (options.homeAction) {
      registerHomeAction(state, options.homeAction);
      replyMarkup = appendHomeButton(replyMarkup, options.homeAction, options.homeLabel);
    }

    const existing = state.steps[options.id];
    if (existing && existing.chatId === chatId) {
      try {
        await ctx.telegram.editMessageText(chatId, existing.messageId, undefined, options.text, {
          parse_mode: options.parseMode,
          reply_markup: replyMarkup,
          link_preview_options: options.linkPreviewOptions,
        });
        existing.cleanup = cleanup;
        return { messageId: existing.messageId, sent: false };
      } catch (error) {
        logger.debug(
          { err: error, chatId, messageId: existing.messageId, stepId: options.id },
          'Failed to edit step message, sending a new one',
        );
      }
    }

    const message = await ctx.reply(options.text, {
      reply_markup: replyMarkup,
      parse_mode: options.parseMode,
      link_preview_options: options.linkPreviewOptions,
    });

    const messageId = message.message_id;
    state.steps[options.id] = { chatId, messageId, cleanup };
    return { messageId, sent: true };
  },
};
