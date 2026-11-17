"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@marketplace/database";
import { fieldErrors, parseMoneyInput, shippingProfileSchema } from "@marketplace/shared-types";
import { authorize } from "@/lib/auth/session";
import { formError, formSuccess, type FormState } from "@/lib/form-state";

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export async function saveShippingProfileAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorize("store:manage");
  if (!auth.ok) return formError(auth.message);
  const store = await prisma.store.findUnique({ where: { sellerId: auth.user.id }, select: { id: true } });
  if (!store) return formError("Open your store first.");

  const names = ["domesticBase", "domesticPerKg", "internationalBase", "internationalPerKg", "freeOverDomestic", "handlingDays", "shipsAbroad"];
  const values = Object.fromEntries(names.map((name) => [name, text(formData, name)]));
  const money = (name: string) => parseMoneyInput(values[name] ?? "");
  const errors: Record<string, string> = {};
  const required = (name: string) => {
    const value = money(name);
    if (value === null) errors[name] = "Enter an amount like 150 or 12.50";
    return value ?? 0;
  };

  const shipsAbroad = values.shipsAbroad === "on";
  const candidate = {
    domestic: { base: required("domesticBase"), perKg: required("domesticPerKg") },
    international: shipsAbroad ? { base: required("internationalBase"), perKg: required("internationalPerKg") } : null,
    freeOverDomestic: values.freeOverDomestic ? money("freeOverDomestic") : null,
    handlingDays: Number.parseInt(values.handlingDays ?? "", 10),
  };
  if (values.freeOverDomestic && candidate.freeOverDomestic === null) errors.freeOverDomestic = "Enter an amount or leave it empty";
  const parsed = shippingProfileSchema.safeParse(candidate);
  if (!parsed.success || Object.keys(errors).length > 0) {
    const schemaErrors = parsed.success ? {} : fieldErrors(parsed.error);
    const mapped: Record<string, string> = { ...errors };
    if (schemaErrors.handlingDays) mapped.handlingDays = schemaErrors.handlingDays;
    if (!mapped.handlingDays && Number.isNaN(candidate.handlingDays)) mapped.handlingDays = "Enter a number of days";
    return formError("Check the highlighted fields.", mapped, values);
  }

  await prisma.store.update({ where: { id: store.id }, data: { shippingProfile: parsed.data } });
  revalidatePath("/seller/studio/shipping");
  return formSuccess("Shipping rates saved.");
}
