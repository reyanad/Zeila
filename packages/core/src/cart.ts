import { prisma, type Prisma } from "@marketplace/database";
import { MAX_CART_QUANTITY, type AddToCartPayload } from "@marketplace/shared-types";
import { checkLine, purchasableInclude, type PurchasableLine } from "./catalog";
import { CheckoutError } from "./errors";

export type CartOwner = { userId: string } | { anonToken: string };

const cartInclude = {
  items: { orderBy: { addedAt: "asc" }, include: purchasableInclude },
} satisfies Prisma.CartInclude;

export type CartWithItems = Prisma.CartGetPayload<{ include: typeof cartInclude }>;
export type CartLine = PurchasableLine & { id: string; quantity: number; unitPriceSnapshot: number };

function ownerWhere(owner: CartOwner): Prisma.CartWhereInput {
  return "userId" in owner ? { userId: owner.userId, status: "ACTIVE" } : { anonToken: owner.anonToken, status: "ACTIVE" };
}

export async function findCart(owner: CartOwner): Promise<CartWithItems | null> {
  return prisma.cart.findFirst({ where: ownerWhere(owner), orderBy: { updatedAt: "desc" }, include: cartInclude });
}

export async function getOrCreateCart(owner: CartOwner): Promise<CartWithItems> {
  const existing = await findCart(owner);
  if (existing) return existing;
  return prisma.cart.create({ data: "userId" in owner ? { userId: owner.userId } : { anonToken: owner.anonToken }, include: cartInclude });
}

export async function cartItemCount(owner: CartOwner): Promise<number> {
  const cart = await prisma.cart.findFirst({ where: ownerWhere(owner), select: { _count: { select: { items: true } } } });
  return cart?._count.items ?? 0;
}

/** Move a guest cart into the signed-in buyer's cart (called after sign-in). */
export async function mergeGuestCart(anonToken: string, userId: string): Promise<void> {
  const guest = await prisma.cart.findFirst({ where: { anonToken, status: "ACTIVE" }, include: { items: true } });
  if (!guest) return;
  const target = await getOrCreateCart({ userId });
  await prisma.$transaction(async (tx) => {
    for (const item of guest.items) {
      const match = await tx.cartItem.findFirst({
        where: { cartId: target.id, listingId: item.listingId, skuId: item.skuId, serviceTierId: item.serviceTierId },
      });
      if (match) {
        const single = item.skuId === null; // downloads and services are bought once
        await tx.cartItem.update({
          where: { id: match.id },
          data: { quantity: single ? 1 : Math.min(MAX_CART_QUANTITY, match.quantity + item.quantity) },
        });
      } else {
        await tx.cartItem.create({
          data: {
            cartId: target.id,
            listingId: item.listingId,
            skuId: item.skuId,
            serviceTierId: item.serviceTierId,
            quantity: item.quantity,
            unitPriceSnapshot: item.unitPriceSnapshot,
          },
        });
      }
    }
    if (!target.promoCode && guest.promoCode) await tx.cart.update({ where: { id: target.id }, data: { promoCode: guest.promoCode } });
    await tx.cart.delete({ where: { id: guest.id } });
  });
}

async function loadLine(cartId: string, payload: AddToCartPayload): Promise<{ line: PurchasableLine; existingId: string | null; existingQuantity: number }> {
  const listing = await prisma.listing.findUnique({ where: { id: payload.listingId }, select: { id: true, type: true } });
  if (!listing) throw new CheckoutError("That listing does not exist.");
  if (listing.type === "PHYSICAL" && !payload.skuId) throw new CheckoutError("Choose a variant first.");
  if (listing.type === "SERVICE" && !payload.serviceTierId) throw new CheckoutError("Choose a package first.");
  const skuId = listing.type === "PHYSICAL" ? (payload.skuId ?? null) : null;
  const serviceTierId = listing.type === "SERVICE" ? (payload.serviceTierId ?? null) : null;

  const existing = await prisma.cartItem.findFirst({ where: { cartId, listingId: listing.id, skuId, serviceTierId }, include: purchasableInclude });
  if (existing) return { line: existing, existingId: existing.id, existingQuantity: existing.quantity };

  // An unsaved line lets checkLine validate a new item with the same rules as checkout.

  const [fullListing, sku, serviceTier] = await Promise.all([
    prisma.listing.findUniqueOrThrow({ where: { id: listing.id }, select: purchasableInclude.listing.select }),
    skuId ? prisma.sku.findUnique({ where: { id: skuId }, select: purchasableInclude.sku.select }) : Promise.resolve(null),
    serviceTierId ? prisma.serviceTier.findUnique({ where: { id: serviceTierId }, select: purchasableInclude.serviceTier.select }) : Promise.resolve(null),
  ]);
  const draft: PurchasableLine = {
    id: "",
    cartId,
    listingId: listing.id,
    skuId,
    serviceTierId,
    quantity: 0,
    unitPriceSnapshot: 0,
    addedAt: new Date(),
    listing: fullListing,
    sku,
    serviceTier,
  };
  return { line: draft, existingId: null, existingQuantity: 0 };
}

/** Add a listing (with its variant or package) to the cart, merging with an existing line. */
export async function addToCart(cartId: string, payload: AddToCartPayload): Promise<void> {
  const { line, existingId, existingQuantity } = await loadLine(cartId, payload);
  const single = line.listing.type !== "PHYSICAL";
  const quantity = single ? 1 : Math.min(MAX_CART_QUANTITY, existingQuantity + payload.quantity);
  const check = checkLine(line, quantity);
  if (!check.ok) throw new CheckoutError(check.problem);

  const cart = await prisma.cart.findUniqueOrThrow({ where: { id: cartId }, select: { items: { select: { listing: { select: { currency: true } } } } } });
  if (cart.items.length >= 100 && !existingId) throw new CheckoutError("Your cart is full. Check out or remove something first.");

  if (existingId) {
    await prisma.cartItem.update({ where: { id: existingId }, data: { quantity, unitPriceSnapshot: check.unitPrice } });
  } else {
    await prisma.cartItem.create({
      data: { cartId, listingId: line.listingId, skuId: line.skuId, serviceTierId: line.serviceTierId, quantity, unitPriceSnapshot: check.unitPrice },
    });
  }
  await prisma.cart.update({ where: { id: cartId }, data: { updatedAt: new Date() } });
}

export async function setCartItemQuantity(cartId: string, itemId: string, quantity: number): Promise<void> {
  const item = await prisma.cartItem.findFirst({ where: { id: itemId, cartId }, include: purchasableInclude });
  if (!item) throw new CheckoutError("That item is no longer in your cart.");
  if (quantity <= 0) {
    await prisma.cartItem.delete({ where: { id: item.id } });
    return;
  }
  const next = item.listing.type === "PHYSICAL" ? Math.min(MAX_CART_QUANTITY, quantity) : 1;
  const check = checkLine(item, next);
  if (!check.ok) throw new CheckoutError(check.problem);
  await prisma.cartItem.update({ where: { id: item.id }, data: { quantity: next, unitPriceSnapshot: check.unitPrice } });
}

export async function removeCartItem(cartId: string, itemId: string): Promise<void> {
  await prisma.cartItem.deleteMany({ where: { id: itemId, cartId } });
}

export async function setCartPromo(cartId: string, code: string | null): Promise<void> {
  await prisma.cart.update({ where: { id: cartId }, data: { promoCode: code } });
}
