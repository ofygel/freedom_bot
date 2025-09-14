import { Telegraf, Context } from 'telegraf';
import { updateSetting, getSettings } from '../services/settings.js';
import type { Settings } from '../services/settings.js';
import { getAllUsers } from '../services/users.js';

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
}
