import type { Prisma } from "@marketplace/database";
import { CARRIERS, isCarrierCode } from "@marketplace/shared-types";

const STATUS_LABEL: Record<string, string> = {
  LABEL_CREATED: "Label created",
  IN_TRANSIT: "On the way",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
  DELIVERY_FAILED: "Delivery attempt failed",
  RETURNED: "Returned to sender",
};

interface EventView {
  at: string;
  status: string;
  note: string | null;
}

function events(value: Prisma.JsonValue): EventView[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    return typeof record.at === "string" && typeof record.status === "string" ? [{ at: record.at, status: record.status, note: typeof record.note === "string" ? record.note : null }] : [];
  });
}

export interface ShipmentView {
  id: string;
  carrier: string;
  trackingNumber: string | null;
  trackingUrl: string | null;
  status: string;
  events: Prisma.JsonValue;
}

/** Carrier, tracking link and the event history of one shipment. */
export function Tracking({ shipment }: { shipment: ShipmentView }) {
  const carrier = isCarrierCode(shipment.carrier) ? CARRIERS[shipment.carrier].name : shipment.carrier;
  return (
    <div className="flex flex-col gap-2 rounded-md bg-muted/60 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{STATUS_LABEL[shipment.status] ?? shipment.status}</span>
        <span className="text-xs text-muted-foreground">
          {carrier}
          {shipment.trackingNumber ? (
            <>
              {" · "}
              {shipment.trackingUrl ? (
                <a href={shipment.trackingUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
                  {shipment.trackingNumber}
                </a>
              ) : (
                shipment.trackingNumber
              )}
            </>
          ) : null}
        </span>
      </div>
      <ol className="flex flex-col gap-1 text-xs text-muted-foreground">
        {events(shipment.events)
          .slice()
          .reverse()
          .map((event, index) => (
            <li key={`${event.at}-${index}`}>
              {new Date(event.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}: {STATUS_LABEL[event.status] ?? event.status}
              {event.note ? ` (${event.note})` : ""}
            </li>
          ))}
      </ol>
    </div>
  );
}
