import { Telegraf, Context } from 'telegraf';

export function createMockBot(
  messages: { id: number; text: string }[],
  invoices: { id: number; title: string }[] = [],
) {
  const bot = new Telegraf<Context>('test');
  (bot as any).botInfo = { id: 0, is_bot: true, username: 'test' };
  bot.telegram.getMe = () => Promise.resolve((bot as any).botInfo);
  let msgId = 0;
  bot.telegram.callApi = (method: string, data: any) => {
    if (method === 'sendMessage') {
      messages.push({ id: data.chat_id, text: data.text });
      return Promise.resolve({ message_id: ++msgId } as any);
    }
    if (method === 'sendInvoice') {
      invoices.push({ id: data.chat_id, title: data.title });
      return Promise.resolve({} as any);
    }
    return Promise.resolve(true as any);
  };
  return bot;
}

export async function sendUpdate(bot: Telegraf<Context>, update: any) {
  const ctx = new Context(update, bot.telegram, (bot as any).botInfo);
  Object.assign(ctx, bot.context);
  await bot.middleware()(ctx, () => Promise.resolve());
}
