// Canonical phone normalization for YBS system.
// Consistently handles Egyptian domestic formats (010, 011, 012, 015, 0020, 20) and international numbers.

export function normalizePhone(input) {
  if (!input) return "";
  let p = String(input).trim().replace(/[\s\-().]/g, "");
  if (!p) return "";

  // If already starts with +, keep + and clean remainder
  if (p.startsWith("+")) {
    return "+" + p.slice(1).replace(/\D/g, "");
  }

  // Handle 00 international prefix -> +
  if (p.startsWith("00")) {
    return "+" + p.slice(2).replace(/\D/g, "");
  }

  // Egyptian local mobile numbers: 010..., 011..., 012..., 015... (11 digits)
  if (/^01[0125]\d{8}$/.test(p)) {
    return "+20" + p.slice(1);
  }

  // Egyptian numbers entered without leading 0: 10..., 11..., 12..., 15... (10 digits)
  if (/^1[0125]\d{8}$/.test(p)) {
    return "+20" + p;
  }

  // Country code 20 without + (e.g. 2010xxxxxxxx)
  if (/^201[0125]\d{8}$/.test(p)) {
    return "+" + p;
  }

  // Other domestic numbers starting with 0
  if (p.startsWith("0") && p.length >= 9 && p.length <= 11) {
    return "+20" + p.slice(1);
  }

  // If pure digits and length >= 9, default to international + format
  if (/^\d{9,15}$/.test(p)) {
    return "+" + p;
  }

  return p;
}