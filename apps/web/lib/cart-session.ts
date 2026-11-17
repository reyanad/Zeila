import "server-only";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { cartItemCount, findCart, getOrCreateCart, mergeGuestCart, type CartOwner, type CartWithItems } from "@marketplace/core";
import { getCurrentUser } from "@/lib/auth/session";
import { isProduction } from "@/lib/env";

export const CART_COOKIE = "cart_token";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,64}$/;

async function guestToken(): Promise<string | null> {
  const value = (await cookies()).get(CART_COOKIE)?.value;
  return value && TOKEN_PATTERN.test(value) ? value : null;
}

/**
 * The cart owner for this request. A signed-in buyer's guest cart is merged
 * into their account cart the first time it is seen.
 */
async function owner(): Promise<CartOwner | null> {
  const [user, token] = await Promise.all([getCurrentUser(), guestToken()]);
  if (user) {
    if (token) await mergeGuestCart(token, user.id);
    return { userId: user.id };
  }
  return token ? { anonToken: token } : null;
}

/** For pages: the current cart, or null. Never creates anything. */
export async function readCart(): Promise<CartWithItems | null> {
  const current = await owner();
  return current ? findCart(current) : null;
}

export async function readCartCount(): Promise<number> {
  const current = await owner();
  return current ? cartItemCount(current) : 0;
}

/** For server actions: the cart, created (and the guest cookie set) when needed. */
export async function writableCart(): Promise<CartWithItems> {
  const current = await owner();
  if (current) {
    if ("userId" in current) (await cookies()).delete(CART_COOKIE);
    return getOrCreateCart(current);
  }
  const token = randomBytes(32).toString("base64url");
  (await cookies()).set(CART_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction(),
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return getOrCreateCart({ anonToken: token });
}
