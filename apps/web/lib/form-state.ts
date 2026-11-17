/** Result shape shared by form-backed server actions (`useActionState`). */
export interface FormState {
  status: "idle" | "success" | "error";
  message?: string;
  /** Field-level messages keyed by input name. */
  fields?: Record<string, string>;
}

export const IDLE_FORM_STATE: FormState = { status: "idle" };

export function formError(message: string, fields?: Record<string, string>): FormState {
  return { status: "error", message, fields };
}

export function formSuccess(message: string): FormState {
  return { status: "success", message };
}
