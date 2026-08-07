const SOURCE_FIELDS = ["source", "sourceName", "callSource", "platform", "referral", "salesSource"] as const;

export function normalizeSourceName(value: unknown, fallback = "") {
  const label = String(value ?? "").trim();
  if (/^whats(?:\s*app)?$/i.test(label)) return "WhatsApp";
  return label || fallback;
}

export function normalizeSourceFields<T extends Record<string, unknown>>(input: T): T {
  const normalized = { ...input };
  for (const field of SOURCE_FIELDS) {
    if (field in normalized) normalized[field] = normalizeSourceName(normalized[field]);
  }
  return normalized;
}
