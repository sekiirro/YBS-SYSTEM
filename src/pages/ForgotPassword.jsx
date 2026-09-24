import React, { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/utils/supabase";
import { normalizePhone } from "@/lib/phone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, Loader2, ArrowLeft } from "lucide-react";
import AuthShell from "@/components/auth/AuthShell";

export default function ForgotPassword() {
  const [identifier, setIdentifier] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      let targetEmail = identifier.trim();

      // Phone-first resolution if user enters phone
      if (targetEmail && !targetEmail.includes("@")) {
        const normalized = normalizePhone(targetEmail);
        const { data: res } = await supabase.rpc("resolve_phone_identifier", {
          p_phone: normalized,
        });
        if (res?.email) {
          targetEmail = res.email;
        }
      }

      if (targetEmail && targetEmail.includes("@")) {
        await supabase.auth.resetPasswordForEmail(targetEmail, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
      }
    } catch {
      // Always show success regardless for user security
    } finally {
      setLoading(false);
      setSent(true);
    }
  };

  return (
    <AuthShell
      workspaceName="Coaching OS"
      loginTarget="/login"
      panelKicker="Account recovery"
      panelTitle="Reset password"
      panelTitleId="forgot-password-heading"
      panelSub="We'll send you instructions to reset your password."
    >
      {sent ? (
        <p className="registration-assurance" role="status" style={{ marginTop: 25 }}>
          If an account exists with that phone number or email, password reset instructions have been sent.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="registration-form">
          <div className="registration-field">
            <Label htmlFor="forgot-identifier">Phone Number or Email</Label>
            <div className="relative">
              <Mail className="registration-field-icon" aria-hidden="true" />
              <Input
                id="forgot-identifier"
                type="text"
                autoFocus
                placeholder="+20 10x xxx xxxx or you@example.com"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className="pl-10"
                required
              />
            </div>
          </div>
          <Button type="submit" className="registration-submit" disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="animate-spin" />
                Sending Instructions...
              </>
            ) : (
              "Send Reset Instructions"
            )}
          </Button>
        </form>
      )}
      <p className="registration-assurance" style={{ marginTop: 18 }}>
        <Link to="/login" className="registration-auxlink">
          <ArrowLeft aria-hidden="true" /> Back to log in
        </Link>
      </p>
    </AuthShell>
  );
}
