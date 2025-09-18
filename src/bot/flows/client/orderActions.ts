export const CLIENT_ORDERS_ACTION = 'client:orders:list';
export const CLIENT_VIEW_ORDER_ACTION_PREFIX = 'client:orders:view';
export const CLIENT_CANCEL_ORDER_ACTION_PREFIX = 'client:orders:cancel';
export const CLIENT_CONFIRM_CANCEL_ORDER_ACTION_PREFIX = 'client:orders:cancel-confirm';

export const CLIENT_VIEW_ORDER_ACTION_PATTERN = new RegExp(
  `^${CLIENT_VIEW_ORDER_ACTION_PREFIX}:(\\d+)$`,
);
export const CLIENT_CANCEL_ORDER_ACTION_PATTERN = new RegExp(
  `^${CLIENT_CANCEL_ORDER_ACTION_PREFIX}:(\\d+)$`,
);
export const CLIENT_CONFIRM_CANCEL_ORDER_ACTION_PATTERN = new RegExp(
  `^${CLIENT_CONFIRM_CANCEL_ORDER_ACTION_PREFIX}:(\\d+)$`,
);
