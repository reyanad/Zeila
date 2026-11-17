import { Alert } from "@marketplace/ui";

/** Renders the outcome of a form action, or nothing while idle. */
export function FormMessage({ state }: { state: { status: "idle" | "success" | "error"; message?: string } }) {
  if (state.status === "idle" || !state.message) return null;
  return <Alert tone={state.status === "success" ? "success" : "danger"}>{state.message}</Alert>;
}
