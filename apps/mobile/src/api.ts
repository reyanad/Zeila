import { API_URL } from "./config";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface Deal {
  name: string;
  discountBps: number;
  endsAt: string;
  remaining: number | null;
}

export interface ListingCard {
  id: string;
  slug: string;
  type: "PHYSICAL" | "DIGITAL" | "SERVICE";
  title: string;
  storeName: string;
  currency: string;
  minPrice: number;
  maxPrice: number;
  imageUrl: string | null;
  rating: number;
  ratingCount: number;
  inStock: boolean;
  deal: Deal | null;
}

export interface ListingPage {
  page: number;
  total: number;
  hasMore: boolean;
  items: ListingCard[];
}

export interface ListingDetail {
  id: string;
  slug: string;
  type: ListingCard["type"];
  title: string;
  summary: string | null;
  description: string;
  currency: string;
  minPrice: number;
  maxPrice: number;
  rating: number;
  ratingCount: number;
  images: string[];
  store: { id: string; name: string; slug: string; country: string };
  deal: Deal | null;
  webUrl: string;
}

export interface OrderSummary {
  id: string;
  orderNumber: string;
  status: string;
  currency: string;
  total: number;
  placedAt: string;
  stores: string[];
  summary: string;
}

export interface OrderDetail {
  id: string;
  orderNumber: string;
  status: string;
  currency: string;
  total: number;
  placedAt: string;
  webUrl: string;
  subOrders: Array<{
    id: string;
    status: string;
    total: number;
    storeName: string;
    escrow: { status: string; holdUntil: string } | null;
    canConfirm: boolean;
    shipments: Array<{ carrier: string; trackingNumber: string | null; trackingUrl: string | null; status: string }>;
    items: Array<{ id: string; title: string; quantity: number; total: number; type: string; status: string; workspaceUrl: string | null }>;
  }>;
}

export interface ConversationSummary {
  id: string;
  title: string;
  preview: string;
  updatedAt: string;
  unread: boolean;
}

export interface Offer {
  title: string;
  description: string;
  price: number;
  currency: string;
  deliveryDays: number;
  revisions: number;
  expiresAt: string;
  status: "OPEN" | "ACCEPTED" | "DECLINED" | "WITHDRAWN" | "EXPIRED";
}

export interface ConversationDetail {
  id: string;
  title: string;
  webUrl: string;
  messages: Array<{ id: string; mine: boolean; kind: string; body: string | null; flagged: boolean; offer: Offer | null; createdAt: string }>;
}

export interface NotificationItem {
  id: string;
  title: string;
  body: string | null;
  read: boolean;
  createdAt: string;
  path: string | null;
  webUrl: string | null;
}

export interface Me {
  user: { id: string; email: string; name: string | null; role: string };
  store: { name: string; slug: string; status: string } | null;
  unreadMessages: number;
  unreadNotifications: number;
}

export type LoginResponse = { token: string; user: { id: string; email: string; name: string | null } } | { twoFactorRequired: true; ticket: string };

interface RequestOptions {
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
  token?: string | null;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: options.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "No connection. Check your internet and try again.");
  }
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const message = typeof data === "object" && data !== null && "error" in data && typeof (data as { error: unknown }).error === "string" ? (data as { error: string }).error : "Something went wrong. Try again.";
    throw new ApiError(response.status, message);
  }
  return data as T;
}
