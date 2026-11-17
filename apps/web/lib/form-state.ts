/** Result shape shared by form-backed server actions (`useActionState`). */
export interface FormState {
  status: "idle" | "success" | "error";
  message?: string;
  /** Field-level messages keyed by input name. */
  fields?: Record<string, string>;
  /**
   * Submitted text values, echoed back on error. React resets uncontrolled
   * inputs after an action; rendering these as `defaultValue` restores them.
   */
  values?: Record<string, string>;
}

export const IDLE_FORM_STATE: FormState = { status: "idle" };

export function formError(message: string, fields?: Record<string, string>, values?: Record<string, string>): FormState {
  return { status: "error", message, fields, values };
}

export function formSuccess(message: string): FormState {
  return { status: "success", message };
}
