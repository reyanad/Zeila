"use server";

import { redirect } from "next/navigation";
import { abandonPendingOrders, CheckoutError, completeOrderPayment, placeOrder } from "@marketplace/core";
import { prisma } from "@marketplace/database";
import { addressSchema, countryCodeSchema, fieldErrors, isSupportedCurrency, type AddressSnapshot } from "@marketplace/shared-types";
import { recordAudit } from "@/lib/audit";
import { authorize } from "@/lib/auth/session";
import { writableCart } from "@/lib/cart-session";
import { formError, type FormState } from "@/lib/form-state";
import { describeRetry, rateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request";
import { getStripe } from "@/lib/stripe";

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

const ADDRESS_FIELDS = ["recipient", "phone", "line1", "line2", "city", "state", "postalCode", "country"] as const;

/** Save a delivery address, then continue checkout with it selected. */
export async function saveAddressAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorize("order:create");
  if (!auth.ok) return formError(auth.message);
  const currency = text(formData, "currency");
  if (!isSupportedCurrency(currency)) return formError("Unknown currency.");

  const values = Object.fromEntries(ADDRESS_FIELDS.map((name) => [name, text(formData, name)]));
  const parsed = addressSchema.safeParse(values);
  if (!parsed.success) return formError("Check the highlighted fields.", fieldErrors(parsed.error), values);
  const count = await prisma.address.count({ where: { userId: auth.user.id } });
  if (count >= 20) return formError("You have saved 20 addresses. Remove one in your account first.");

  const input = parsed.data;
  const address = await prisma.address.create({
    data: {
      userId: auth.user.id,
      recipient: input.recipient,
      phone: input.phone,
      line1: input.line1,
      line2: input.line2 || null,
      city: input.city,
      state: input.state || null,
      postalCode: input.postalCode || null,
      country: input.country,
      isDefaultShipping: count === 0,
    },
    select: { id: true },
  });
  redirect(`/checkout?currency=${currency}&address=${address.id}`);
}

/** Billing country for carts without deliveries (decides tax on downloads and services). */
export async function saveBillingCountryAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorize("order:create");
  if (!auth.ok) return formError(auth.message);
  const currency = text(formData, "currency");
  const parsed = countryCodeSchema.safeParse(text(formData, "country"));
  if (!parsed.success || !isSupportedCurrency(currency)) return formError("Choose your country.", { country: "Choose your country" });
  await prisma.user.update({ where: { id: auth.user.id }, data: { country: parsed.data } });
  redirect(`/checkout?currency=${currency}`);
}

export type PlaceOrderResult = { ok: false; message: string };

/**
 * Create the order from the cart and go to payment. Prices, stock, shipping
 * and tax are recomputed here; nothing the browser sends is trusted.
 */
export async function placeOrderAction(currency: string, addressId: string | null): Promise<PlaceOrderResult> {
  const auth = await authorize("order:create");
  if (!auth.ok) return { ok: false, message: auth.message };
  if (!auth.user.emailVerified) return { ok: false, message: "Confirm your email address before buying, so we can send your receipt." };
  if (!isSupportedCurrency(currency)) return { ok: false, message: "Unknown currency." };

  const limit = await rateLimit(`place-order:${auth.user.id}`, 20, 60 * 60);
  if (!limit.allowed) return { ok: false, message: `Too many attempts. ${describeRetry(limit.retryAfterSeconds)}` };

  const [address, profile] = await Promise.all([
    addressId ? prisma.address.findFirst({ where: { id: addressId, userId: auth.user.id } }) : Promise.resolve(null),
    prisma.user.findUnique({ where: { id: auth.user.id }, select: { country: true } }),
  ]);
  if (addressId && !address) return { ok: false, message: "Choose a delivery address again." };
  const snapshot: AddressSnapshot | null = address
    ? {
        addressId: address.id,
        recipient: address.recipient,
        phone: address.phone ?? "",
        line1: address.line1,
        line2: address.line2 ?? "",
        city: address.city,
        state: address.state ?? "",
        postalCode: address.postalCode ?? "",
        country: address.country,
      }
    : null;

  const stripe = getStripe();
  let order;
  try {
    // An earlier unpaid checkout still holds stock; give it back first.
    await abandonPendingOrders(stripe, auth.user.id, currency);
    const cart = await writableCart();
    order = await placeOrder({
      cart,
      currency,
      buyerId: auth.user.id,
      address: snapshot,
      destinationCountry: snapshot?.country ?? null,
      taxCountry: snapshot?.country ?? profile?.country ?? null,
      now: new Date(),
    });
  } catch (error) {
    if (error instanceof CheckoutError) return { ok: false, message: error.message };
    throw error;
  }

  await recordAudit({
    actorId: auth.user.id,
    action: "order.place",
    entity: "Order",
    entityId: order.id,
    data: { orderNumber: order.orderNumber, grandTotal: order.grandTotal, currency: order.currency },
    ipAddress: await getClientIp(),
  });

  if (order.grandTotal === 0) {
    await completeOrderPayment({ orderId: order.id, paymentIntentId: null, chargeId: null, amount: 0, currency: order.currency, paidAt: new Date() });
    redirect(`/orders/${order.id}?paid=1`);
  }
  if (!stripe) return { ok: false, message: "Card payments are not available yet: the platform has not configured Stripe." };
  redirect(`/checkout/pay/${order.id}`);
}
