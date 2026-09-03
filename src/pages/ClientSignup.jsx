const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import React, { useState } from "react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserPlus, Phone, Mail, Lock, Loader2 } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { normalizePhone } from "@/lib/phone";

export default function ClientSignup() {
  const [step, setStep] = useState("form"); // form | otp
  const [form, setForm] = useState({ full_name: "", phone: "", email: "", password: "", confirm: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [otp, setOtp] = useState("");

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submitForm = async (e) => {
    e.preventDefault();
    setError("");
    if (form.password !== form.confirm) { setError("Passwords do not match"); return; }
    if (form.password.length < 8) { setError("Password must be at least 8 characters"); return; }
    if (!form.full_name || !form.phone || !form.email) { setError("Please fill all required fields"); return; }
    setLoading(true);
    try {
      await db.auth.register({ email: form.email, password: form.password });
      setStep("otp");
    } catch (err) {
      setError(err.message || "Registration failed — email may already be in use");
    } finally { setLoading(false); }
  };

  const verifyOtp = async () => {
    setError("");
    setLoading(true);
    try {
      const result = await db.auth.verifyOtp({ email: form.email, otpCode: otp });
      if (result?.access_token) db.auth.setToken(result.access_token);
      const me = await db.auth.me();
      await db.auth.updateMe({
        account_status: "pending_approval",
        platform_role: "none",
        phone: normalizePhone(form.phone),
      });
      await db.entities.ClientApplication.create({
        user_id: me.id,
        applicant_name: form.full_name,
        applicant_phone: normalizePhone(form.phone),
        applicant_email: form.email,
        status: "pending",
        submitted_at: new Date().toISOString(),
      });
      window.location.href = "/pending";
    } catch (err) {
      setError(err.message || "Verification failed");
    } finally { setLoading(false); }
  };

  const resend = async () => { try { await db.auth.resendOtp(form.email); } catch {} };

  if (step === "otp") {
    return (
      <AuthLayout brand title="Verify your email" subtitle={`We sent a code to ${form.email}`}>
        {error && <div className="mb-4 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-[13px]">{error}</div>}
        <div className="flex justify-center mb-6">
          <InputOTP maxLength={6} value={otp} onChange={setOtp} autoFocus autoComplete="one-time-code">
            <InputOTPGroup>{[0,1,2,3,4,5].map((i) => <InputOTPSlot key={i} index={i} />)}</InputOTPGroup>
          </InputOTP>
        </div>
        <Button className="w-full h-12 font-medium" onClick={verifyOtp} disabled={loading || otp.length < 6}>
          {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Verifying...</> : "Verify & Submit"}
        </Button>
        <p className="text-center text-sm text-muted-foreground mt-4">
          Didn't receive the code?{" "}
          <button onClick={resend} className="text-primary font-medium hover:underline">Resend</button>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      brand
      title="Create Client Account"
      subtitle="Request access to your coaching workspace"
      footer={<>Already have an account? <Link to="/login" className="text-primary font-medium hover:underline">Sign in</Link></>}
    >
      <div className="mb-5 p-3 rounded-md bg-primary/5 border border-primary/15 text-[12px] text-muted-foreground">
        Your registration is reviewed by the YBS team. Once approved, you'll be assigned to a workspace and can access your client portal.
      </div>
      {error && <div className="mb-4 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-[13px]">{error}</div>}
      <form onSubmit={submitForm} className="space-y-4">
        <Field icon={UserPlus} label="Full Name *">
          <Input value={form.full_name} onChange={set("full_name")} placeholder="John Doe" required />
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
          {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Submitting...</> : "Create Account"}
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