export type OrderKind = 'taxi' | 'delivery';

export type OrderStatus = 'new' | 'claimed' | 'cancelled';

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

export interface OrderMetadata {
  customerName?: string;
  customerUsername?: string;
  notes?: string;
}

export interface OrderRecord {
  id: number;
  kind: OrderKind;
  status: OrderStatus;
  clientId?: number;
  clientPhone?: string;
  pickup: OrderLocation;
  dropoff: OrderLocation;
  price: OrderPriceDetails;
  metadata?: OrderMetadata;
  channelMessageId?: number;
  createdAt: Date;
}

export interface OrderInsertInput {
  kind: OrderKind;
  clientId?: number;
  clientPhone?: string;
  pickup: OrderLocation;
  dropoff: OrderLocation;
  price: OrderPriceDetails;
  metadata?: OrderMetadata;
}
