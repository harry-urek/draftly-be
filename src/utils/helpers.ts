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
