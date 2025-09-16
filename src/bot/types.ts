import type { Context } from 'telegraf';

import type { OrderLocation, OrderPriceDetails } from '../types';

export const EXECUTOR_VERIFICATION_PHOTO_COUNT = 3;

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

export interface ExecutorVerificationState {
  status: ExecutorVerificationStatus;
  requiredPhotos: number;
  uploadedPhotos: ExecutorUploadedPhoto[];
  submittedAt?: number;
  moderationThreadMessageId?: number;
}

export interface ExecutorSubscriptionState {
  lastInviteLink?: string;
  lastIssuedAt?: number;
}

export interface ExecutorFlowState {
  verification: ExecutorVerificationState;
  subscription: ExecutorSubscriptionState;
  menuMessageId?: number;
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
  menuMessageId?: number;
}

export interface SessionState {
  ephemeralMessages: number[];
  isAuthenticated: boolean;
  awaitingPhone: boolean;
  phoneNumber?: string;
  user?: SessionUser;
  executor: ExecutorFlowState;
  client: ClientFlowState;
}

export type BotContext = Context & {
  session: SessionState;
};
