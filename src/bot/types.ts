import type { Context } from 'telegraf';

import type { OrderLocation, OrderPriceDetails } from '../types';
import type { AppCity } from '../domain/cities';

export const EXECUTOR_VERIFICATION_PHOTO_COUNT = 2;

export type ExecutorRole = 'courier' | 'driver';

export const EXECUTOR_ROLES: readonly ExecutorRole[] = ['courier', 'driver'];

export type UserRole = 'guest' | 'client' | 'executor';

export type UserVerifyStatus = 'none' | 'pending' | 'active' | 'rejected' | 'expired';

export type UserSubscriptionStatus = 'none' | 'trial' | 'active' | 'grace' | 'expired';

export interface SessionUser {
  id: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  phoneVerified?: boolean;
}

export type UserStatus =
  | 'guest'
  | 'onboarding'
  | 'awaiting_phone'
  | 'active_client'
  | 'active_executor'
  | 'safe_mode'
  | 'trial_expired'
  | 'suspended'
  | 'banned';

export type UserMenuRole = 'client' | 'courier' | 'moderator';

export interface AuthUser {
  telegramId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  phoneVerified: boolean;
  role: UserRole;
  executorKind?: ExecutorRole;
  status: UserStatus;
  verifyStatus: UserVerifyStatus;
  subscriptionStatus: UserSubscriptionStatus;
  isVerified: boolean;
  isBlocked: boolean;
  citySelected?: AppCity;
  verifiedAt?: Date;
  trialStartedAt?: Date;
  trialExpiresAt?: Date;
  subscriptionExpiresAt?: Date;
  hasActiveOrder: boolean;
  lastMenuRole?: UserMenuRole;
  keyboardNonce?: string;
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

export interface AuthStateSnapshot {
  role: UserRole;
  executorKind?: ExecutorRole;
  status: UserStatus;
  phoneVerified: boolean;
  verifyStatus: UserVerifyStatus;
  subscriptionStatus: UserSubscriptionStatus;
  userIsVerified: boolean;
  executor: AuthExecutorState;
  isModerator: boolean;
  trialStartedAt?: Date;
  trialExpiresAt?: Date;
  subscriptionExpiresAt?: Date;
  city?: AppCity;
  hasActiveOrder: boolean;
  stale: boolean;
}

export interface ExecutorUploadedPhoto {
  fileId: string;
  messageId: number;
  fileUniqueId?: string;
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
  lastReminderAt?: number;
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
  lastReminderAt?: number;
}

export type ExecutorVerificationState = Record<ExecutorRole, ExecutorVerificationRoleState>;

export interface ExecutorFlowState {
  role?: ExecutorRole;
  verification: ExecutorVerificationState;
  subscription: ExecutorSubscriptionState;
  awaitingRoleSelection?: boolean;
  roleSelectionStage?: 'role' | 'executorKind' | 'city';
}

export type ClientOrderStage =
  | 'idle'
  | 'collectingPickup'
  | 'collectingDropoff'
  | 'selectingAddressType'
  | 'collectingApartment'
  | 'collectingEntrance'
  | 'collectingFloor'
  | 'collectingRecipientPhone'
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
  isPrivateHouse?: boolean;
  apartment?: string;
  entrance?: string;
  floor?: string;
  recipientPhone?: string;
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
  pendingCityAction?: 'clientMenu' | 'executorMenu' | 'executorRoleSelection';
  clientMenuVariant?: 'A' | 'B';
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
  safeMode: boolean;
  isDegraded: boolean;
  awaitingPhone: boolean;
  phoneNumber?: string;
  user?: SessionUser;
  city?: AppCity;
  authSnapshot: AuthStateSnapshot;
  executor: ExecutorFlowState;
  client: ClientFlowState;
  ui: UiSessionState;
  support: SupportSessionState;
}

export type BotContext = Context & {
  session: SessionState;
  auth: AuthState;
};
