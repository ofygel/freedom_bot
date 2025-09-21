import type { Context } from 'telegraf';

import type { OrderLocation, OrderPriceDetails } from '../types';
import type { AppCity } from '../domain/cities';

export const EXECUTOR_VERIFICATION_PHOTO_COUNT = 2;

export type ExecutorRole = 'courier' | 'driver';

export const EXECUTOR_ROLES: readonly ExecutorRole[] = ['courier', 'driver'];

export type UserRole = 'client' | 'courier' | 'driver' | 'moderator';

export interface SessionUser {
  id: number;
  username?: string;
  firstName?: string;
  lastName?: string;
}

export interface AuthUser {
  telegramId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  role: UserRole;
  isVerified: boolean;
  isBlocked: boolean;
  citySelected?: AppCity;
}

export interface AuthExecutorState {
  verifiedRoles: Record<ExecutorRole, boolean>;
  hasActiveSubscription: boolean;
  isVerified: boolean;
}

export interface AuthState {
  user: AuthUser;
  executor: AuthExecutorState;
  isModerator: boolean;
}

export interface ExecutorUploadedPhoto {
  fileId: string;
  messageId: number;
}

export type ExecutorVerificationStatus = 'idle' | 'collecting' | 'submitted';

export interface ExecutorVerificationModerationState {
  applicationId?: string;
  chatId?: number;
  messageId?: number;
  token?: string;
}

export interface ExecutorVerificationRoleState {
  status: ExecutorVerificationStatus;
  requiredPhotos: number;
  uploadedPhotos: ExecutorUploadedPhoto[];
  submittedAt?: number;
  moderation?: ExecutorVerificationModerationState;
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
  | 'collectingComment'
  | 'awaitingConfirmation'
  | 'creatingOrder';

export interface ClientOrderDraftState {
  stage: ClientOrderStage;
  pickup?: OrderLocation;
  dropoff?: OrderLocation;
  price?: OrderPriceDetails;
  confirmationMessageId?: number;
  notes?: string;
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
  pendingCityAction?: 'clientMenu' | 'executorMenu';
}

export type SupportRequestStatus = 'idle' | 'awaiting_message';

export interface SupportSessionState {
  status: SupportRequestStatus;
  lastThreadId?: string;
  lastThreadShortId?: string;
}

export interface SessionState {
  ephemeralMessages: number[];
  isAuthenticated: boolean;
  awaitingPhone: boolean;
  phoneNumber?: string;
  user?: SessionUser;
  city?: AppCity;
  executor: ExecutorFlowState;
  client: ClientFlowState;
  ui: UiSessionState;
  support: SupportSessionState;
}

export type BotContext = Context & {
  session: SessionState;
  auth: AuthState;
};
