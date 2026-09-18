import React, { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/utils/supabase";
import { normalizePhone } from "@/lib/phone";
import { RegistrationLinksService } from "@/services/registrationLinks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserPlus, Phone, Mail, Lock, Loader2, MailCheck, Building2 } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";

// Stable error-codes from the client-registration Edge Function map to
// user-facing messages. Backend codes are preferred over fragile string
// matching so every registration failure renders as an inline form error.
const SIGNUP_ERRORS = {
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
  registration_failed: "Unable to create your account. Please try again.",
  registration_network_error:
    "We could not reach the registration service. Please check your internet connection and try again.",
  registration_bad_response: "The registration service returned an unexpected response. Please try again.",
  bad_request: "Invalid registration request. Please try again.",
  server_not_configured: "The registration service is not configured. Please contact support.",
};

export default function ClientSignup({ workspace = null, joinToken = null }) {
  const [form, setForm] = useState({
    full_name: "",
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
    if (!form.full_name.trim() || !form.phone.trim() || !form.email.trim()) {
      setError("Please fill all required fields");
      return;
    }

    const normalizedPhone = normalizePhone(form.phone);
    if (!normalizedPhone || normalizedPhone.length < 9) {
      setError("Please enter a valid mobile phone number");
      return;
    }

    setLoading(true);

    try {
      // Defensive guard: a package-scoped link can only be submitted with its
      // token. Never invoke the Edge Function when the registration-link state
      // did not resolve — turn it into an inline form error instead of an
      // unhandled exception. The standalone /register page (non-scoped) has no
      // token and is unaffected.
      if (isScopedLink && (!joinToken || !joinToken.trim())) {
        throw Object.assign(new Error(SIGNUP_ERRORS.missing_token), {
          code: "missing_token",
        });
      }

      // 0. Guard against phone collisions. profiles.phone is UNIQUE, and
      //    handle_new_user() inserts the trainee profile during signup. If
      //    this phone already exists that INSERT aborts and Supabase Auth
      //    reports the opaque "Database error saving new user". Resolve the
      //    phone up front (same RPC the Login page already uses) so we can
      //    show a clear message instead of failing deep inside the trigger.
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
        // only — it never returns a `{ data, error }` tuple. Destructuring
        // `{ data, error }` here made regData undefined even on success, so the
        // success path fell through to the generic fallback and every scoped
        // registration showed "Registration failed. Please try again." Use the
        // resolved body directly and surface any structured error info through
        // the same SIGNUP_ERRORS mapping instead of a generic message.
        const regData = await RegistrationLinksService.registerClient({
          token: joinToken,
          phone: normalizedPhone,
          email: form.email.trim(),
          password: form.password,
          first_name: firstNamePart,
          last_name: lastNamePart,
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
        // Non-scoped registration: direct Supabase Auth signup.
        //    When the trainee arrived via a package-scoped client
        //    registration link, carry the validated link token through
        //    signup metadata. The server-side handle_new_user() trigger
        //    resolves it back to the workspace + coach + package — the
        //    client never submits workspace_id/trainer/package.
        const meta = {
          full_name: form.full_name.trim(),
          phone: normalizedPhone,
          platform_role: "none",
          account_status: "pending_approval",
        };
        if (joinToken) {
          meta.join_token = joinToken;
        }

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

        // 2. Insert ClientApplication record into database
        //    NOTE: under email confirmation this runs as anon and is
        //    denied by RLS — that is expected. The handle_new_user()
        //    trigger already created the application server-side.
        const { error: appErr } = await supabase.from("client_applications").insert({
          user_id: authUser.id,
          applicant_name: form.full_name.trim(),
          applicant_phone: normalizedPhone,
          applicant_email: form.email.trim().toLowerCase(),
          status: "pending",
          submitted_at: new Date().toISOString(),
        });

        if (appErr) {
          console.warn("Application record notice:", appErr.message);
        }

        // 3. Ensure profile is set to pending_approval (best-effort)
        await supabase.from("profiles").upsert({
          id: authUser.id,
          email: form.email.trim().toLowerCase(),
          phone: normalizedPhone,
          full_name: form.full_name.trim(),
          platform_role: "none",
          account_status: "pending_approval",
        });

        // 4. With email confirmation enabled (mailer_autoconfirm=false),
        //    signUp() returns a user but NO session. If we have a real
        //    session we can route straight to /pending; otherwise show a
        //    confirmation prompt so the trainee verifies their email
        //    before signing in.
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
    return (
      <AuthLayout
        brand
        title="Account Created"
        subtitle={workspace ? `Join ${workspace.workspace_name || workspace.brand_name}` : "Client Registration"}
        footer={
          <>
            Already confirmed?{" "}
            <Link to="/login" className="text-primary font-medium hover:underline">
              Sign in
            </Link>
          </>
        }
      >
        <div className="flex flex-col items-center text-center py-2">
          <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-4">
            <MailCheck className="w-7 h-7 text-emerald-400" />
          </div>
          <p className="text-[15px] font-semibold text-foreground">Confirm your email address</p>
          <p className="text-[13px] text-muted-foreground mt-1 max-w-sm">
            We sent a confirmation link to <strong className="text-foreground">{signupEmail}</strong>. Click it to
            activate your account, then sign in. Your registration is automatically submitted to the YBS team.
          </p>
          <Link
            to="/login"
            className="w-full mt-5 inline-flex h-11 items-center justify-center rounded-lg bg-primary text-primary-foreground text-[14px] font-medium hover:bg-primary/90"
          >
            Go to Sign In
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      icon={UserPlus}
      brand={!workspace}
      title={workspace ? workspace.workspace_name || workspace.brand_name || "Join" : "Create Client Account"}
      subtitle={workspace ? "Create your account to join this workspace" : "Request access to your coaching workspace"}
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="text-primary font-medium hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      {workspace && (
        <div className="mb-5 p-3 rounded-md bg-primary/5 border border-primary/15">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
              <Building2 className="w-4 h-4 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-foreground">Joining {workspace.workspace_name || workspace.brand_name}</p>
              {isScopedLink ? (
                <p className="text-[12px] text-muted-foreground mt-0.5">
                  Your selected package is <strong className="text-foreground">{workspace.package_name || `${workspace.package_tier} · ${workspace.package_duration} month${workspace.package_duration > 1 ? 's' : ''}`}</strong>. This cannot be changed during registration.
                </p>
              ) : (
                <p className="text-[12px] text-muted-foreground mt-0.5">
                  Your application will be submitted to this workspace automatically. You do not need to choose a brand or workspace.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
      <div className="mb-5 p-3 rounded-md bg-primary/5 border border-primary/15 text-[12px] text-muted-foreground">
        {isScopedLink ? (
          <>Your registration is submitted for the selected package ({workspace.package_name || `${workspace.package_tier} · ${workspace.package_duration} month${workspace.package_duration > 1 ? 's' : ''}`}). Once approved you will be onboarded to {workspace.workspace_name || workspace.brand_name || 'your workspace'} and can access your coaching portal.</>
        ) : (
          <>Your registration is reviewed by the YBS platform team. Once approved, you will be assigned to your workspace and can access your coaching portal.</>
        )}
      </div>
      {error && (
        <div className="mb-4 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-[13px]">
          {error}
        </div>
      )}
      <form onSubmit={submitForm} className="space-y-4">
        <Field icon={UserPlus} label="Full Name *">
          <Input value={form.full_name} onChange={set("full_name")} placeholder="Captain John" required />
        </Field>
        <Field icon={Phone} label="Phone *">
          <Input type="tel" value={form.phone} onChange={set("phone")} placeholder="+20 10x xxx xxxx" required />
        </Field>
        <Field icon={Mail} label="Email *">
          <Input type="email" value={form.email} onChange={set("email")} placeholder="you@example.com" required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field icon={Lock} label="Password *">
            <Input type="password" value={form.password} onChange={set("password")} placeholder="••••••••" required />
          </Field>
          <Field icon={Lock} label="Confirm *">
            <Input type="password" value={form.confirm} onChange={set("confirm")} placeholder="••••••••" required />
          </Field>
        </div>
        <Button type="submit" className="w-full h-12 font-medium" disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Submitting Application...
            </>
          ) : (
            "Create Account"
          )}
        </Button>
      </form>
    </AuthLayout>
  );
}

function Field({ icon: Icon, label, children }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-label">{label}</Label>
      <div className="relative">
        <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground z-10" aria-hidden="true" />
        <div className="[&>input]:pl-10">{children}</div>
      </div>
    </div>
  );
}