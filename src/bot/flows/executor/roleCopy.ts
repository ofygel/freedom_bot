import type { ExecutorRole } from '../../types';

interface ExecutorRoleCopy {
  /** Emoji used to represent the role in headings. */
  emoji: string;
  /** Nominative form of the role (e.g. «курьер»). */
  noun: string;
  /** Genitive form used in phrases like «роль курьера». */
  genitive: string;
  /** Genitive plural form used in phrases like «канал курьеров». */
  pluralGenitive: string;
}

const ROLE_COPY: Record<ExecutorRole, ExecutorRoleCopy> = {
  courier: {
    emoji: '🚚',
    noun: 'курьер',
    genitive: 'курьера',
    pluralGenitive: 'курьеров',
  },
  taxi_driver: {
    emoji: '🚕',
    noun: 'водитель такси',
    genitive: 'водителя такси',
    pluralGenitive: 'водителей такси',
  },
};

export const getExecutorRoleCopy = (role: ExecutorRole): ExecutorRoleCopy =>
  ROLE_COPY[role] ?? ROLE_COPY.courier;

export type { ExecutorRoleCopy };
