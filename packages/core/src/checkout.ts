import { randomBytes } from "node:crypto";
import { prisma, type Prisma } from "@marketplace/database";
import { applyBps, CHECKOUT_HOLD_MINUTES, type AddressSnapshot, type ListingTypeValue } from "@marketplace/shared-types";
import type { CartWithItems } from "./cart";
import { availableStock, checkLine, parseShippingProfile, variantLabel, type LineCheck } from "./catalog";
import { activeFlashDeals, applyFlash, claimFlashUnits, type FlashDeal } from "./flash-sales";
import { CheckoutError } from "./errors";
import { reserveStock } from "./inventory";
import { priceCheckout, type PricingLine } from "./pricing";
import { resolvePromo } from "./promo";
import { getSetting } from "./settings";

export interface QuoteItem {
  id: string;
  listingId: string;
  slug: string;
  title: string;
  variantLabel: string | null;
  type: ListingTypeValue;
  imageKey: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  discount: number;
  /** Price when it was added, to flag changes. */
  priceAtAdd: number;
  maxQuantity: number;
  problem: string | null;
  /** The flash sale price applied to this line, if any. */
  flash: { flashSaleId: string; name: string; discountBps: number; endsAt: string; capped: boolean } | null;
}

export interface QuoteStore {
  storeId: string;
  name: string;
  slug: string;
  items: QuoteItem[];
  itemsSubtotal: number;
  discount: number;
  shipping: number;
  tax: number;
  total: number;
  problem: string | null;
}

export interface Quote {
  currency: string;
  stores: QuoteStore[];
  itemsSubtotal: number;
  discountTotal: number;
  shippingTotal: number;
  taxTotal: number;
  grandTotal: number;
  taxLabel: string | null;
  promo: { code: string; applied: boolean; problem: string | null } | null;
  needsAddress: boolean;
  /** Anything listed here blocks payment. */
  problems: string[];
  /** Other currencies still in the cart (each is checked out separately). */
  otherCurrencies: string[];
}

function firstImageKey(images: Prisma.JsonValue): string | null {
  if (!Array.isArray(images)) return null;
  const first = images[0];
  if (typeof first !== "object" || first === null || Array.isArray(first)) return null;
  const key = (first as Record<string, unknown>).key;
  return typeof key === "string" ? key : null;
}

