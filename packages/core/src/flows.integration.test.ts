import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@marketplace/database";
import { escrowReconciliation } from "./admin";
import { attributeOrder, joinAffiliateProgram, settleReferrals } from "./affiliates";
import { addToCart, getOrCreateCart } from "./cart";
import { placeOrder } from "./checkout";
import { acceptDisputeProposal, openDispute, postDisputeMessage } from "./disputes";
import { reconcilePayouts, releaseEligibleEscrows, transferPendingPayouts } from "./escrow";
import { encryptAtRest } from "./field-crypto";
import type { GatewayTransaction, PaymentGateway, RefundInit, TransferInit } from "./gateway";
import { claimFlashUnits, createFlashSale } from "./flash-sales";
import { trialBalance } from "./ledger";
import { activateLicense } from "./licenses";
import { openConversation, postMessage } from "./messaging";
import { confirmPayment, startCheckout } from "./payments";
import { completeReturn, decideReturn, requestReturn } from "./returns";
import { approveDelivery, startWork, submitDelivery } from "./services";
import { addTrackingEvent, shipSubOrder } from "./shipping";

/**
 * End-to-end money flows against PostgreSQL: checkout, payment, escrow,
 * fulfilment, returns, disputes, payouts and the ledger, checking after each
 * step that the books balance and match the order records.
 */

const run = Date.now().toString(36);
const now = new Date();

/** In-memory stand-in for Chapa: charges are "paid" by the test, refunds and transfers are recorded. */
const charges = new Map<string, GatewayTransaction>();
const refundsSent: RefundInit[] = [];
const transfersSent: TransferInit[] = [];
const gateway: PaymentGateway = {
  name: "chapa",
  initializeCheckout: async (input) => ({ checkoutUrl: `https://checkout.chapa.test/${input.txRef}` }),
  verifyTransaction: async (txRef) => charges.get(txRef) ?? { status: "not_found", amount: 0, currency: "", reference: null, method: null, paidAt: null },
  refund: async (input) => {
    refundsSent.push(input);
    return { refundId: `rf_${run}_${refundsSent.length}`, state: "PROCESSING" };
  },
  verifyRefund: async () => ({ state: "REFUNDED", amount: null }),
  transfer: async (input) => {
    transfersSent.push(input);
    return { kind: "queued", transferId: `tr_${run}_${transfersSent.length}` };
  },
  verifyTransfer: async () => ({ status: "success", message: null }),
  listBanks: async () => [{ id: 946, name: "Commercial Bank of Ethiopia", accountLength: 13, currency: "ETB", isMobileMoney: false }],
};
const urls = { returnUrl: "https://zeila.test/return", callbackUrl: "https://zeila.test/callback" };

/** Pay an order the way production does: hosted checkout, then Chapa's verify endpoint confirms it. */
async function pay(orderId: string): Promise<void> {
  const { checkoutUrl } = await startCheckout(gateway, orderId, urls, new Date());
  const txRef = checkoutUrl.split("/").pop() ?? "";
  const payment = await prisma.payment.findUniqueOrThrow({ where: { providerRef: txRef } });
  charges.set(txRef, { status: "success", amount: payment.amount, currency: payment.currency, reference: `CH${txRef}`, method: "telebirr", paidAt: new Date() });
  expect(await confirmPayment(gateway, txRef, new Date())).toBe("paid");
}

const ids = {} as {
  buyer: string;
  affiliateUser: string;
  seller: string;
  servicesSeller: string;
  store: string;
  servicesStore: string;
  physical: string;
  sku: string;
  level: string;
  digital: string;
  service: string;
  tier: string;
};

async function booksBalance(): Promise<void> {
  for (const row of await trialBalance()) expect(row.difference, `trial balance ${row.currency}`).toBe(0);
  for (const row of await escrowReconciliation()) {
    expect(row.ledgerEscrow, `escrow ${row.currency}`).toBe(row.recordsEscrow);
    expect(row.ledgerPayable, `payable ${row.currency}`).toBe(row.recordsPayable);
  }
}

