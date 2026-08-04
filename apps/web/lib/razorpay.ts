/**
 * Shared client-side Razorpay Checkout types — no npm package exists for the
 * hosted checkout.js script (loaded via next/script wherever it's used), so
 * this is the one ambient `Window.Razorpay` declaration every caller shares.
 * Declared once here rather than per-file: TypeScript's global declaration
 * merging requires every `declare global { interface Window { ... } }` for
 * the same property to resolve to an identical type, so two call sites with
 * their own slightly-different local RazorpayCheckoutOptions (e.g. one
 * missing `modal`) would fail to compile together.
 */
export interface RazorpayCheckoutResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

export interface RazorpayCheckoutOptions {
  key: string;
  amount: number;
  currency: string;
  order_id: string;
  name: string;
  description?: string;
  handler: (response: RazorpayCheckoutResponse) => void;
  modal?: { ondismiss?: () => void };
  theme?: { color?: string };
}

export interface RazorpayCheckoutInstance {
  open: () => void;
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => RazorpayCheckoutInstance;
  }
}
