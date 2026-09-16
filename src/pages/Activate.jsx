import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/utils/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, Lock, User, Loader2, UserCheck, AlertCircle, CheckCircle2 } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";

export default function Activate() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const navigate = useNavigate();
  const [email, setEmail] = useState(params.get("email") || "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
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
    if (invite) {
      // Invited members must complete their identity: First + Last are both
      // required (trimmed; whitespace-only is rejected). The server enforces
      // this too, so a bypassed form can never save an email-only member.
      if (!firstName.trim()) {
        setError("Please enter your first name.");
        return;
      }
      if (!lastName.trim()) {
        setError("Please enter your last name.");
        return;
      }
      if (firstName.trim().length > 80 || lastName.trim().length > 80) {
        setError("Name is too long.");
        return;
      }
    }
    if (inviteState === "checking") {
      setError("Verifying your invitation…");
      return;
    }
    setLoading(true);

    try {
      if (invite) {
        // The invitation token is the authorization credential. The email,
        // role and workspace are resolved server-side from the invitation
        // ledger — the form email is never used as the identity authority.
        // This create-or-activate call handles both a new email and an
        // existing account (rotate password), so `User already registered`
        // can no longer be surfaced for a valid invitation.
        const { data, error } = await supabase.functions.invoke("activate-invite", {
          body: {
            token,
            password,
            first_name: firstName.trim(),
            last_name: lastName.trim(),
          },
        });
        if (error || !data || data.status !== "ok") {
          let body = null;
          try {
            if (error?.context && typeof error.context.json === "function") {
              body = await error.context.json();
            }
          } catch {
            body = null;
          }
          throw new Error(body?.error || error?.message || "Account activation failed. Please try again.");
        }
      } else {
        // Legacy paths (no invitation token): a logged-in user sets their own
        // password; otherwise the typed email is used for a plain signup.
        const { data: { session } } = await supabase.auth.getSession();

        if (session) {
          const { error } = await supabase.auth.updateUser({ password });
          if (error) throw error;
        } else {
          const signupEmail = email.trim().toLowerCase();
          const { error } = await supabase.auth.signUp({
            email: signupEmail,
            password,
          });
          if (error) throw error;
        }
        await markActivationComplete();
      }

      setSuccess(true);
      setTimeout(() => {
        navigate("/login");
      }, 2000);
    } catch (err) {
      setError(err.message || "Account activation failed");
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
          {invite && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="firstName"
                    type="text"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Ahmed"
                    className="pl-10 h-12"
                    autoComplete="given-name"
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="lastName"
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Ali"
                    className="pl-10 h-12"
                    autoComplete="family-name"
                    required
                  />
                </div>
              </div>
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