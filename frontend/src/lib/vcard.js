// A contact card (vCard 3.0) that phones can add to their contacts.
const vcardEscape = (value) => String(value || "").replace(/([\\;,])/g, "\\$1").replace(/\n/g, "\\n");

export const buildVCard = (card) => [
  "BEGIN:VCARD", "VERSION:3.0", `FN:${vcardEscape(card.title)}`, card.subtitle ? `TITLE:${vcardEscape(card.subtitle)}` : null,
  card.phone ? `TEL;TYPE=CELL:${card.phone}` : null, card.whatsapp && card.whatsapp !== card.phone ? `TEL;TYPE=WhatsApp:${card.whatsapp}` : null,
  card.email ? `EMAIL:${vcardEscape(card.email)}` : null, card.website ? `URL:${card.website}` : null,
  card.address ? `ADR;TYPE=WORK:;;${vcardEscape(card.address)};;;;` : null, card.instagram ? `X-SOCIALPROFILE;TYPE=instagram:https://instagram.com/${card.instagram}` : null,
  "END:VCARD",
].filter(Boolean).join("\r\n");
