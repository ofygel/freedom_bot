import { Telegraf, Markup, Context } from 'telegraf';
import { getUser } from '../services/users';
import {
  getCourier,
  upsertCourier,
  scheduleCardMessageDeletion,
  getCourierMetrics,
} from '../services/couriers';
import type { CourierProfile } from '../services/couriers';
import { getSettings } from '../services/settings';

interface ProfileState {
  step: 'transport' | 'fullname' | 'id_photo' | 'selfie' | 'card';
  data: Partial<CourierProfile>;
  msgId?: number;
}

const states = new Map<number, ProfileState>();

async function startWizard(ctx: Context) {
  const uid = ctx.from!.id;
  const msg = await ctx.reply('Какой у вас транспорт?');
  states.set(uid, { step: 'transport', data: {}, msgId: msg.message_id });
}

export async function startProfileWizard(ctx: Context) {
  await startWizard(ctx);
}

export default function profileCommands(bot: Telegraf) {
  bot.hears('Профиль', async (ctx) => {
    const uid = ctx.from!.id;
    const user = getUser(uid);
    if (!user || user.role !== 'courier') {
      await ctx.reply('Команда доступна только курьерам.');
      return;
    }
    const profile = getCourier(uid);
    if (profile?.status === 'pending') {
      await ctx.reply('Ваша анкета уже на проверке.');
      return;
    }
    if (profile?.status === 'verified') {
      await ctx.reply('Вы уже прошли верификацию.');
      return;
    }
    await startWizard(ctx);
  });

  bot.on('text', async (ctx) => {
    const uid = ctx.from!.id;
    const state = states.get(uid);
    if (!state) return;
    const text = ctx.message.text.trim();
    switch (state.step) {
      case 'transport':
        if (state.msgId)
          await ctx.telegram.deleteMessage(ctx.chat!.id, state.msgId).catch(() => {});
        state.data.transport = text;
        state.step = 'fullname';
        {
          const msg = await ctx.reply('Ваши ФИО?');
          state.msgId = msg.message_id;
        }
        break;
      case 'fullname':
        if (state.msgId)
          await ctx.telegram.deleteMessage(ctx.chat!.id, state.msgId).catch(() => {});
        state.data.fullName = text;
        state.step = 'id_photo';
        {
          const msg = await ctx.reply('Отправьте фото удостоверения.');
          state.msgId = msg.message_id;
        }
        break;
      case 'card':
        if (state.msgId)
          await ctx.telegram.deleteMessage(ctx.chat!.id, state.msgId).catch(() => {});
        state.data.card = text;
        await finalize(ctx, uid, state.data as Required<CourierProfile>);
        states.delete(uid);
        break;
      default:
        await ctx.reply('Пожалуйста, следуйте инструкциям.');
    }
  });

  bot.on('photo', async (ctx) => {
    const uid = ctx.from!.id;
    const state = states.get(uid);
    if (!state) return;
    const photos = ctx.message.photo!;
    const fileId = photos[photos.length - 1]!.file_id;
    switch (state.step) {
      case 'id_photo':
        if (state.msgId)
          await ctx.telegram.deleteMessage(ctx.chat!.id, state.msgId).catch(() => {});
        state.data.idPhoto = fileId;
        state.step = 'selfie';
        {
          const msg = await ctx.reply('Теперь отправьте селфи.');
          state.msgId = msg.message_id;
        }
        break;
      case 'selfie':
        if (state.msgId)
          await ctx.telegram.deleteMessage(ctx.chat!.id, state.msgId).catch(() => {});
        state.data.selfie = fileId;
        state.step = 'card';
        {
          const msg = await ctx.reply('Укажите карту для выплат.');
          state.msgId = msg.message_id;
        }
        break;
      default:
        await ctx.reply('Пожалуйста, отправьте текст.');
    }
  });

  bot.on('callback_query', async (ctx) => {
    const data = (ctx.callbackQuery as any).data;
    if (typeof data !== 'string' || !data.startsWith('verify:')) return;
    const [, uidStr, action] = data.split(':');
    const uid = parseInt(uidStr!, 10);
    const profile = getCourier(uid);
    if (!profile) {
      await ctx.answerCbQuery('Профиль не найден');
      return;
    }
    let status: CourierProfile['status'];
    let statusText = '';
    switch (action) {
      case 'accept':
        status = 'verified';
        statusText = '✅ Принят';
        break;
      case 'reject':
        status = 'rejected';
        statusText = '❌ Отклонён';
        break;
      default:
        status = 'repeat';
        statusText = '🔄 Повтор';
        break;
    }
    upsertCourier({ ...profile, status });
    const metrics = getCourierMetrics(uid);
    const metricsText = metrics
      ? `cancel_rate: ${metrics.cancel_rate.toFixed(2)}\nreserve_count: ${metrics.reserve_count}\n`
      : '';
    const caption =
      `Анкета курьера\n` +
      `ФИО: ${profile.fullName}\n` +
      `Транспорт: ${profile.transport}\n` +
      `Карта: ${profile.card}\n` +
      metricsText +
      `Статус: ${statusText}`;
    await ctx.editMessageCaption(caption);
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    if (status === 'verified') {
      await ctx.telegram.sendMessage(
        uid,
        'Ваша анкета одобрена!',
        Markup.keyboard([
          ['Онлайн/Оффлайн'],
          ['Лента заказов'],
          ['Мои заказы'],
          ['Баланс/Выплаты'],
          ['Профиль'],
          ['Поддержка'],
        ]).resize()
      );
      const settings = getSettings();
      if (settings.drivers_channel_id) {
        try {
          const link = await ctx.telegram.exportChatInviteLink(settings.drivers_channel_id);
          await ctx.telegram.sendMessage(uid, `Лента заказов: ${link}`);
        } catch {
          await ctx.telegram.sendMessage(
            uid,
            'Не удалось получить ссылку на канал заказов.'
          );
        }
      }
    } else if (status === 'rejected') {
      await ctx.telegram.sendMessage(uid, 'Анкета отклонена.');
    } else {
      await ctx.telegram.sendMessage(uid, 'Пожалуйста, отправьте анкету заново через команду «Профиль».');
    }
    await ctx.answerCbQuery('Готово');
  });
}

