export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function sanitizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

export function extractEmailFromString(text: string): string | null {
  const emailMatch = text.match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
  return emailMatch ? emailMatch[0] : null;
}

// Parse a RFC-2822 style address like: "John Smith <john@acme.com>" or just an email
export function parseNameAndEmail(
  input: string
): { name?: string; email: string } | null {
  if (!input) return null;
  // Try angle-bracket format
  const m = input.match(/\s*"?([^"<]*)"?\s*<\s*([^>\s]+)\s*>/);
  if (m) {
    const name = m[1]?.trim() || undefined;
    const email = m[2]?.trim();
    if (email)
      return { name: name && name.length > 0 ? name : undefined, email };
  }
  // Fallback: find an email inside
  const email = extractEmailFromString(input);
  if (email) {
    // Try to derive a display name from the prefix before the email
    const before = input.split(email)[0].trim().replace(/["']/g, "");
    const name = before && before.length > 1 ? before : undefined;
    return { name, email };
  }
  return null;
}

// Derive a company/organization name from an email domain (best-effort)
export function inferCompanyFromEmail(email: string): string | undefined {
  const at = email.indexOf("@");
  if (at === -1) return undefined;
  const domain = email.slice(at + 1).toLowerCase();
  // Skip common personal or generic domains
  const generic = [
    "gmail.com",
    "outlook.com",
    "hotmail.com",
    "yahoo.com",
    "icloud.com",
    "proton.me",
    "protonmail.com",
    "pm.me",
    "live.com",
  ];
  if (generic.includes(domain)) return undefined;
  // Remove common subdomains
  const cleaned = domain
    .replace(/^mail\./, "")
    .replace(/^mx\./, "")
    .replace(/^smtp\./, "")
    .replace(/^email\./, "")
    .replace(/^news\./, "")
    .replace(/^info\./, "");
  const parts = cleaned.split(".");
  if (parts.length < 2) return undefined;
  // Handle country TLDs, keep the second-level domain
  const sld = parts[parts.length - 2];
  if (!sld) return undefined;
  // Title-case and replace hyphens
  return sld
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

export function formatDisplayName(email: string, name?: string): string {
  if (name) return name;
  const localPart = email.split("@")[0];
  return localPart
    .replace(/[._-]/g, " ")
    .replace(/\b\w/g, (l) => l.toUpperCase());
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + "...";
}

export function extractTextFromHtml(html: string): string {
  // Simple HTML tag removal - for production, consider using a proper HTML parser
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&[^;]+;/g, "")
    .trim();
}

// Attempt to extract the signature block from an email body.
// Heuristics:
// - Look for common signature separators ("-- ", "—", "Regards,", "Best,", "Thanks,")
// - Use the last occurrence to target the sender's signature
export function extractSignatureBlock(text: string): string | null {
  if (!text) return null;
  const candidates = [
    /\n--\s*\n([\s\S]+)$/m, // standard signature delimiter
    /\n—+\s*\n([\s\S]+)$/m, // em-dash separator
    /\n(?:Regards|Best regards|Best|Thanks|Sincerely|Cheers|Kind regards)[,\s]*\n([\s\S]+)$/im,
  ];
  // Find the last matching block among patterns
  let matchText: string | null = null;
  for (const re of candidates) {
    const matches = [...text.matchAll(re)];
    if (matches.length > 0) {
      const last = matches[matches.length - 1];
      if (last && last[1]) {
        matchText = last[1].trim();
      }
    }
  }
  if (matchText) return matchText;
  // Fallback: take the last 6 lines as a potential signature if they contain typical cues
  const lines = text.split(/\r?\n/);
  const tail = lines.slice(-6).join("\n").trim();
  const cues = /(Inc\.|LLC|Ltd\.|Head|Office|Mobile|Phone|www\.|http|@|CEO|CTO|Manager|Director)/i;
  return cues.test(tail) ? tail : null;
}

// Extract a likely company/organization name from a signature block.
// Strategy:
// - Look for a line with org-like tokens (contains Inc., LLC, Ltd., or Title Case multi-word name without email/phone/URL)
// - Skip lines that are clearly contact details (phone, email, url, address numbers)
// - Return best candidate with a confidence score
export function extractCompanyFromSignature(signature: string): { company?: string; confidence: number } {
  if (!signature) return { confidence: 0 };
  const lines = signature
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const skip = /(@|\b(?:tel|phone|mobile|email|www|http|fax|skype)\b|\d{3,}|\d+-\d+|\d+\s+\w+\s+\w+)/i;
  const orgHints = /(Inc\.?|LLC|Ltd\.?|Company|Corporation|Corp\.?|GmbH|BV|SAS|SARL)/i;

  const candidates: Array<{ text: string; score: number }> = [];
  for (const line of lines) {
    if (skip.test(line)) continue;
    // Ignore email addresses or obvious URLs
    if (/^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/.test(line)) continue;
    if (/^https?:\/\//i.test(line)) continue;

    let score = 0;
    if (orgHints.test(line)) score += 2;
    // Title Case heuristic (e.g., "Acme Labs", "Blue Ocean Ventures")
    const words = line.split(/\s+/);
    const titleCaseWords = words.filter((w) => /^(?:[A-Z][a-z]+|[A-Z]{2,})$/.test(w));
    if (titleCaseWords.length >= Math.min(2, words.length)) score += 1;
    // Not a personal full name (two words only) unless with org hints
    if (words.length >= 2 && words.length <= 5) score += 0.5;
    // Penalize if line looks like a job title
    if (/\b(Engineer|Developer|Manager|Director|Lead|Consultant|Specialist|Head|Officer|VP|Chief)\b/i.test(line)) score -= 0.5;

    if (score > 0) candidates.push({ text: line.replace(/[,.;]+$/g, ""), score });
  }

  if (candidates.length === 0) return { confidence: 0 };
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  // Normalize company name (collapse spaces, capitalize words)
  const company = best.text
    .split(/\s+/)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
  return { company, confidence: Math.min(1, best.score / 3) };
}

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function isRecentDate(date: Date, hoursThreshold: number = 24): boolean {
  const now = new Date();
  const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);
  return diffInHours <= hoursThreshold;
}
