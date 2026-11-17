import type { Metadata } from "next";
import { prisma } from "@marketplace/database";
import { countryOptions } from "@marketplace/shared-types";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@marketplace/ui";
import { WarehouseForm } from "@/components/studio/warehouse-form";
import { requireStudio } from "@/lib/studio/context";

export const metadata: Metadata = { title: "Warehouses" };

export default async function WarehousesPage() {
  const { store } = await requireStudio("/seller/studio/warehouses");
  const [warehouses, storeRow] = await Promise.all([
    prisma.warehouse.findMany({ where: { storeId: store.id }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] }),
    prisma.store.findUniqueOrThrow({ where: { id: store.id }, select: { country: true } }),
  ]);
  const countries = countryOptions().map((country) => ({ value: country.code, label: country.name }));
  const names = new Map(countries.map((country) => [country.value, country.label]));

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Warehouses</h1>
        <p className="text-sm text-muted-foreground">Stock is tracked per warehouse. Buyers see the city and country orders ship from.</p>
        {warehouses.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">No warehouses yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {warehouses.map((warehouse) => (
              <li key={warehouse.id} className="rounded-md border border-border p-4 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{warehouse.name}</span>
                  {warehouse.isDefault ? <Badge tone="info">Default</Badge> : null}
                </div>
                <p className="text-muted-foreground">
                  {[warehouse.line1, warehouse.line2, warehouse.city, warehouse.state, warehouse.postalCode].filter(Boolean).join(", ")} ·{" "}
                  {names.get(warehouse.country) ?? warehouse.country}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Add a warehouse</CardTitle>
          <CardDescription>Where you keep stock and ship from.</CardDescription>
        </CardHeader>
        <CardContent>
          <WarehouseForm countries={countries} defaultCountry={storeRow.country} />
        </CardContent>
      </Card>
    </div>
  );
}