async function finalize(ctx: Context, uid: number, data: Required<CourierProfile>) {
  const profile: CourierProfile = { ...data, id: uid, status: 'pending' };
  upsertCourier(profile);
  const settings = getSettings();
  if (settings.verify_channel_id) {
    const metrics = getCourierMetrics(uid);
    const metricsText = metrics
      ? `\ncancel_rate: ${metrics.cancel_rate.toFixed(2)}\nreserve_count: ${metrics.reserve_count}`
      : '';
    const verifyMessage = await ctx.telegram.sendPhoto(
      settings.verify_channel_id,
      profile.idPhoto,
      {
        caption:
          `Анкета курьера\nФИО: ${profile.fullName}\nТранспорт: ${profile.transport}\nКарта: ${profile.card}${metricsText}`,
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'Принять', callback_data: `verify:${uid}:accept` },
              { text: 'Отклонить', callback_data: `verify:${uid}:reject` },
              { text: 'Повтор', callback_data: `verify:${uid}:repeat` }
            ]
          ]
        }
      }
    );
    await ctx.telegram.sendPhoto(settings.verify_channel_id, profile.selfie);
    upsertCourier({ ...profile, verifyMsgId: verifyMessage.message_id });
    scheduleCardMessageDeletion(
      ctx.telegram,
      Number(settings.verify_channel_id!),
      verifyMessage.message_id,
    );
  }
  await ctx.reply(
    'Анкета отправлена на проверку.',
    Markup.keyboard([['Профиль'], ['Поддержка']]).resize()
  );
}
