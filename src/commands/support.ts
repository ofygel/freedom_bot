// @ts-nocheck
import { Telegraf, Markup, Context } from 'telegraf';
import { getOrdersByClient } from '../services/orders';
import { createTicket, updateTicketStatus, getTicket } from '../services/tickets';
import { getSettings } from '../services/settings';

interface SupportState {
  step: 'order' | 'topic' | 'content';
  data: any;
  msgId?: number;
}

const states = new Map<number, SupportState>();

async function sendStepSupport(
  ctx: Context,
  state: SupportState,
  text: string,
  extra?: Parameters<typeof ctx.reply>[1]
) {
  if (state.msgId) {
    await ctx.telegram.deleteMessage(ctx.chat!.id, state.msgId).catch(() => {});
  }
  const msg = await ctx.reply(text, extra);
  state.msgId = msg.message_id;
}

async function startSupportWizard(ctx: Context) {
  const uid = ctx.from!.id;
  const orders = getOrdersByClient(uid);
  if (orders.length === 0) {
    await ctx.reply('У вас нет заказов.');
    return;
  }
  const buttons = orders.map((o) => [`${o.id}`]);
  const msg = await ctx.reply(
    'Выберите номер заказа:',
    Markup.keyboard([...buttons, ['Отмена']]).resize()
  );
  states.set(uid, { step: 'order', data: {}, msgId: msg.message_id });
}

export default function supportCommands(bot: Telegraf) {
  bot.hears('Поддержка', async (ctx) => {
    if (!ctx.from) return;
    await startSupportWizard(ctx);
  });

  bot.hears('Отмена', async (ctx) => {
    const state = states.get(ctx.from!.id);
    if (state?.msgId)
      await ctx.telegram.deleteMessage(ctx.chat!.id, state.msgId).catch(() => {});
    states.delete(ctx.from!.id);
    await ctx.reply('Отменено', Markup.removeKeyboard());
  });

  bot.on('text', async (ctx) => {
    const uid = ctx.from!.id;
    const state = states.get(uid);
    if (!state) return;
    const text = ctx.message.text.trim();
    switch (state.step) {
      case 'order': {
        const orderId = Number(text);
        if (isNaN(orderId)) {
          return ctx.reply('Введите номер заказа.');
        }
        state.data.order_id = orderId;
        state.step = 'topic';
        return sendStepSupport(
          ctx,
          state,
          'Тема проблемы?',
          Markup.keyboard([['Отмена']]).resize()
        );
      }
      case 'topic': {
        state.data.topic = text;
        state.step = 'content';
        return sendStepSupport(
          ctx,
          state,
          'Опишите проблему или отправьте фото.',
          Markup.keyboard([['Отмена']]).resize()
        );
      }
      case 'content': {
        state.data.text = text;
        const ticket = createTicket({
          order_id: state.data.order_id,
          user_id: uid,
          topic: state.data.topic,
          text: state.data.text,
        });
        if (state.msgId)
          await ctx.telegram.deleteMessage(ctx.chat!.id, state.msgId).catch(() => {});
        states.delete(uid);
        await ctx.reply(`Тикет #${ticket.id} создан`, Markup.removeKeyboard());
        const settings = getSettings();
        if (settings.verify_channel_id) {
          await ctx.telegram.sendMessage(
            settings.verify_channel_id,
            `Тикет #${ticket.id} по заказу #${ticket.order_id}\nТема: ${ticket.topic}\nТекст: ${ticket.text ?? ''}`
          );
        }
        return;
      }
    }
  });

  bot.on('photo', async (ctx) => {
    const uid = ctx.from!.id;
    const state = states.get(uid);
    if (!state || state.step !== 'content') return;
    const photo = ctx.message.photo?.[0];
    if (!photo) return;
    state.data.photo = photo.file_id;
    const ticket = createTicket({
      order_id: state.data.order_id,
      user_id: uid,
      topic: state.data.topic,
      photo: state.data.photo,
    });
    if (state.msgId)
      await ctx.telegram.deleteMessage(ctx.chat!.id, state.msgId).catch(() => {});
    states.delete(uid);
    await ctx.reply(`Тикет #${ticket.id} создан`, Markup.removeKeyboard());
    const settings = getSettings();
    if (settings.verify_channel_id) {
      await ctx.telegram.sendPhoto(
        settings.verify_channel_id,
        photo.file_id,
        { caption: `Тикет #${ticket.id} по заказу #${ticket.order_id}\nТема: ${ticket.topic}` }
      );
    }
  });

  bot.command('ticket_status', async (ctx) => {
    const parts = ctx.message.text.split(' ');
    if (parts.length < 3) {
      return ctx.reply('Usage: /ticket_status <id> <open|in_progress|resolved> [reply]');
    }
    const id = Number(parts[1]);
    const status = parts[2] as any;
    const reply = parts.slice(3).join(' ');
    const ticket = updateTicketStatus(id, status, reply);
    if (!ticket) return ctx.reply('Ticket not found');
    await ctx.reply('Статус обновлён');
    await ctx.telegram.sendMessage(
      ticket.user_id,
      `Тикет #${ticket.id}: статус ${ticket.status}` + (ticket.reply ? `\nОтвет: ${ticket.reply}` : '')
    );
  });

  bot.command('ticket_reply', async (ctx) => {
    const parts = ctx.message.text.split(' ');
    if (parts.length < 3) {
      return ctx.reply('Usage: /ticket_reply <id> <text>');
    }
    const id = Number(parts[1]);
    const text = parts.slice(2).join(' ');
    const ticket = updateTicketStatus(id, 'in_progress', text);
    if (!ticket) return ctx.reply('Ticket not found');
    await ctx.reply('Ответ отправлен');
    await ctx.telegram.sendMessage(ticket.user_id, `Тикет #${ticket.id}: ${text}`);
  });

  bot.command('ticket', (ctx) => {
    const parts = ctx.message.text.split(' ');
    if (parts.length < 2) {
      return ctx.reply('Usage: /ticket <id>');
    }
    const id = Number(parts[1]);
    const ticket = getTicket(id);
    if (!ticket || ticket.user_id !== ctx.from!.id) {
      return ctx.reply('Тикет не найден');
    }
    ctx.reply(
      `Статус: ${ticket.status}` + (ticket.reply ? `\nОтвет: ${ticket.reply}` : '')
    );
  });
}
