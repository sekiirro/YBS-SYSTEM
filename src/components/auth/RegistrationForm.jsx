import React, { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/utils/supabase";
import { normalizePhone } from "@/lib/phone";
import { RegistrationLinksService } from "@/services/registrationLinks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserPlus, Phone, Mail, Lock, Loader2, MailCheck, ArrowRight, Check, CalendarDays } from "lucide-react";

// Stable error-codes from the client-registration Edge Function map to
// user-facing messages. Backend codes are preferred over fragile string
// matching so every registration failure renders as an inline form error.
export const SIGNUP_ERRORS = {
  missing_token: "This registration link is missing its token. Please open the link again from the invitation.",
  link_unavailable: "Unable to verify the registration link. Please check your link and try again.",
  link_invalid: "This registration link is invalid or no longer active.",
  link_inactive: "This registration link is no longer active. Please ask the brand owner for a new link.",
  ip_unavailable:
    "Unable to determine your network location for registration protection. Please try again from the same browser/network.",
  ip_taken:
    "An account has already been registered from this network using this registration link. Please contact the brand owner if you believe this is an error.",
  reservation_failed: "Your registration could not be started. Please try again.",
  phone_check_failed: "Unable to verify your phone number. Please try again.",
  phone_taken: "This phone number is already registered to an account. Please sign in instead, or use a different phone number.",
  email_taken: "An account with this email address already exists. Please sign in instead.",
  weak_password: "Password must be at least 8 characters.",
  invalid_name: "Please enter a valid full name.",
  invalid_date_of_birth: "Please enter a valid date of birth that is not in the future.",
  registration_failed: "Unable to create your account. Please try again.",
  registration_network_error:
    "We could not reach the registration service. Please check your internet connection and try again.",
  registration_bad_response: "The registration service returned an unexpected response. Please try again.",
  bad_request: "Invalid registration request. Please try again.",
  server_not_configured: "The registration service is not configured. Please contact support.",
};

// Invitation-only registration form for the shared AuthShell right-side card.
// A valid invitation token is REQUIRED: without one the form refuses to
// submit (the scoped Edge Function additionally validates the token
// server-side, so hiding the UI alone is not the enforcement boundary).
export default function RegistrationForm({ workspace = null, joinToken = null, loginTarget = "/login" }) {
  const [form, setForm] = useState({
    full_name: "",
    date_of_birth: "",
    phone: "",
    email: "",
    password: "",
    confirm: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [signedUp, setSignedUp] = useState(false);
  const [signupEmail, setSignupEmail] = useState("");

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const isScopedLink = !!(workspace && workspace.package_tier);
  const today = localISODate();

  const submitForm = async (e) => {
    e.preventDefault();
    setError("");

    if (form.password !== form.confirm) {
      setError("Passwords do not match");
      return;
    }
    if (form.password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (!form.full_name.trim() || !form.date_of_birth || !form.phone.trim() || !form.email.trim()) {
      setError("Please fill all required fields");
      return;
    }
    if (!isValidDateOfBirth(form.date_of_birth, today)) {
      setError(SIGNUP_ERRORS.invalid_date_of_birth);
      return;
    }

    const normalizedPhone = normalizePhone(form.phone);
    if (!normalizedPhone || normalizedPhone.length < 9) {
      setError("Please enter a valid mobile phone number");
      return;
    }

    // Invitation-only guard: account creation is never available without the
    // validated invitation token. This mirrors the server-side requirement
    // (the Edge Function rejects token-less requests with missing_token).
    if (!joinToken || !joinToken.trim()) {
      setError(SIGNUP_ERRORS.missing_token);
      return;
    }

    setLoading(true);

    try {
      // Guard against phone collisions. profiles.phone is UNIQUE, and
      // handle_new_user() inserts the trainee profile during signup. Resolve
      // the phone up front so we can show a clear message instead of failing
      // deep inside the trigger.
      const { data: phoneRes, error: phoneErr } = await supabase.rpc("resolve_phone_identifier", {
        p_phone: normalizedPhone,
      });

      if (phoneErr) {
        console.error("Phone resolution error:", phoneErr);
        throw new Error("Unable to verify phone number. Please try again or use a different phone number.");
      }

      if (phoneRes && phoneRes.found) {
        throw new Error(
          "This phone number is already registered to an account. Please sign in instead, or use a different phone number."
        );
      }

      if (isScopedLink) {
        // Scoped package-registration link: route through the
        // client-registration Edge Function so that IP capture +
        // reservation, atomic account creation, and IP-release on
        // failure are handled server-side. handle_new_user() fires
        // automatically from admin.auth.admin.createUser().
        const nameParts = form.full_name.trim().split(/\s+/).filter(Boolean);
        const firstNamePart = nameParts[0] || "";
        const lastNamePart = nameParts.slice(1).join(" ") || "";

        // registerClient() THROWS a typed Error (error.code / error.status) for
        // every non-2xx backend response and RESOLVES with the success body
        // only — it never returns a `{ data, error }` tuple.
        const regData = await RegistrationLinksService.registerClient({
          token: joinToken,
          phone: normalizedPhone,
          email: form.email.trim(),
          password: form.password,
          first_name: firstNamePart,
          last_name: lastNamePart,
          date_of_birth: form.date_of_birth,
        });

        if (regData?.status !== "ok") {
          const backendCode = regData?.error?.code || regData?.reason || null;
          const backendMessage = regData?.error?.message || regData?.message;
          throw Object.assign(
            new Error(backendMessage || "Registration failed. Please try again."),
            backendCode ? { code: backendCode } : {}
          );
        }

        if (regData.needs_email_confirmation) {
          setSignupEmail(form.email.trim());
          setSignedUp(true);
        } else {
          window.location.href = "/pending";
        }
      } else {
        // Legacy workspace-join token (no package scope): direct Supabase Auth
        // signup carrying the validated link token through signup metadata.
        // The server-side handle_new_user() trigger resolves it back to the
        // workspace + coach + package — the client never submits
        // workspace_id/trainer/package.
        const meta = {
          full_name: form.full_name.trim(),
          phone: normalizedPhone,
          platform_role: "none",
          account_status: "pending_approval",
          date_of_birth: form.date_of_birth,
          join_token: joinToken,
        };

        const { data: authData, error: authErr } = await supabase.auth.signUp({
          email: form.email.trim().toLowerCase(),
          password: form.password,
          options: { data: meta },
        });

        if (authErr) {
          if (authErr.message.includes("already registered") || authErr.message.includes("unique")) {
            throw new Error("An account with this email address already exists. Please sign in instead.");
          }
          throw new Error(authErr.message);
        }

        const authUser = authData?.user;
        if (!authUser) {
          throw new Error("Unable to create account. Please try again.");
        }

        // Insert ClientApplication record into database.
        // NOTE: under email confirmation this runs as anon and is denied by
        // RLS — that is expected. The handle_new_user() trigger already
        // created the application server-side.
        const { error: appErr } = await supabase.from("client_applications").insert({
          user_id: authUser.id,
          applicant_name: form.full_name.trim(),
          applicant_phone: normalizedPhone,
          applicant_email: form.email.trim().toLowerCase(),
          date_of_birth: form.date_of_birth,
          status: "pending",
          submitted_at: new Date().toISOString(),
        });

        if (appErr) {
          console.warn("Application record notice:", appErr.message);
        }

        // Ensure profile is set to pending_approval (best-effort)
        await supabase.from("profiles").upsert({
          id: authUser.id,
          email: form.email.trim().toLowerCase(),
          phone: normalizedPhone,
          full_name: form.full_name.trim(),
          platform_role: "none",
          account_status: "pending_approval",
        });

        // With email confirmation enabled (mailer_autoconfirm=false), signUp()
        // returns a user but NO session. If we have a real session we can
        // route straight to /pending; otherwise show a confirmation prompt so
        // the trainee verifies their email before signing in.
        if (authData.session) {
          window.location.href = "/pending";
        } else {
          setSignupEmail(form.email.trim().toLowerCase());
          setSignedUp(true);
        }
      }
    } catch (err) {
      const code = err?.code;
      setError(
        (code && SIGNUP_ERRORS[code]) ||
          err.message ||
          "Registration failed. Please check your information and try again."
      );
    } finally {
      setLoading(false);
    }
  };

  if (signedUp) {
    // Inline panel success — the hero stays static, only the card content
    // changes, mirroring the original centered confirmation copy.
    return (
      <div className="registration-inline-success" role="status">
        <span className="registration-success-icon"><MailCheck aria-hidden="true" /></span>
        <p className="registration-kicker">Application received</p>
        <h3>Confirm your email.</h3>
        <p>We sent a confirmation link to <strong>{signupEmail}</strong>. Confirm it, then sign in. Your application is already with the YBS team.</p>
        <Link to={loginTarget} className="registration-primary-action">Go to Login <ArrowRight aria-hidden="true" /></Link>
      </div>
    );
  }

  return (
    <>
      {error && <div className="registration-error" role="alert">{error}</div>}
      <form onSubmit={submitForm} className="registration-form">
        <Field icon={UserPlus} label="Full name" htmlFor="signup-name">
          <Input id="signup-name" autoComplete="name" value={form.full_name} onChange={set("full_name")} placeholder="Your full name" required />
        </Field>
        <Field icon={CalendarDays} label="Date of birth" htmlFor="signup-date-of-birth">
          <Input id="signup-date-of-birth" type="date" autoComplete="bday" min="1900-01-01" max={today} value={form.date_of_birth} onChange={set("date_of_birth")} required />
        </Field>
        <Field icon={Phone} label="Phone" htmlFor="signup-phone">
          <Input id="signup-phone" type="tel" inputMode="tel" autoComplete="tel" value={form.phone} onChange={set("phone")} placeholder="+20 10x xxx xxxx" required />
        </Field>
        <Field icon={Mail} label="Email" htmlFor="signup-email">
          <Input id="signup-email" type="email" inputMode="email" autoComplete="email" value={form.email} onChange={set("email")} placeholder="you@example.com" required />
        </Field>
        <div className="registration-passwords">
          <Field icon={Lock} label="Password" htmlFor="signup-password">
            <Input id="signup-password" type="password" autoComplete="new-password" minLength={8} value={form.password} onChange={set("password")} placeholder="8+ characters" required />
          </Field>
          <Field icon={Lock} label="Confirm password" htmlFor="signup-confirm">
            <Input id="signup-confirm" type="password" autoComplete="new-password" minLength={8} value={form.confirm} onChange={set("confirm")} placeholder="Repeat password" required />
          </Field>
        </div>
        <p className="registration-assurance"><Check aria-hidden="true" /> Your package and workspace are securely linked to this invitation.</p>
        <Button type="submit" className="registration-submit" disabled={loading}>
          {loading ? <><Loader2 className="animate-spin" /> Submitting application…</> : <>Create Account <ArrowRight /></>}
        </Button>
      </form>
    </>
  );
}

function localISODate() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function isValidDateOfBirth(value, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "1900-01-01" || value > today) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day;
}

function Field({ icon: Icon, label, htmlFor, children }) {
  return (
    <div className="registration-field">
      <Label htmlFor={htmlFor}>{label}</Label>
      <div className="relative">
        <Icon className="registration-field-icon" aria-hidden="true" />
        <div className="[&>input]:pl-10">{children}</div>
      </div>
    </div>
  );
}
