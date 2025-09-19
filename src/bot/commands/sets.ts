import type { BotCommand } from 'telegraf/typings/core/types/typegram';

export const CLIENT_COMMANDS: BotCommand[] = [
  { command: 'start', description: 'Главное меню' },
  { command: 'taxi', description: 'Заказать такси' },
  { command: 'delivery', description: 'Оформить доставку' },
  { command: 'orders', description: 'Мои заказы' },
  { command: 'city', description: 'Сменить город' },
  { command: 'support', description: 'Поддержка' },
  { command: 'role', description: 'Сменить роль' },
];

export const EXECUTOR_COMMANDS: BotCommand[] = [
  { command: 'start', description: 'Главное меню' },
  { command: 'menu', description: 'Показать меню исполнителя' },
  { command: 'city', description: 'Сменить город' },
  { command: 'support', description: 'Связаться с поддержкой' },
];
