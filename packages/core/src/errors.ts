/** A checkout problem the buyer can act on; `message` is safe to show. */
export class CheckoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CheckoutError";
  }
}
