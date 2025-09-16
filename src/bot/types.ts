import type { Context } from 'telegraf';

export interface SessionUser {
  id: number;
  username?: string;
  firstName?: string;
  lastName?: string;
}

export interface SessionState {
  ephemeralMessages: number[];
  isAuthenticated: boolean;
  user?: SessionUser;
}

export type BotContext = Context & {
  session: SessionState;
};
