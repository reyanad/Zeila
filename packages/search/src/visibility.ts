import type { Prisma } from "@marketplace/database";

/**
 * The single rule for what buyers may see: a live listing in an active store
 * that is not on vacation. Storefront queries and the search index both use it.
 */
export const publicListingWhere = {
  status: "ACTIVE",
  store: { status: "ACTIVE", vacationMode: false },
} satisfies Prisma.ListingWhereInput;
