// Stripe — server-side only. Lazy init so missing env vars during build
// don't crash the bundler.

import Stripe from 'stripe';

let _stripe: Stripe | null = null;

export function stripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY not set');
  // Let the SDK pick its own latest pinned API version. Override here if you
  // need to lock to a specific one for compatibility:
  //   _stripe = new Stripe(key, {apiVersion: '2026-05-27.dahlia'});
  _stripe = new Stripe(key);
  return _stripe;
}

export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? '';
