import React, { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/utils/supabase";
import { normalizePhone } from "@/lib/phone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, ArrowLeft, Loader2 } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";

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
    <AuthLayout
      icon={Mail}
      title="Reset password"
      subtitle="We'll send you instructions to reset your password"
      footer={
        <Link to="/login" className="text-primary font-medium hover:underline">
          <ArrowLeft className="w-3 h-3 inline mr-1" />
          Back to log in
        </Link>
      }
    >
      {sent ? (
        <p className="text-sm text-foreground text-center">
          If an account exists with that phone number or email, password reset instructions have been sent.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="identifier">Phone Number or Email</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
              <Input
                id="identifier"
                type="text"
                autoFocus
                placeholder="+20 10x xxx xxxx or you@example.com"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className="pl-10 h-12"
                required
              />
            </div>
          </div>
          <Button type="submit" className="w-full h-12 font-medium" disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Sending Instructions...
              </>
            ) : (
              "Send Reset Instructions"
            )}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
