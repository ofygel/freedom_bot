export type OrderKind = 'taxi' | 'delivery';

export type OrderStatus = 'open' | 'claimed' | 'cancelled' | 'done';

export interface OrderLocation {
  query: string;
  address: string;
  latitude: number;
  longitude: number;
}

export interface OrderPriceDetails {
  amount: number;
  currency: string;
  distanceKm: number;
}

export interface OrderRecord {
  id: number;
  shortId: string;
  kind: OrderKind;
  status: OrderStatus;
  clientId?: number;
  clientPhone?: string;
  customerName?: string;
  customerUsername?: string;
  clientComment?: string;
  claimedBy?: number;
  claimedAt?: Date;
  completedAt?: Date;
  pickup: OrderLocation;
  dropoff: OrderLocation;
  price: OrderPriceDetails;
  channelMessageId?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderInsertInput {
  kind: OrderKind;
  clientId?: number;
  clientPhone?: string;
  customerName?: string;
  customerUsername?: string;
  clientComment?: string;
  pickup: OrderLocation;
  dropoff: OrderLocation;
  price: OrderPriceDetails;
}
