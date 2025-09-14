// @ts-nocheck
import { Telegraf, Context } from 'telegraf';
import { updateSetting, getSettings } from '../services/settings';
import type { Settings } from '../services/settings';
import { getAllUsers } from '../services/users';
import {
  warnUser,
  suspendUser,
  banUser,
  unbanUser,
  resolveDispute,
  getModerationInfo,
} from '../services/moderation';
import { getCourierMetrics } from '../services/couriers';
import { addDisputeMessage, resolveDispute } from '../services/orders';

function isAdmin(ctx: Context): boolean {
  const adminId = Number(process.env.ADMIN_ID);
  return ctx.from?.id === adminId;
}

function ensureAdmin(ctx: Context): boolean {
  if (!isAdmin(ctx)) {
    ctx.reply('Доступ запрещён');
    return false;
  }
  return true;
}

function setNumber(ctx: Context, key: keyof Settings) {
  if (!ensureAdmin(ctx)) return;
  const parts = ((ctx.message as any)?.text ?? '').split(' ');
  const value = Number(parts[1]);
  if (isNaN(value)) {
    ctx.reply('Введите число');
    return;
  }
  updateSetting(key, value);
  ctx.reply(`${key} = ${value}`);
}

export default function adminCommands(bot: Telegraf) {
  bot.command('set_base', (ctx) => setNumber(ctx, 'base_price'));
  bot.command('set_per_km', (ctx) => setNumber(ctx, 'per_km'));
  bot.command('set_min', (ctx) => setNumber(ctx, 'min_price'));
  bot.command('set_wait_free', (ctx) => setNumber(ctx, 'wait_free'));
  bot.command('set_wait_per_min', (ctx) => setNumber(ctx, 'wait_per_min'));
  bot.command('set_surcharge_S', (ctx) => setNumber(ctx, 'surcharge_S'));
  bot.command('set_surcharge_M', (ctx) => setNumber(ctx, 'surcharge_M'));
  bot.command('set_surcharge_L', (ctx) => setNumber(ctx, 'surcharge_L'));

  bot.command('set_order_hours', (ctx) => {
    if (!ensureAdmin(ctx)) return;
    const parts = ((ctx.message as any)?.text ?? '').split(' ');
    const start = Number(parts[1]);
    const end = Number(parts[2]);
    if (isNaN(start) || isNaN(end)) {
      ctx.reply('Используйте: /set_order_hours START END');
      return;
    }
    updateSetting('order_hours_start', start);
    updateSetting('order_hours_end', end);
    ctx.reply(`order_hours = ${start}-${end}`);
  });

  bot.command('toggle_night', (ctx) => {
    if (!ensureAdmin(ctx)) return;
    const settings = getSettings();
    const active = !settings.night_active;
    updateSetting('night_active', active);
    ctx.reply(`night_active = ${active}`);
  });

  bot.command('set_city_polygon', (ctx) => {
    if (!ensureAdmin(ctx)) return;
    const raw = ((ctx.message as any)?.text ?? '').split(' ').slice(1).join(' ');
    const points = raw
      .split(';')
      .map((p: string) => {
        const [latStr, lonStr] = p.split(',');
        const lat = Number(latStr);
        const lon = Number(lonStr);
        return { lat, lon };
      })
      .filter((p: { lat: number; lon: number }) => !isNaN(p.lat) && !isNaN(p.lon));
    if (points.length < 3) {
      ctx.reply('Нужно минимум 3 точки lat,lon;lat,lon;...');
      return;
    }
    updateSetting('city_polygon', points);
    ctx.reply('Полигон сохранён');
  });

  bot.command('broadcast', async (ctx) => {
    if (!ensureAdmin(ctx)) return;
    const msg = ((ctx.message as any)?.text ?? '').split(' ').slice(1).join(' ');
    if (!msg) {
      ctx.reply('Текст не указан');
      return;
    }
    const users = getAllUsers();
    for (const u of users) {
      try {
        await ctx.telegram.sendMessage(u.id, msg);
      } catch {}
    }
    ctx.reply('Рассылка отправлена');
  });

  bot.command('warn', async (ctx) => {
    if (!ensureAdmin(ctx)) return;
    const parts = ((ctx.message as any)?.text ?? '').split(' ');
    const id = Number(parts[1]);
    const reason = parts.slice(2).join(' ') || 'Без причины';
    if (!id) return ctx.reply('Укажите ID пользователя');
    warnUser(id);
    try {
      await ctx.telegram.sendMessage(id, `Предупреждение: ${reason}`);
    } catch {}
    ctx.reply('Предупреждение отправлено');
  });

  bot.command('suspend', async (ctx) => {
    if (!ensureAdmin(ctx)) return;
    const parts = ((ctx.message as any)?.text ?? '').split(' ');
    const id = Number(parts[1]);
    if (!id) return ctx.reply('Укажите ID пользователя');
    suspendUser(id);
    try {
      await ctx.telegram.sendMessage(id, 'Ваш аккаунт временно приостановлен');
    } catch {}
    ctx.reply('Пользователь приостановлен');
  });

  bot.command('ban', async (ctx) => {
    if (!ensureAdmin(ctx)) return;
    const parts = ((ctx.message as any)?.text ?? '').split(' ');
    const id = Number(parts[1]);
    if (!id) return ctx.reply('Укажите ID пользователя');
    banUser(id);
    try {
      await ctx.telegram.sendMessage(id, 'Вы заблокированы');
    } catch {}
    ctx.reply('Пользователь заблокирован');
  });

  bot.command('unban', async (ctx) => {
    if (!ensureAdmin(ctx)) return;
    const parts = ((ctx.message as any)?.text ?? '').split(' ');
    const id = Number(parts[1]);
    if (!id) return ctx.reply('Укажите ID пользователя');
    unbanUser(id);
    try {
      await ctx.telegram.sendMessage(id, 'Доступ восстановлен');
    } catch {}
    ctx.reply('Пользователь разблокирован');
  });

  bot.command('resolve_dispute', (ctx) => {
    if (!ensureAdmin(ctx)) return;
    const parts = ((ctx.message as any)?.text ?? '').split(' ');
    const orderId = Number(parts[1]);
    const resolution = parts.slice(2).join(' ');
    if (!orderId || !resolution) return ctx.reply('Использование: /resolve_dispute <orderId> <resolution>');
    resolveDispute(orderId, resolution);
    ctx.reply('Спор закрыт');
  });

  bot.command('metrics', (ctx) => {
    if (!ensureAdmin(ctx)) return;
    const parts = ((ctx.message as any)?.text ?? '').split(' ');
    const id = Number(parts[1]);
    if (!id) return ctx.reply('Укажите ID курьера');
    const metrics = getCourierMetrics(id);
    if (!metrics) return ctx.reply('Данные не найдены');
    ctx.reply(
      `cancel_rate: ${metrics.cancel_rate.toFixed(2)}\n` +
        `completed_count: ${metrics.completed_count}\n` +
        `reserve_count: ${metrics.reserve_count}`
    );
  });

  bot.command('dispute_reply', async (ctx) => {
    if (!ensureAdmin(ctx)) return;
    const parts = ((ctx.message as any)?.text ?? '').split(' ');
    if (parts.length < 3) {
      return ctx.reply('Usage: /dispute_reply <id> <text>');
    }
    const id = Number(parts[1]);
    const text = parts.slice(2).join(' ');
    const order = addDisputeMessage(id, 'moderator', text);
    if (!order) return ctx.reply('Order not found or no dispute');
    await ctx.reply('Ответ отправлен');
    try {
      await ctx.telegram.sendMessage(
        order.courier_id!,
        `Ответ по спору заказа #${order.id}: ${text}`
      );
    } catch {}
    try {
      await ctx.telegram.sendMessage(
        order.client_id,
        `Ответ по спору заказа #${order.id}: ${text}`
      );
    } catch {}
  });

  bot.command('dispute_close', async (ctx) => {
    if (!ensureAdmin(ctx)) return;
    const parts = ((ctx.message as any)?.text ?? '').split(' ');
    const id = Number(parts[1]);
    if (!id) {
      return ctx.reply('Usage: /dispute_close <id>');
    }
    const order = resolveDispute(id);
    if (!order) return ctx.reply('Order not found');
    await ctx.reply('Спор закрыт');
    try {
      await ctx.telegram.sendMessage(
        order.courier_id!,
        `Спор по заказу #${order.id} закрыт`
      );
    } catch {}
    try {
      await ctx.telegram.sendMessage(
        order.client_id,
        `Спор по заказу #${order.id} закрыт`
      );
    } catch {}
  });
}
