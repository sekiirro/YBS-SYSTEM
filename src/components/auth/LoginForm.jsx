import React, { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/utils/supabase";
import { normalizePhone } from "@/lib/phone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Phone, Lock, Loader2, ArrowRight } from "lucide-react";
import { safeReturnTo } from "@/lib/authReturnTo";

// Login form rendered inside the shared AuthShell right-side card.
// Same width / radius / background / inputs / button as the registration
// card — only the contents differ.
export default function LoginForm() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const returnTo = safeReturnTo();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const id = identifier.trim();
      let email = id;

      // Phone-first login: resolve phone -> authentication email via Supabase RPC
      if (id && !id.includes("@")) {
        const normalized = normalizePhone(id);
        const { data: res, error: rpcErr } = await supabase.rpc("resolve_phone_identifier", {
          p_phone: normalized,
        });

        if (rpcErr) {
          console.error("Phone resolution error:", rpcErr);
          throw new Error("Unable to verify phone number. Please try again or use email.");
        }

        if (!res || !res.found) {
          throw new Error("No account found with this phone number. Please check your details and try again.");
        }

        const status = res.account_status;
        if (status === "pending_approval") {
          throw new Error("Your account is currently awaiting approval by the YBS team. You will be notified once reviewed.");
        } else if (status === "suspended" || status === "disabled") {
          throw new Error("This account has been suspended. Please contact YBS management.");
        } else if (status === "rejected") {
          throw new Error("Your registration application was not approved. Please contact YBS.");
        }

        if (!res.email) {
          throw new Error("Account configuration error. Please sign in with your email address.");
        }

        email = res.email;
      }

      // Supabase Auth Email/Password Sign-In
      const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authErr) {
        if (authErr.message.includes("Invalid login credentials")) {
          throw new Error("Invalid phone/email or password. Please try again.");
        } else if (authErr.message.includes("Email not confirmed")) {
          throw new Error("Please confirm your email address before signing in.");
        }
        throw new Error(authErr.message);
      }

      if (authData?.session) {
        window.location.href = returnTo || "/";
      }
    } catch (err) {
      setError(err.message || "An unexpected error occurred during sign in.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {error && <div className="registration-error" role="alert">{error}</div>}
      <form onSubmit={handleSubmit} className="registration-form">
        <div className="registration-field">
          <Label htmlFor="login-identifier">Phone Number or Email</Label>
          <div className="relative">
            <Phone className="registration-field-icon" aria-hidden="true" />
            <Input
              id="login-identifier"
              type="text"
              autoComplete="username"
              autoFocus
              placeholder="+20 10x xxx xxxx or email@example.com"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              className="pl-10"
              required
            />
          </div>
        </div>
        <div className="registration-field">
          <div className="registration-field-row">
            <Label htmlFor="login-password">Password</Label>
            <Link to="/forgot-password" className="registration-auxlink">
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <Lock className="registration-field-icon" aria-hidden="true" />
            <Input
              id="login-password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pl-10"
              required
            />
          </div>
        </div>
        <Button type="submit" className="registration-submit" disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="animate-spin" /> Signing in…
            </>
          ) : (
            <>
              Sign in <ArrowRight />
            </>
          )}
        </Button>
      </form>
    </>
  );
}
