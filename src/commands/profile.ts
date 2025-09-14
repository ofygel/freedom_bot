import { Telegraf, Markup, Context } from 'telegraf';
import { getUser } from '../services/users.js';
import { getCourier, upsertCourier } from '../services/couriers.js';
import type { CourierProfile } from '../services/couriers.js';
import { getSettings } from '../services/settings.js';

interface ProfileState {
  step: 'transport' | 'fullname' | 'id_photo' | 'selfie' | 'card';
  data: Partial<CourierProfile>;
}

const states = new Map<number, ProfileState>();

function startWizard(ctx: Context) {
  const uid = ctx.from!.id;
  states.set(uid, { step: 'transport', data: {} });
  ctx.reply('Какой у вас транспорт?');
}

export function startProfileWizard(ctx: Context) {
  startWizard(ctx);
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
    startWizard(ctx);
  });

  bot.on('text', async (ctx) => {
    const uid = ctx.from!.id;
    const state = states.get(uid);
    if (!state) return;
    const text = ctx.message.text.trim();
    switch (state.step) {
      case 'transport':
        state.data.transport = text;
        state.step = 'fullname';
        await ctx.reply('Ваши ФИО?');
        break;
      case 'fullname':
        state.data.fullName = text;
        state.step = 'id_photo';
        await ctx.reply('Отправьте фото удостоверения.');
        break;
      case 'card':
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
        state.data.idPhoto = fileId;
        state.step = 'selfie';
        await ctx.reply('Теперь отправьте селфи.');
        break;
      case 'selfie':
        state.data.selfie = fileId;
        state.step = 'card';
        await ctx.reply('Укажите карту для выплат.');
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
    const caption =
      `Анкета курьера\n` +
      `ФИО: ${profile.fullName}\n` +
      `Транспорт: ${profile.transport}\n` +
      `Карта: ${profile.card}\n` +
      `Статус: ${statusText}`;
    await ctx.editMessageCaption(caption);
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    if (status === 'verified') {
      await ctx.telegram.sendMessage(uid, 'Ваша анкета одобрена!');
      const settings = getSettings();
      if (settings.drivers_channel_id) {
        try {
          const link = await ctx.telegram.exportChatInviteLink(settings.drivers_channel_id);
          await ctx.telegram.sendMessage(uid, `Лента заказов: ${link}`);
        } catch {
          await ctx.telegram.sendMessage(uid, 'Не удалось получить ссылку на канал заказов.');
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
    const verifyMessage = await ctx.telegram.sendPhoto(
      settings.verify_channel_id,
      profile.idPhoto,
      {
        caption: `Анкета курьера\nФИО: ${profile.fullName}\nТранспорт: ${profile.transport}\nКарта: ${profile.card}`,
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
    setTimeout(() => {
      ctx.telegram.deleteMessage(settings.verify_channel_id!, verifyMessage.message_id).catch(() => {});
    }, 2 * 60 * 60 * 1000);
  }
  await ctx.reply(
    'Анкета отправлена на проверку.',
    Markup.keyboard([['Профиль'], ['Поддержка']]).resize()
  );
}