async function checkout(buyerId: string, lines: Array<{ listingId: string; skuId?: string; serviceTierId?: string; quantity: number }>) {
  const cart = await getOrCreateCart({ userId: buyerId });
  await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
  for (const line of lines) await addToCart(cart.id, line);
  const fresh = await getOrCreateCart({ userId: buyerId });
  const order = await placeOrder({
    cart: fresh,
    currency: "ETB",
    buyerId,
    address: { addressId: null, recipient: "Abebe Kebede", phone: "+251911000000", line1: "Bole Road 12", line2: "", city: "Addis Ababa", state: "", postalCode: "", country: "ET" },
    destinationCountry: "ET",
    taxCountry: "ET",
    now: new Date(),
  });
  await pay(order.id);
  return order;
}

beforeAll(async () => {
  const user = (label: string, role: "BUYER" | "SELLER") =>
    prisma.user.create({ data: { email: `${label}-${run}@test.zeila`, name: label, role, emailVerified: now, country: "ET" }, select: { id: true } });
  ids.buyer = (await user("buyer", "BUYER")).id;
  ids.affiliateUser = (await user("affiliate", "BUYER")).id;
  ids.seller = (await user("seller", "SELLER")).id;
  ids.servicesSeller = (await user("designer", "SELLER")).id;
  const store = (sellerId: string, slug: string) =>
    prisma.store.create({
      data: {
        sellerId,
        slug: `${slug}-${run}`,
        name: `${slug} ${run}`,
        status: "ACTIVE",
        country: "ET",
        currency: "ETB",
        payoutsEnabled: true,
        payoutBankId: 946,
        payoutBankName: "Commercial Bank of Ethiopia",
        payoutAccountName: `Seller ${slug}`,
        payoutAccountNumber: encryptAtRest("1000123456789"),
        payoutAccountLast4: "6789",
        shippingProfile: { domestic: { base: 15_000, perKg: 5_000 }, international: null, freeOverDomestic: null, handlingDays: 2 },
      },
      select: { id: true },
    });
  ids.store = (await store(ids.seller, "coffee")).id;
  ids.servicesStore = (await store(ids.servicesSeller, "design")).id;
  const warehouse = await prisma.warehouse.create({ data: { storeId: ids.store, name: "Main", line1: "Merkato", city: "Addis Ababa", country: "ET", isDefault: true } });

  const listing = (storeId: string, type: "PHYSICAL" | "DIGITAL" | "SERVICE", title: string, price: number) =>
    prisma.listing.create({ data: { storeId, type, status: "ACTIVE", title, slug: `${title.toLowerCase().replace(/\W+/g, "-")}-${run}`, description: title, currency: "ETB", minPrice: price, maxPrice: price, publishedAt: now }, select: { id: true } });
  ids.physical = (await listing(ids.store, "PHYSICAL", "Yirgacheffe beans", 120_000)).id;
  const sku = await prisma.sku.create({ data: { listingId: ids.physical, skuCode: `YRG-${run}`, price: 120_000, weightGrams: 500 } });
  ids.sku = sku.id;
  ids.level = (await prisma.inventoryLevel.create({ data: { warehouseId: warehouse.id, skuId: sku.id, onHand: 10 } })).id;
  ids.digital = (await listing(ids.store, "DIGITAL", "Brewing guide", 30_000)).id;
  await prisma.digitalAsset.create({ data: { listingId: ids.digital, price: 30_000, vaultKey: `digital/${run}/guide.bin`, fileName: "guide.pdf", sizeBytes: BigInt(1_000), checksumSha256: "0".repeat(64), licenseTemplate: "ZEILA-{{BLOCK4}}-{{BLOCK4}}", activationsLimit: 1 } });
  ids.service = (await listing(ids.servicesStore, "SERVICE", "Logo design", 500_000)).id;
  ids.tier = (await prisma.serviceTier.create({ data: { listingId: ids.service, level: "BASIC", title: "Basic", description: "One concept", price: 500_000, deliveryDays: 5, revisions: 1 } })).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("checkout, payment and escrow", () => {
  let orderId = "";

  it("places a mixed order, holds stock and charges shipping", async () => {
    const affiliateCode = await joinAffiliateProgram(ids.affiliateUser);
    const order = await checkout(ids.buyer, [
      { listingId: ids.physical, skuId: ids.sku, quantity: 2 },
      { listingId: ids.digital, quantity: 1 },
    ]);
    orderId = order.id;
    expect(order.grandTotal).toBe(2 * 120_000 + 30_000 + 15_000);
    expect(await attributeOrder(order.id, ids.buyer, affiliateCode)).toBe(false); // already paid: attribution happens before payment
    const level = await prisma.inventoryLevel.findUniqueOrThrow({ where: { id: ids.level } });
    expect(level.onHand).toBe(8);
    expect(level.reserved).toBe(0);
  });

  it("creates escrow and delivers the download with a working licence", async () => {
    const subOrder = await prisma.subOrder.findFirstOrThrow({ where: { orderId }, include: { escrow: true, items: { include: { licenseKey: true } } } });
    expect(subOrder.escrow?.status).toBe("HELD");
    const digital = subOrder.items.find((item) => item.listingType === "DIGITAL");
    expect(digital?.status).toBe("DELIVERED");
    const key = digital?.licenseKey?.key ?? "";
    expect(key).toMatch(/^ZEILA-/);
    expect((await activateLicense(key, "device-one-fingerprint", "Laptop", null, new Date())).ok).toBe(true);
    const second = await activateLicense(key, "device-two-fingerprint", "Phone", null, new Date());
    expect(second.ok ? null : second.code).toBe("LIMIT_REACHED");
    await booksBalance();
  });

  it("ships, delivers, takes a partial return and releases the rest", async () => {
    const subOrder = await prisma.subOrder.findFirstOrThrow({ where: { orderId }, select: { id: true, items: { select: { id: true, listingType: true } } } });
    await shipSubOrder(ids.seller, subOrder.id, { carrier: "dhl", trackingNumber: "1234567890", service: null }, new Date());
    const shipment = await prisma.shipment.findFirstOrThrow({ where: { subOrderId: subOrder.id } });
    expect(shipment.trackingUrl).toContain("1234567890");
    await addTrackingEvent(ids.seller, shipment.id, { status: "DELIVERED", location: null, note: null }, new Date());
    expect((await prisma.subOrder.findUniqueOrThrow({ where: { id: subOrder.id } })).status).toBe("DELIVERED");

    const physicalItem = subOrder.items.find((item) => item.listingType === "PHYSICAL");
    const rmaId = await requestReturn(ids.buyer, physicalItem?.id ?? "", { reason: "damaged", details: "One bag arrived torn", quantity: 1 }, new Date());
    expect((await prisma.escrow.findUniqueOrThrow({ where: { subOrderId: subOrder.id } })).status).toBe("FROZEN");
    await decideReturn(ids.seller, rmaId, true, "Send it back to our Merkato shop", new Date());
    await completeReturn(gateway, ids.seller, rmaId, { refundAmount: 120_000, restock: true }, new Date());
    const escrow = await prisma.escrow.findUniqueOrThrow({ where: { subOrderId: subOrder.id } });
    expect(escrow.status).toBe("HELD");
    expect(escrow.refunded).toBeGreaterThan(0);
    expect((await prisma.inventoryLevel.findUniqueOrThrow({ where: { id: ids.level } })).onHand).toBe(9);
    await booksBalance();

    const released = await releaseEligibleEscrows(new Date(Date.now() + 30 * 86_400_000));
    expect(released).toBeGreaterThanOrEqual(1);
    const after = await prisma.escrow.findUniqueOrThrow({ where: { subOrderId: subOrder.id } });
    expect(after.status).toBe("RELEASED");
    expect(after.released).toBe(after.amount - after.refunded);
    await booksBalance();
  });

  it("pays released money to the seller's account by Chapa transfer", async () => {
    const subOrder = await prisma.subOrder.findFirstOrThrow({ where: { orderId }, select: { id: true, escrow: { select: { released: true } } } });
    const before = transfersSent.length;
    expect(await transferPendingPayouts(gateway, new Date())).toBeGreaterThanOrEqual(1);
    const sent = transfersSent.slice(before).find((transfer) => transfer.amount === subOrder.escrow?.released);
    expect(sent?.accountNumber).toBe("1000123456789");
    expect(sent?.bankId).toBe(946);
    const escrow = await prisma.escrow.findUniqueOrThrow({ where: { subOrderId: subOrder.id }, include: { payout: true } });
    expect(escrow.payout?.status).toBe("IN_TRANSIT");
    await booksBalance();
    // A second run must not pay the same escrow again.
    const again = transfersSent.length;
    await transferPendingPayouts(gateway, new Date());
    expect(transfersSent.slice(again).some((transfer) => transfer.reference === escrow.payout?.reference)).toBe(false);

    await reconcilePayouts(gateway, new Date(Date.now() + 5 * 60_000));
    expect((await prisma.payout.findUniqueOrThrow({ where: { id: escrow.payoutId ?? "" } })).status).toBe("PAID");
    await booksBalance();
  });

  it("refunds a payment that arrives after the order was cancelled", async () => {
    const order = await placeOrder({
      cart: await (async () => {
        const cart = await getOrCreateCart({ userId: ids.buyer });
        await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
        await addToCart(cart.id, { listingId: ids.digital, quantity: 1 });
        return getOrCreateCart({ userId: ids.buyer });
      })(),
      currency: "ETB",
      buyerId: ids.buyer,
      address: null,
      destinationCountry: null,
      taxCountry: "ET",
      now: new Date(),
    });
    const { checkoutUrl } = await startCheckout(gateway, order.id, urls, new Date());
    const txRef = checkoutUrl.split("/").pop() ?? "";
    await prisma.order.update({ where: { id: order.id }, data: { status: "CANCELLED" } });
    charges.set(txRef, { status: "success", amount: order.grandTotal, currency: "ETB", reference: `CH${txRef}`, method: "cbebirr", paidAt: new Date() });
    const before = refundsSent.length;
    expect(await confirmPayment(gateway, txRef, new Date())).toBe("refunded");
    expect(refundsSent.slice(before).map((refund) => refund.amount)).toEqual([order.grandTotal]);
    expect((await prisma.payment.findUniqueOrThrow({ where: { providerRef: txRef } })).status).toBe("REFUNDED");
    // Confirming again must not send a second refund.
    expect(await confirmPayment(gateway, txRef, new Date())).toBe("refunded");
    expect(refundsSent.length).toBe(before + 1);
  });
});

describe("services, disputes and referrals", () => {
  it("runs a service order through delivery, a dispute and a settlement", async () => {
    const affiliateCode = await joinAffiliateProgram(ids.affiliateUser);
    const cart = await getOrCreateCart({ userId: ids.buyer });
    await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    await addToCart(cart.id, { listingId: ids.service, serviceTierId: ids.tier, quantity: 1 });
    const order = await placeOrder({ cart: await getOrCreateCart({ userId: ids.buyer }), currency: "ETB", buyerId: ids.buyer, address: null, destinationCountry: null, taxCountry: "ET", now: new Date() });
    expect(await attributeOrder(order.id, ids.buyer, affiliateCode)).toBe(true);
    await pay(order.id);

    const item = await prisma.orderItem.findFirstOrThrow({ where: { subOrder: { orderId: order.id } }, include: { milestones: true } });
    expect(item.milestones[0]?.status).toBe("FUNDED");
    await startWork(ids.servicesSeller, item.id, new Date());
    await submitDelivery(ids.servicesSeller, item.id, { message: "Three concepts attached", files: [] }, new Date());

    const disputeId = await openDispute(ids.buyer, { subOrderId: item.subOrderId, orderItemId: item.id, reason: "QUALITY", description: "The concepts do not follow the brief at all.", attachments: [] }, new Date());
    expect((await prisma.escrow.findUniqueOrThrow({ where: { subOrderId: item.subOrderId } })).status).toBe("FROZEN");
    await postDisputeMessage(ids.servicesSeller, false, disputeId, { body: "I can refund part of it.", attachments: [], proposal: 200_000 }, new Date());
    await acceptDisputeProposal(gateway, ids.buyer, disputeId, new Date());
    const dispute = await prisma.dispute.findUniqueOrThrow({ where: { id: disputeId } });
    expect(dispute.status).toBe("RESOLVED_SPLIT");
    const escrow = await prisma.escrow.findUniqueOrThrow({ where: { subOrderId: item.subOrderId } });
    expect(escrow.status).toBe("RELEASED");
    await booksBalance();

    const settled = await settleReferrals(new Date());
    expect(settled.approved).toBeGreaterThanOrEqual(1);
    const referral = await prisma.referral.findFirstOrThrow({ where: { orderId: order.id } });
    expect(referral.status).toBe("APPROVED");
    expect(referral.commission).toBeGreaterThan(0);
    await booksBalance();
  });

  it("approves delivered work and pays the seller", async () => {
    const cart = await getOrCreateCart({ userId: ids.buyer });
    await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    await addToCart(cart.id, { listingId: ids.service, serviceTierId: ids.tier, quantity: 1 });
    const order = await placeOrder({ cart: await getOrCreateCart({ userId: ids.buyer }), currency: "ETB", buyerId: ids.buyer, address: null, destinationCountry: null, taxCountry: "ET", now: new Date() });
    await pay(order.id);
    const item = await prisma.orderItem.findFirstOrThrow({ where: { subOrder: { orderId: order.id } } });
    await startWork(ids.servicesSeller, item.id, new Date());
    await submitDelivery(ids.servicesSeller, item.id, { message: "Final files", files: [] }, new Date());
    await approveDelivery(ids.buyer, item.id, new Date());
    const subOrder = await prisma.subOrder.findUniqueOrThrow({ where: { id: item.subOrderId }, include: { escrow: true, items: { include: { milestones: true } } } });
    expect(subOrder.status).toBe("COMPLETED");
    expect(subOrder.escrow?.status).toBe("RELEASED");
    expect(subOrder.items[0]?.milestones[0]?.status).toBe("RELEASED");
    await booksBalance();
  });
});

describe("messaging and flash sales", () => {
  it("screens contact details out of chat", async () => {
    const conversationId = await openConversation(ids.buyer, ids.store, { listingId: ids.physical });
    expect(await openConversation(ids.buyer, ids.store, {})).toBe(conversationId);
    const posted = await postMessage(ids.buyer, conversationId, "Call me on 0911 234 567, I can pay with telebirr", new Date());
    expect(posted.flagged).toBe(true);
    const message = await prisma.message.findUniqueOrThrow({ where: { id: posted.id } });
    expect(message.body).not.toContain("234");
  });

  it("never sells more sale units than the cap", async () => {
    const saleId = await createFlashSale(ids.seller, { name: "Flash beans", discountBps: 2_000, startsAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 3_600_000), listings: [{ listingId: ids.physical, quantityCap: 1 }] }, new Date());
    await prisma.$transaction((tx) => claimFlashUnits(tx, saleId, ids.physical, 1, "beans"));
    await expect(prisma.$transaction((tx) => claimFlashUnits(tx, saleId, ids.physical, 1, "beans"))).rejects.toThrow(/sold out/);
  });
});
