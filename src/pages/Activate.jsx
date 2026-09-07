import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { supabase } from "@/utils/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, Lock, Loader2, UserCheck, AlertCircle, CheckCircle2 } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";

export default function Activate() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const navigate = useNavigate();
  const [email, setEmail] = useState(params.get("email") || "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  // Invitation-token state ("checking" | "valid" | "invalid" | "none").
  // Role / workspace / email are NEVER read from the browser: they come only
  // from the token-scoped get_team_invite() RPC (server-side).
  const [invite, setInvite] = useState(null);
  const [inviteState, setInviteState] = useState(token ? "checking" : "none");

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      const { data, error: rpcErr } = await supabase.rpc("get_team_invite", { p_token: token });
      if (cancelled) return;
      if (rpcErr) {
        setInviteState("invalid");
        return;
      }
      if (data && data.valid && data.status === "sent") {
        setInvite(data);
        setEmail(data.email);
        setInviteState("valid");
      } else {
        setInviteState("invalid");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const markActivationComplete = async () => {
    try {
      const { error } = await supabase.rpc("mark_activation_complete");
      if (error) console.warn("Activation marker warning:", error.message);
    } catch (err) {
      console.warn("Activation marker failed silently:", err);
    }
  };

  const submitForm = async (e) => {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (inviteState === "checking") {
      setError("Verifying your invitation…");
      return;
    }
    setLoading(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();

      if (session) {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
      } else {
        // With a valid invitation token the email is locked to the one
        // returned by the server-side lookup; otherwise fall back to the
        // entered email for legacy activation paths.
        const signupEmail = invite?.email || email.trim().toLowerCase();
        const { error } = await supabase.auth.signUp({
          email: signupEmail,
          password,
        });
        if (error) throw error;
      }
      await markActivationComplete();

      setSuccess(true);
      setTimeout(() => {
        navigate("/login");
      }, 2000);
    } catch (err) {
      const msg = err.message || "Account activation failed";
      if (
        invite &&
        (msg.toLowerCase().includes("already registered") ||
          msg.toLowerCase().includes("already been registered") ||
          msg.toLowerCase().includes("user already"))
      ) {
        setError("An account already exists for this email. Please sign in instead.");
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const showForm = inviteState !== "invalid";

  return (
    <AuthLayout icon={UserCheck} title="Activate Account" subtitle="Set your password to access your coaching workspace">
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
          {error}
        </div>
      )}
      {!showForm ? (
        <div className="text-center py-6 space-y-3">
          <AlertCircle className="w-12 h-12 text-destructive mx-auto" />
          <p className="text-base font-medium">Invitation Unavailable</p>
          <p className="text-sm text-muted-foreground">
            This invitation link is invalid or has already been used. Ask the person who invited you for a new link.
          </p>
        </div>
      ) : success ? (
        <div className="text-center py-6 space-y-3">
          <CheckCircle2 className="w-12 h-12 text-success mx-auto" />
          <p className="text-base font-medium">Account Activated Successfully!</p>
          <p className="text-sm text-muted-foreground">Redirecting you to sign in…</p>
        </div>
      ) : (
        <form onSubmit={submitForm} className="space-y-4">
          {invite && (
            <div className="mb-4 p-3 rounded-lg bg-primary/5 border border-primary/20 text-sm">
              You've been invited as a{" "}
              <span className="font-medium">{invite.role === "platform_trainer" ? "Trainer" : "Workspace Owner"}</span>
              {invite.workspace_name ? (
                <>
                  {" "}
                  for <span className="font-medium">{invite.workspace_name}</span>
                </>
              ) : (
                ""
              )}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="pl-10 h-12"
                required
                readOnly={!!invite}
                disabled={!!invite}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password (min 8 characters)</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="pl-10 h-12"
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm">Confirm Password</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••"
                className="pl-10 h-12"
                required
              />
            </div>
          </div>
          <Button type="submit" className="w-full h-12 font-medium" disabled={loading || inviteState === "checking"}>
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Activating...
              </>
            ) : (
              "Activate Account"
            )}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}