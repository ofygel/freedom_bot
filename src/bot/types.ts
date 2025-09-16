import type { Context } from 'telegraf';

import type { OrderLocation, OrderPriceDetails } from '../types';

export const EXECUTOR_VERIFICATION_PHOTO_COUNT = 2;

export type ExecutorRole = 'courier' | 'driver';

export const EXECUTOR_ROLES: readonly ExecutorRole[] = ['courier', 'driver'];

export interface SessionUser {
  id: number;
  username?: string;
  firstName?: string;
  lastName?: string;
}

export interface ExecutorUploadedPhoto {
  fileId: string;
  messageId: number;
}

export type ExecutorVerificationStatus = 'idle' | 'collecting' | 'submitted';

export interface ExecutorVerificationRoleState {
  status: ExecutorVerificationStatus;
  requiredPhotos: number;
  uploadedPhotos: ExecutorUploadedPhoto[];
  submittedAt?: number;
  moderationThreadMessageId?: number;
}

export type ExecutorSubscriptionStatus =
  | 'idle'
  | 'selectingPeriod'
  | 'awaitingReceipt'
  | 'pendingModeration';

export interface ExecutorSubscriptionState {
  status: ExecutorSubscriptionStatus;
  selectedPeriodId?: string;
  pendingPaymentId?: string;
  moderationChatId?: number;
  moderationMessageId?: number;
  lastInviteLink?: string;
  lastIssuedAt?: number;
}

export type ExecutorVerificationState = Record<ExecutorRole, ExecutorVerificationRoleState>;

export interface ExecutorFlowState {
  role: ExecutorRole;
  verification: ExecutorVerificationState;
  subscription: ExecutorSubscriptionState;
}

export type ClientOrderStage =
  | 'idle'
  | 'collectingPickup'
  | 'collectingDropoff'
  | 'awaitingConfirmation'
  | 'creatingOrder';

export interface ClientOrderDraftState {
  stage: ClientOrderStage;
  pickup?: OrderLocation;
  dropoff?: OrderLocation;
  price?: OrderPriceDetails;
  confirmationMessageId?: number;
}

export interface ClientFlowState {
  taxi: ClientOrderDraftState;
  delivery: ClientOrderDraftState;
}

export interface UiTrackedStepState {
  chatId: number;
  messageId: number;
  cleanup: boolean;
}

export interface UiSessionState {
  steps: Record<string, UiTrackedStepState | undefined>;
  homeActions: string[];
}

export interface SessionState {
  ephemeralMessages: number[];
  isAuthenticated: boolean;
  awaitingPhone: boolean;
  phoneNumber?: string;
  user?: SessionUser;
  executor: ExecutorFlowState;
  client: ClientFlowState;
  ui: UiSessionState;
}

export type BotContext = Context & {
  session: SessionState;
};
