import React, { useState } from "react";
import { supabase } from "@/utils/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, Loader2, CheckCircle2 } from "lucide-react";
import AuthShell from "@/components/auth/AuthShell";

export default function ResetPassword() {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    setLoading(true);
    try {
      const { error: resetErr } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (resetErr) throw resetErr;

      setSuccess(true);
      setTimeout(() => {
        window.location.href = "/login";
      }, 2000);
    } catch (err) {
      setError(err.message || "Failed to reset password. The link may have expired.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      workspaceName="Coaching OS"
      loginTarget="/login"
      panelKicker="Account recovery"
      panelTitle="Set new password"
      panelTitleId="reset-password-heading"
      panelSub="Enter your new password below."
    >
      {error && <div className="registration-error" role="alert">{error}</div>}
      {success ? (
        <div className="registration-inline-success" role="status">
          <span className="registration-success-icon"><CheckCircle2 aria-hidden="true" /></span>
          <h3>Password updated successfully!</h3>
          <p>Redirecting you to sign in…</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="registration-form">
          <div className="registration-field">
            <Label htmlFor="reset-password">New Password</Label>
            <div className="relative">
              <Lock className="registration-field-icon" aria-hidden="true" />
              <Input
                id="reset-password"
                type="password"
                autoComplete="new-password"
                autoFocus
                placeholder="••••••••"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="pl-10"
                required
              />
            </div>
          </div>
          <div className="registration-field">
            <Label htmlFor="reset-confirm">Confirm Password</Label>
            <div className="relative">
              <Lock className="registration-field-icon" aria-hidden="true" />
              <Input
                id="reset-confirm"
                type="password"
                autoComplete="new-password"
                placeholder="••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="pl-10"
                required
              />
            </div>
          </div>
          <Button type="submit" className="registration-submit" disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="animate-spin" />
                Updating Password...
              </>
            ) : (
              "Save New Password"
            )}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
