// Client-side phone normalization (mirrors the backend shared helper).
export function normalizePhone(input) {
  if (!input) return "";
  let p = String(input).replace(/[\s\-()]/g, "");
  if (p.startsWith("+")) return p;
  if (p.startsWith("00")) return "+" + p.slice(2);
  if (p.startsWith("0")) return "+20" + p.slice(1);
  if (p.length === 10 && p[0] === "1") return "+20" + p;
  return p;
}