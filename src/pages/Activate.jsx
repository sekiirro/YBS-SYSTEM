const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, Lock, Loader2, UserCheck, AlertCircle } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

export default function Activate() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const navigate = useNavigate();
  const [stage, setStage] = useState("verify"); // verify | form | otp | done
  const [inv, setInv] = useState(null);
  const [verifyError, setVerifyError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) { setVerifyError("No invitation token provided"); return; }
    (async () => {
      try {
        const res = await db.functions.invoke("verifyInvitation", { token });
        setInv(res.data);
        setEmail(res.data.client_email || "");
        setStage("form");
      } catch (err) {
        setVerifyError(err?.response?.data?.error || err?.message || "Invalid invitation");
      }
    })();
  }, [token]);

  const submitForm = async (e) => {
    e.preventDefault();
    setError("");
    if (password !== confirm) { setError("Passwords do not match"); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters"); return; }
    setLoading(true);
    try {
      await db.auth.register({ email, password });
      setStage("otp");
    } catch (err) {
      setError(err.message || "Registration failed — email may already be in use");
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async () => {
    setError("");
    setLoading(true);
    try {
      const result = await db.auth.verifyOtp({ email, otpCode: otp });
      if (result?.access_token) db.auth.setToken(result.access_token);
      await db.functions.invoke("acceptInvitation", { token });
      window.location.href = "/portal/dashboard";
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || "Activation failed");
    } finally {
      setLoading(false);
    }
  };

  if (stage === "verify") {
    return (
      <AuthLayout brand title="Activating" subtitle="Verifying your invitation">
        <div className="flex flex-col items-center py-6">
          {verifyError ? (
            <>
              <AlertCircle className="w-10 h-10 text-destructive mb-3" />
              <p className="text-[14px] font-medium text-foreground">Invitation Invalid</p>
              <p className="text-[13px] text-muted-foreground mt-1 text-center">{verifyError}</p>
              <Link to="/login" className="mt-4 text-primary text-sm hover:underline">Back to login</Link>
            </>
          ) : (
            <><Loader2 className="w-7 h-7 animate-spin text-primary" /><p className="text-[13px] text-muted-foreground mt-3">Verifying…</p></>
          )}
        </div>
      </AuthLayout>
    );
  }

  if (stage === "otp") {
    return (
      <AuthLayout brand title="Verify your email" subtitle={`We sent a code to ${email}`}>
        {error && <div className="mb-4 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-[13px]">{error}</div>}
        <div className="flex justify-center mb-6">
          <InputOTP maxLength={6} value={otp} onChange={setOtp} autoFocus autoComplete="one-time-code">
            <InputOTPGroup>{[0,1,2,3,4,5].map((i) => <InputOTPSlot key={i} index={i} />)}</InputOTPGroup>
          </InputOTP>
        </div>
        <Button className="w-full h-12 font-medium" onClick={verifyOtp} disabled={loading || otp.length < 6}>
          {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Activating...</> : "Activate Account"}
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout brand title="Activate your account" subtitle={inv ? `Welcome, ${inv.client_name}` : "Set your password"}>
      <div className="mb-5 p-3 rounded-md bg-primary/5 border border-primary/15 text-[12px] text-muted-foreground">
        Client code <span className="font-mono text-foreground">{inv?.client_code}</span> · Workspace <span className="text-foreground">{inv?.workspace_name}</span>
      </div>
      {error && <div className="mb-4 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-[13px]">{error}</div>}
      <form onSubmit={submitForm} className="space-y-4">
        <div className="space-y-2">
          <Label className="text-label">Email</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="pl-10 h-12" required />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label className="text-label">Password</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="pl-10 h-12" required />
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-label">Confirm</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="pl-10 h-12" required />
            </div>
          </div>
        </div>
        <Button type="submit" className="w-full h-12 font-medium" disabled={loading}>
          {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Continuing...</> : <><UserCheck className="w-4 h-4 mr-2" />Continue</>}
        </Button>
      </form>
    </AuthLayout>
  );
}