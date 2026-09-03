import React, { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/utils/supabase";
import { normalizePhone } from "@/lib/phone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserPlus, Phone, Mail, Lock, Loader2 } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";

export default function ClientSignup() {
  const [form, setForm] = useState({
    full_name: "",
    phone: "",
    email: "",
    password: "",
    confirm: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
      const { data: authData, error: authErr } = await supabase.auth.signUp({
        email: form.email.trim().toLowerCase(),
        password: form.password,
        options: {
          data: {
            full_name: form.full_name.trim(),
            phone: normalizedPhone,
            platform_role: "none",
            account_status: "pending_approval",
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

      // 3. Ensure profile is set to pending_approval
      await supabase.from("profiles").upsert({
        id: authUser.id,
        email: form.email.trim().toLowerCase(),
        phone: normalizedPhone,
        full_name: form.full_name.trim(),
        platform_role: "none",
        account_status: "pending_approval",
      });

      // 4. Redirect to pending approval screen
      window.location.href = "/pending";
    } catch (err) {
      setError(err.message || "Registration failed. Please check your information and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      brand
      title="Create Client Account"
      subtitle="Request access to your coaching workspace"
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="text-primary font-medium hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <div className="mb-5 p-3 rounded-md bg-primary/5 border border-primary/15 text-[12px] text-muted-foreground">
        Your registration is reviewed by the YBS platform team. Once approved, you will be assigned to a workspace and can access your coaching portal.
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