export interface SubscriptionPeriodOption {
  id: string;
  /** Human-readable label describing the duration. */
  label: string;
  /** Number of days covered by the payment. */
  days: number;
  /** Subscription price in Kazakhstani tenge. */
  amount: number;
  /** Currency code used for the payment. */
  currency: string;
}

export const SUBSCRIPTION_PERIOD_OPTIONS: readonly SubscriptionPeriodOption[] = [
  {
    id: '7',
    label: '7 дней',
    days: 7,
    amount: 5000,
    currency: 'KZT',
  },
  {
    id: '15',
    label: '15 дней',
    days: 15,
    amount: 9000,
    currency: 'KZT',
  },
  {
    id: '30',
    label: '30 дней',
    days: 30,
    amount: 16000,
    currency: 'KZT',
  },
] as const;

export const findSubscriptionPeriodOption = (
  id: string | undefined,
): SubscriptionPeriodOption | undefined =>
  SUBSCRIPTION_PERIOD_OPTIONS.find((option) => option.id === id);

export const formatSubscriptionAmount = (
  amount: number,
  currency: string,
): string =>
  `${new Intl.NumberFormat('ru-RU').format(amount)} ${currency}`;