/** Currencies present in the cart, most-used first. */
export function cartCurrencies(cart: CartWithItems): string[] {
  const counts = new Map<string, number>();
  for (const item of cart.items) counts.set(item.listing.currency, (counts.get(item.listing.currency) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([currency]) => currency);
}

export interface QuoteParams {
  cart: CartWithItems;
  currency: string;
  destinationCountry: string | null;
  taxCountry: string | null;
  buyerId: string | null;
  now: Date;
}

/** Price the part of the cart in one currency with today's prices, stock and rules. */
export async function buildQuote(params: QuoteParams): Promise<Quote> {
  const { cart, currency } = params;
  const items = cart.items.filter((item) => item.listing.currency === currency);
  const otherCurrencies = cartCurrencies(cart).filter((code) => code !== currency);

  const deals = await activeFlashDeals(items.map((item) => item.listingId), params.now);
  const checks = new Map<string, { check: LineCheck; deal: FlashDeal | null }>(
    items.map((item) => {
      const check = checkLine(item, item.quantity);
      if (!check.ok) return [item.id, { check, deal: null }];
      const flash = applyFlash(check.unitPrice, item.quantity, deals.get(item.listingId));
      return [item.id, { check: { ...check, unitPrice: flash.unitPrice }, deal: flash.deal }];
    }),
  );
  const sellable = items.filter((item) => checks.get(item.id)?.check.ok);

  const lines: PricingLine[] = sellable.map((item) => {
    const check = checks.get(item.id)?.check;
    return {
      key: item.id,
      storeId: item.listing.storeId,
      type: item.listing.type,
      quantity: item.quantity,
      unitPrice: check?.ok ? check.unitPrice : 0,
      weightGrams: item.sku?.weightGrams ?? null,
    };
  });

  const stores = Object.fromEntries(
    sellable.map((item) => [
      item.listing.storeId,
      { originCountry: item.listing.store.warehouses[0]?.country ?? item.listing.store.country, profile: parseShippingProfile(item.listing.store.shippingProfile) },
    ]),
  );

  let promo: Quote["promo"] = null;
  let rule = null;
  if (cart.promoCode) {
    const lookup = await resolvePromo(cart.promoCode, currency, params.buyerId, params.now);
    if (lookup.ok) rule = lookup.rule;
    promo = { code: cart.promoCode, applied: false, problem: lookup.ok ? null : lookup.problem };
  }

  const pricing = priceCheckout({
    lines,
    stores,
    destinationCountry: params.destinationCountry,
    taxCountry: params.taxCountry ?? params.destinationCountry,
    promo: rule,
    taxRates: await getSetting("taxRates"),
  });
  if (promo) {
    promo.applied = rule !== null && pricing.promoProblem === null && pricing.discountTotal > 0;
    promo.problem = promo.problem ?? pricing.promoProblem;
  }

  const pricedLines = new Map(pricing.stores.flatMap((store) => store.lines.map((line) => [line.key, line])));
  const quoteStores: QuoteStore[] = [];
  for (const item of items) {
    const storeId = item.listing.storeId;
    let store = quoteStores.find((candidate) => candidate.storeId === storeId);
    if (!store) {
      const priced = pricing.stores.find((candidate) => candidate.storeId === storeId);
      store = {
        storeId,
        name: item.listing.store.name,
        slug: item.listing.store.slug,
        items: [],
        itemsSubtotal: priced?.itemsSubtotal ?? 0,
        discount: priced?.discount ?? 0,
        shipping: priced?.shipping ?? 0,
        tax: priced?.tax ?? 0,
        total: priced?.total ?? 0,
        problem: priced?.problem ?? null,
      };
      quoteStores.push(store);
    }
    const entry = checks.get(item.id);
    const check = entry?.check;
    const priced = pricedLines.get(item.id);
    store.items.push({
      id: item.id,
      listingId: item.listingId,
      slug: item.listing.slug,
      title: item.listing.title,
      variantLabel: variantLabel(item),
      type: item.listing.type,
      imageKey: firstImageKey(item.listing.images),
      quantity: item.quantity,
      unitPrice: check?.ok ? check.unitPrice : item.unitPriceSnapshot,
      lineTotal: priced?.lineTotal ?? 0,
      discount: priced?.discount ?? 0,
      priceAtAdd: item.unitPriceSnapshot,
      maxQuantity: check?.ok ? check.maxQuantity : item.listing.type === "PHYSICAL" ? availableStock(item) : 1,
      problem: check && !check.ok ? check.problem : null,
      flash: entry?.deal ? { flashSaleId: entry.deal.flashSaleId, name: entry.deal.name, discountBps: entry.deal.discountBps, endsAt: entry.deal.endsAt.toISOString(), capped: entry.deal.remaining !== null } : null,
    });
  }

  const problems = [
    ...quoteStores.flatMap((store) => store.items.filter((item) => item.problem).map((item) => `${item.title}: ${item.problem}`)),
    ...quoteStores.filter((store) => store.problem).map((store) => `${store.name}: ${store.problem}`),
  ];
  if (items.length === 0) problems.push("There is nothing to check out in this currency.");

  return {
    currency,
    stores: quoteStores,
    itemsSubtotal: pricing.itemsSubtotal,
    discountTotal: pricing.discountTotal,
    shippingTotal: pricing.shippingTotal,
    taxTotal: pricing.taxTotal,
    grandTotal: pricing.grandTotal,
    taxLabel: pricing.taxLabel,
    promo,
    needsAddress: items.some((item) => item.listing.type === "PHYSICAL"),
    problems,
    otherCurrencies,
  };
}

/** Human-friendly order number, e.g. MP-20261117-3FA9C2 (unique index retried on collision). */
export function orderNumber(now: Date): string {
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const suffix = randomBytes(4).toString("hex").toUpperCase().slice(0, 6);
  return `MP-${date}-${suffix}`;
}

export interface PlacedOrder {
  id: string;
  orderNumber: string;
  grandTotal: number;
  currency: string;
}

export interface PlaceOrderParams extends QuoteParams {
  buyerId: string;
  address: AddressSnapshot | null;
}

/**
 * Turn the quoted cart into an order: one sub-order per store, item
 * snapshots, stock held until `expiresAt`, and the promo redemption, all in
 * one transaction. Payment happens separately; unpaid orders expire.
 */
export async function placeOrder(params: PlaceOrderParams): Promise<PlacedOrder> {
  const quote = await buildQuote(params);
  if (quote.problems.length > 0) throw new CheckoutError(quote.problems[0] ?? "Your cart needs attention.");
  if (quote.needsAddress && !params.address) throw new CheckoutError("Add a delivery address.");

  const feeBps = await getSetting("platformFeeBps");
  const itemsById = new Map(params.cart.items.map((item) => [item.id, item]));
  const expiresAt = new Date(params.now.getTime() + CHECKOUT_HOLD_MINUTES * 60_000);
  const promoLookup = params.cart.promoCode && quote.promo?.applied ? await resolvePromo(params.cart.promoCode, quote.currency, params.buyerId, params.now) : null;
  const promoFundedBy = promoLookup?.ok ? (promoLookup.rule.storeId ? "store" : "platform") : null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const order = await tx.order.create({
            data: {
              orderNumber: orderNumber(params.now),
              buyerId: params.buyerId,
              currency: quote.currency,
              itemsSubtotal: quote.itemsSubtotal,
              shippingTotal: quote.shippingTotal,
              taxTotal: quote.taxTotal,
              discountTotal: quote.discountTotal,
              grandTotal: quote.grandTotal,
              status: "PENDING_PAYMENT",
              shippingAddress: params.address ? (params.address as unknown as Prisma.InputJsonObject) : undefined,
              promoCode: quote.promo?.applied ? quote.promo.code : null,
              expiresAt,
              metadata: promoFundedBy ? { promo: { code: quote.promo?.code ?? null, fundedBy: promoFundedBy } } : {},
            },
            select: { id: true, orderNumber: true, grandTotal: true, currency: true },
          });

          for (const store of quote.stores) {
            const first = store.items[0] ? itemsById.get(store.items[0].id) : undefined;
            const storeBps = first?.listing.store.commissionBpsOverride ?? feeBps;
            // The platform's fee is charged on what the store actually earns; a store-funded
            // promo lowers that base, a platform-funded promo does not.
            const storeDiscount = promoFundedBy === "store" ? store.discount : 0;
            const subOrder = await tx.subOrder.create({
              data: {
                orderId: order.id,
                storeId: store.storeId,
                status: "PENDING_PAYMENT",
                currency: quote.currency,
                itemsSubtotal: store.itemsSubtotal,
                shippingTotal: store.shipping,
                taxTotal: store.tax,
                discountTotal: store.discount,
                grandTotal: store.total,
                platformFee: applyBps(store.itemsSubtotal - storeDiscount, storeBps),
              },
              select: { id: true },
            });

            for (const quoted of store.items) {
              const item = itemsById.get(quoted.id);
              if (!item) continue;
              const orderItem = await tx.orderItem.create({
                data: {
                  subOrderId: subOrder.id,
                  listingId: item.listingId,
                  listingType: item.listing.type,
                  skuId: item.skuId,
                  serviceTierId: item.serviceTierId,
                  titleSnapshot: item.listing.title,
                  variantSnapshot: {
                    label: quoted.variantLabel,
                    skuCode: item.sku?.skuCode ?? null,
                    variantValues: (item.sku?.variantValues ?? {}) as Prisma.InputJsonValue,
                    serviceLevel: item.serviceTier?.level ?? null,
                    deliveryDays: item.serviceTier?.deliveryDays ?? null,
                    revisions: item.serviceTier?.revisions ?? null,
                    discount: quoted.discount,
                    flashSaleId: quoted.flash?.flashSaleId ?? null,
                    flashDiscountBps: quoted.flash?.discountBps ?? null,
                  },
                  quantity: quoted.quantity,
                  unitPrice: quoted.unitPrice,
                  lineTotal: quoted.lineTotal,
                },
                select: { id: true },
              });
              if (quoted.flash?.capped) await claimFlashUnits(tx, quoted.flash.flashSaleId, item.listingId, quoted.quantity, item.listing.title);
              if (item.listing.type === "PHYSICAL" && item.sku) {
                await reserveStock(tx, {
                  orderItemId: orderItem.id,
                  levels: item.sku.inventory.map((level) => ({ id: level.id, onHand: level.onHand, reserved: level.reserved, isDefault: level.warehouse.isDefault })),
                  quantity: quoted.quantity,
                  expiresAt,
                  label: item.listing.title,
                });
              }
            }
          }

          if (promoLookup?.ok && quote.discountTotal > 0) {
            await tx.promoRedemption.create({
              data: { promoCodeId: promoLookup.promoCodeId, orderId: order.id, userId: params.buyerId, amountOff: quote.discountTotal },
            });
          }
          return order;
        },
        { timeout: 30_000 },
      );
    } catch (error) {
      // Retry only an order-number collision (a unique violation on Order).
      const collision =
        typeof error === "object" && error !== null && "code" in error && error.code === "P2002" && attempt < 2 && !(error instanceof CheckoutError);
      if (collision) continue;
      throw error;
    }
  }
  throw new CheckoutError("We could not place your order. Try again.");
}
