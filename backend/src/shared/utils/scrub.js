/**
 * Removes secrets and personal data from text before it leaves the server (error reports, logs).
 *
 * URLs of this app carry secrets in their path (QR tokens, invite/reset tokens, webhook keys, stream tickets), and
 * error messages can echo phone numbers, emails or provider keys. Everything below is replaced by a placeholder.
 */
const PATH_SECRETS = [
  /(\/api\/public\/qr\/orders\/)[^/?#\s]+/gi,
  /(\/api\/public\/qr\/)(?!inbox\b|orders\b)[^/?#\s]+/gi,
  /(\/qr\/orders\/)[^/?#\s]+/gi,
  /(\/qr\/)(?!orders\b|inbox\b|\[redacted\])[^/?#\s]+/gi,
  /(\/feedback\/(?:form\/)?)[^/?#\s]+/gi,
  /(\/invites?\/)[^/?#\s]+/gi,
  /(\/marketing\/sms\/(?:status|inbound)\/)[^/?#\s]+/gi,
  /(\/payments\/razorpay\/webhook\/)[^/?#\s]+/gi,
];
const QUERY_SECRETS = /([?&](?:token|ticket|key|code|otp|pin|password|secret|signature|hub\.verify_token|hub\.challenge)=)[^&#\s]*/gi;
const PATTERNS = [
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]"],
  [/\b(rzp_(?:live|test)_)[A-Za-z0-9]+/g, "$1[redacted]"],
  [/\bEAA[A-Za-z0-9]{20,}/g, "[redacted-token]"],
  [/\b(?:sk|pk|whsec)_[A-Za-z0-9]{12,}/g, "[redacted-key]"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
  // Phone and card-like digit runs (8+ digits, allowing spaces, dashes and a leading +).
  [/\+?\d(?:[\s-]?\d){7,}/g, "[number]"],
];

export const scrubText = (value) => {
  if (value === null || value === undefined) return value;
  let text = String(value);
  for (const pattern of PATH_SECRETS) text = text.replace(pattern, "$1[redacted]");
  text = text.replace(QUERY_SECRETS, "$1[redacted]");
  for (const [pattern, replacement] of PATTERNS) text = text.replace(pattern, replacement);
  return text;
};

/** A URL path without its query string, with path secrets removed. */
export const scrubPath = (url) => scrubText(String(url || "").split("?")[0]);
