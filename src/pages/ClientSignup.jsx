import React, { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/utils/supabase";
import { normalizePhone } from "@/lib/phone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserPlus, Phone, Mail, Lock, Loader2, MailCheck, Building2 } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";

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
      // 1. Register with Supabase Auth
      //    When the trainee arrived via a workspace registration link,
      //    carry the validated join token through signup metadata. The
      //    server-side handle_new_user() trigger resolves that token
      //    back to the workspace and creates the pending application
      //    for it — the client never submits a workspace_id.
      const { data: authData, error: authErr } = await supabase.auth.signUp({
        email: form.email.trim().toLowerCase(),
        password: form.password,
        options: {
          data: {
            full_name: form.full_name.trim(),
            phone: normalizedPhone,
            platform_role: "none",
            account_status: "pending_approval",
            ...(joinToken ? { join_token: joinToken } : {}),
          },
        },
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
    } catch (err) {
      setError(err.message || "Registration failed. Please check your information and try again.");
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
            <div>
              <p className="text-[13px] font-semibold text-foreground">Joining {workspace.workspace_name || workspace.brand_name}</p>
              <p className="text-[12px] text-muted-foreground mt-0.5">
                Your application will be submitted to this workspace automatically. You do not need to choose a brand or workspace.
              </p>
            </div>
          </div>
        </div>
      )}
      <div className="mb-5 p-3 rounded-md bg-primary/5 border border-primary/15 text-[12px] text-muted-foreground">
        Your registration is reviewed by the YBS platform team. Once approved, you will be assigned to your workspace and can access your coaching portal.
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