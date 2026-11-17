/**
 * Idempotent seed: the starter category tree. Safe to run repeatedly
 * (`npx prisma db seed`); existing categories are updated in place.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/client.js";

interface Node {
  name: string;
  slug: string;
  children?: Node[];
}

const TREE: Node[] = [
  {
    name: "Fashion",
    slug: "fashion",
    children: [
      { name: "Traditional clothing", slug: "traditional-clothing" },
      { name: "Scarves & shawls", slug: "scarves-shawls" },
      { name: "Shoes", slug: "shoes" },
      { name: "Bags & accessories", slug: "bags-accessories" },
    ],
  },
  {
    name: "Electronics",
    slug: "electronics",
    children: [
      { name: "Phones & tablets", slug: "phones-tablets" },
      { name: "Computers", slug: "computers" },
      { name: "Solar & power", slug: "solar-power" },
    ],
  },
  {
    name: "Home & living",
    slug: "home-living",
    children: [
      { name: "Handicrafts & baskets", slug: "handicrafts-baskets" },
      { name: "Kitchen", slug: "kitchen" },
      { name: "Furniture", slug: "furniture" },
    ],
  },
  {
    name: "Food & coffee",
    slug: "food-coffee",
    children: [
      { name: "Coffee", slug: "coffee" },
      { name: "Spices", slug: "spices" },
      { name: "Honey", slug: "honey" },
    ],
  },
  {
    name: "Digital products",
    slug: "digital-products",
    children: [
      { name: "Templates", slug: "templates" },
      { name: "E-books & study notes", slug: "ebooks-study-notes" },
      { name: "Software", slug: "software" },
      { name: "Graphics & fonts", slug: "graphics-fonts" },
    ],
  },
  {
    name: "Services",
    slug: "services",
    children: [
      { name: "Design & creative", slug: "design-creative" },
      { name: "Writing & translation", slug: "writing-translation" },
      { name: "Tutoring", slug: "tutoring" },
      { name: "Repairs & installation", slug: "repairs-installation" },
      { name: "Delivery & errands", slug: "delivery-errands" },
      { name: "Programming & tech", slug: "programming-tech" },
    ],
  },
];

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    let count = 0;
    const upsert = async (node: Node, parentId: string | null, parentPath: string, position: number): Promise<void> => {
      const path = parentPath ? `${parentPath}/${node.slug}` : node.slug;
      const category = await prisma.category.upsert({
        where: { slug: node.slug },
        create: { name: node.name, slug: node.slug, path, parentId, position, isActive: true },
        update: { name: node.name, path, parentId, position },
      });
      count += 1;
      for (const [index, child] of (node.children ?? []).entries()) {
        await upsert(child, category.id, path, index);
      }
    };
    for (const [index, node] of TREE.entries()) await upsert(node, null, "", index);
    console.log(`Seeded ${count} categories.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
