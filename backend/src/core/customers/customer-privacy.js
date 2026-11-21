import { createHmac, createHash } from 'node:crypto';
import env from '../../config/env.js';

const phone = value => String(value || '').replace(/\D/g, '');
const email = value => String(value || '').trim().toLowerCase();
export const contactDigest = (kind, value, secret = env.admincore.apiKey || env.auth.jwtSecret) => {
  const normalized = kind === 'phone' ? phone(value) : email(value);
  return normalized ? createHmac('sha256', secret).update(`${kind}:${normalized}`).digest('hex') : null;
};

// Stable IDs and keyed contact digests prevent old receipts from recreating erased CRM profiles.
export const erasureMarker = customer => ({ id: customer.id, customer_id: customer.id, business_id: customer.businessId,
  digest_key_id: createHash('sha256').update(env.admincore.apiKey || env.auth.jwtSecret).digest('hex').slice(0, 16),
  phone_digest: contactDigest('phone', customer.phone), email_digest: contactDigest('email', customer.email),
  erased_at: new Date().toISOString() });

const customerKeys = new Set(['customerId', 'customer_id']);
const phoneKeys = new Set(['phone', 'customerPhone', 'customer_phone', 'guest_phone', 'guestPhone']);
const emailKeys = new Set(['email', 'customerEmail', 'customer_email', 'guest_email', 'guestEmail']);
const privateKeys = new Set(['customerName', 'customer_name', 'guest_name', 'customerPhone', 'customer_phone',
  'customerEmail', 'customer_email', 'guest_phone', 'guest_email', 'guestPhone', 'guestEmail', 'guestName',
  'phone', 'email', 'address', 'customer_address', 'customerAddress', 'delivery_address', 'deliveryAddress', 'recipient_name', 'recipientName']);
export function matchesErasure(value, marker) {
  if (Array.isArray(value)) return value.some(item => matchesErasure(item, marker));
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, item]) =>
    (customerKeys.has(key) && item === marker.customer_id) ||
    (phoneKeys.has(key) && marker.phone_digest && contactDigest('phone', item) === marker.phone_digest) ||
    (emailKeys.has(key) && marker.email_digest && contactDigest('email', item) === marker.email_digest) ||
    (item && typeof item === 'object' && matchesErasure(item, marker)));
}
export function eraseReceipt(value) {
  if (Array.isArray(value)) return value.map(eraseReceipt);
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    privateKeys.has(key) ? (key.toLowerCase().includes('name') ? 'Erased customer' : null)
      : ['notes', 'note', 'special_requests', 'specialRequests', 'comment', 'delivery_instructions', 'deliveryInstructions', 'customer_notes', 'customerNotes'].includes(key) ? null : eraseReceipt(item)]));
}
