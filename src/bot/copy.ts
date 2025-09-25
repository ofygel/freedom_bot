export const copy = {
  nudge: 'Что дальше? Выберите действие ниже.',
  expiredButton: 'Кнопка устарела — отправляю актуальное меню…',
  tooFrequent: 'Слишком часто. Попробуйте через секунду.',
  waiting: 'Принял. Обрабатываю…',
  back: '⬅ Назад',
  refresh: '🔄 Обновить',
  resume: '🔄 Продолжить',
  home: '🏠 Главное меню',
  errorRecovered: 'Произошёл сбой, но я вернул вас к последнему шагу.',
  errorGeneric: 'Произошёл сбой. Попробуйте повторить действие чуть позже.',
  invalidPhone: (example = '+7 777 123-45-67') => `Уточните телефон в формате E.164 (пример: ${example}).`,
  statusLine: (emoji: string, text: string) => `${emoji} ${text}`,
  clientMiniStatus: (cityLabel?: string, trialDaysLeft?: number) =>
    [
      cityLabel ? `🏙️ Город: ${cityLabel}` : null,
      (trialDaysLeft ?? 0) > 0 ? `🧪 Пробный: осталось ${trialDaysLeft} дн.` : null,
    ].filter(Boolean).join('\n'),
  executorMiniStatus: (
    cityLabel: string | undefined,
    docs: { uploaded: number; required: number },
    trialDaysLeft?: number,
  ) =>
    [
      cityLabel ? `🏙️ Город: ${cityLabel}` : null,
      (trialDaysLeft ?? 0) > 0 ? `🧪 Пробный: осталось ${trialDaysLeft} дн.` : null,
      `🛡️ Документы: ${docs.uploaded}/${docs.required}`,
    ].filter(Boolean).join('\n'),
  orderChannelCard: (kind: 'taxi' | 'delivery', price: string, city: string) =>
    `Новый заказ • ${kind === 'taxi' ? '🚕 Такси' : '📦 Доставка'}\n${city} • ${price}`,
  orderAcceptedToast: 'Заказ закреплён за вами.',
  orderAlreadyTakenToast: 'Увы, заказ уже принят другим исполнителем.',
  orderReleasedToast: 'Вы сняты с заказа.',
  noAccess: 'Недостаточно прав для действия.',
};
