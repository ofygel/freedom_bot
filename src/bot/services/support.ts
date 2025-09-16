import { Markup } from 'telegraf';
import type { InlineKeyboardMarkup } from 'telegraf/typings/core/types/typegram';

export interface SupportContact {
  type: 'phone' | 'email' | 'telegram' | 'link';
  value: string;
  label?: string;
  description?: string;
  url?: string;
}

export interface SupportMessageOptions {
  title?: string;
  description?: string | string[];
  contacts?: SupportContact[];
  footer?: string | string[];
}

const normaliseLines = (input?: string | string[]): string[] => {
  if (!input) {
    return [];
  }

  return Array.isArray(input) ? input : [input];
};

const buildContactLine = (contact: SupportContact): string => {
  const label = contact.label?.trim();

  switch (contact.type) {
    case 'phone':
      return `📞 ${label ?? 'Телефон'}: ${contact.value}`;
    case 'email':
      return `✉️ ${label ?? 'Email'}: ${contact.value}`;
    case 'telegram':
      return `💬 ${label ?? 'Telegram'}: ${contact.value.startsWith('@') ? contact.value : `@${contact.value}`}`;
    case 'link':
    default:
      return `${label ?? '🔗 Ссылка'}: ${contact.value}`;
  }
};

export const buildSupportMessage = (options: SupportMessageOptions = {}): string => {
  const lines: string[] = [];

  if (options.title) {
    lines.push(options.title.trim());
  } else {
    lines.push('🆘 Поддержка Freedom Bot');
  }

  const description = normaliseLines(options.description);
  if (description.length > 0) {
    lines.push('');
    lines.push(...description);
  }

  if (options.contacts && options.contacts.length > 0) {
    lines.push('');
    lines.push('Свяжитесь с нами:');
    options.contacts.forEach((contact) => {
      const line = buildContactLine(contact);
      lines.push(line);
      if (contact.description) {
        lines.push(`• ${contact.description.trim()}`);
      }
    });
  }

  const footer = normaliseLines(options.footer);
  if (footer.length > 0) {
    lines.push('');
    lines.push(...footer);
  }

  return lines.join('\n');
};

export const buildSupportKeyboard = (
  contacts: SupportContact[] = [],
): InlineKeyboardMarkup | undefined => {
  const buttons = contacts
    .filter((contact) => Boolean(contact.url))
    .map((contact) => [
      Markup.button.url(contact.label ?? contact.value, contact.url as string),
    ]);

  if (buttons.length === 0) {
    return undefined;
  }

  return Markup.inlineKeyboard(buttons).reply_markup;
};
