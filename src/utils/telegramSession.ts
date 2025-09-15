import type { Telegram } from 'telegraf';

export type TelegramSessionApi = Pick<Telegram, 'deleteWebhook' | 'close'>;

export type Logger = Pick<Console, 'warn' | 'error'>;

export async function resetTelegramSession(
  telegram: TelegramSessionApi,
  logger: Logger = console,
): Promise<boolean> {
  let resetPerformed = false;

  try {
    await telegram.deleteWebhook({ drop_pending_updates: true });
    logger.warn('Deleted previous Telegram webhook via Telegram API.');
    resetPerformed = true;
  } catch (deleteError) {
    logger.warn('Failed to delete previous Telegram webhook via Telegram API.', deleteError);
  }

  try {
    await telegram.close();
    logger.warn('Closed previous Telegram session via Telegram API.');
    resetPerformed = true;
  } catch (closeError) {
    logger.warn('Failed to close previous Telegram session with close()', closeError);
  }

  if (!resetPerformed) {
    logger.error('Unable to reset Telegram session; all reset attempts failed.');
  }

  return resetPerformed;
}
