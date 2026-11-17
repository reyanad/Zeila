"use server";

import { revalidatePath } from "next/cache";
import { addToCart, CheckoutError, removeCartItem, setCartItemQuantity, setCartPromo } from "@marketplace/core";
import { addToCartSchema, promoCodeSchema } from "@marketplace/shared-types";
import { writableCart } from "@/lib/cart-session";
import { describeRetry, rateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request";

export type CartActionResult = { ok: true; message?: string } | { ok: false; message: string };

async function limited(): Promise<CartActionResult | null> {
  const limit = await rateLimit(`cart:${await getClientIp()}`, 120, 10 * 60);
  return limit.allowed ? null : { ok: false, message: `Too many changes. ${describeRetry(limit.retryAfterSeconds)}` };
}

async function run(work: () => Promise<void>, message?: string): Promise<CartActionResult> {
  const blocked = await limited();
  if (blocked) return blocked;
  try {
    await work();
  } catch (error) {
    if (error instanceof CheckoutError) return { ok: false, message: error.message };
    throw error;
  }
  revalidatePath("/cart");
  return { ok: true, message };
}

export async function addToCartAction(payload: unknown): Promise<CartActionResult> {
  const parsed = addToCartSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Choose what to add." };
  return run(async () => {
    const cart = await writableCart();
    await addToCart(cart.id, parsed.data);
  }, "Added to your cart.");
}

export async function updateCartItemAction(itemId: string, quantity: number): Promise<CartActionResult> {
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > 9_999) return { ok: false, message: "Enter a quantity between 0 and 9999." };
  return run(async () => {
    const cart = await writableCart();
    await setCartItemQuantity(cart.id, itemId, quantity);
  });
}

export async function removeCartItemAction(itemId: string): Promise<CartActionResult> {
  return run(async () => {
    const cart = await writableCart();
    await removeCartItem(cart.id, itemId);
  });
}

export async function applyPromoAction(code: string): Promise<CartActionResult> {
  const parsed = promoCodeSchema.safeParse(code);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Enter a valid code." };
  return run(async () => {
    const cart = await writableCart();
    await setCartPromo(cart.id, parsed.data);
  });
}

export async function removePromoAction(): Promise<CartActionResult> {
  return run(async () => {
    const cart = await writableCart();
    await setCartPromo(cart.id, null);
  });
}
