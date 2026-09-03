const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

// Shared auth/authorization helpers for YBS backend functions.
// Imported by functions via: import { normalizePhone, generateToken, createAuditLog } from "../../shared/auth.ts";

// Normalize a phone number to a comparable form.
// Egypt default: leading 0 -> +20. Strips spaces/dashes. Keeps leading + as-is.
export function normalizePhone(input) {
  if (!input) return "";
  let p = String(input).replace(/[\s\-()]/g, "");
  if (p.startsWith("+")) return p;
  if (p.startsWith("00")) return "+" + p.slice(2);
  if (p.startsWith("0")) return "+20" + p.slice(1);
  if (p.length === 10 && p[0] === "1") return "+20" + p; // Egypt mobile without 0
  return p;
}

// Cryptographically random single-use token.
export function generateToken() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID() + "-" + Date.now().toString(36);
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// Write an audit log entry (service role bypasses admin-only RLS).
export async function createAuditLog(base44, entry) {
  try {
    await db.asServiceRole.entities.AuditLog.create({
      actor_id: entry.actor_id || "system",
      actor_name: entry.actor_name || "System",
      actor_role: entry.actor_role || "",
      action: entry.action,
      entity_type: entry.entity_type,
      entity_id: entry.entity_id || "",
      entity_name: entry.entity_name || "",
      workspace_id: entry.workspace_id || "",
      metadata: entry.metadata || {},
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    // Audit logging must never break the primary operation.
    console.error("AuditLog write failed:", e.message);
  }
}

// Resolve a phone number (or email) to a user record. Returns null if not found.
export async function resolveUserByIdentifier(base44, identifier) {
  const id = String(identifier || "").trim();
  if (!id) return null;
  if (id.includes("@")) {
    const list = await db.asServiceRole.entities.User.filter({ email: id });
    return list && list[0] ? list[0] : null;
  }
  const normalized = normalizePhone(id);
  // Try normalized, then raw, then a looser match by trailing digits.
  let list = await db.asServiceRole.entities.User.filter({ phone: normalized });
  if (list && list[0]) return list[0];
  list = await db.asServiceRole.entities.User.filter({ phone: id });
  if (list && list[0]) return list[0];
  const digits = id.replace(/\D/g, "");
  if (digits.length >= 7) {
    const all = await db.asServiceRole.entities.User.list("-created_date", 500);
    const match = all.find((u) => u.phone && u.phone.replace(/\D/g, "").endsWith(digits));
    if (match) return match;
  }
  return null;
}