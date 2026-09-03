import React, { useState, useEffect } from "react";
import { useAuth } from "@/lib/AuthContext";
import { getAccountStatus } from "@/lib/ybs-auth";
import { supabase } from "@/utils/supabase";
import { Button } from "@/components/ui/button";
import { TextArea } from "@/components/ui";
import { Clock, CheckCircle2, XCircle, AlertCircle, Loader2 } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";

export default function PendingApproval() {
  const { user, logout } = useAuth();
  const [application, setApplication] = useState(null);
  const [loading, setLoading] = useState(true);
  const [response, setResponse] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState("");

  const status = getAccountStatus(user);

  useEffect(() => {
    let active = true;
    async function loadApp() {
      if (!user?.id) {
        setLoading(false);
        return;
      }
      try {
        const { data, error } = await supabase
          .from("client_applications")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(1);

        if (active && data && data[0]) {
          setApplication(data[0]);
        }
      } catch (err) {
        console.warn("Error fetching application:", err);
      } finally {
        if (active) setLoading(false);
      }
    }
    loadApp();
    return () => {
      active = false;
    };
  }, [user]);

  const submitMoreInfo = async () => {
    if (!application?.id || !response.trim()) return;
    setSubmitting(true);
    setMsg("");
    try {
      const { error } = await supabase
        .from("client_applications")
        .update({
          more_info_response: response.trim(),
          more_info_responded_at: new Date().toISOString(),
          status: "under_review",
        })
        .eq("id", application.id);

      if (error) throw error;

      setMsg("Your response has been submitted. The YBS platform team will review it shortly.");
      setResponse("");
      setApplication((prev) => ({ ...prev, status: "under_review", more_info_response: response }));
    } catch (err) {
      setMsg(err.message || "Failed to submit response");
    } finally {
      setSubmitting(false);
    }
  };

  const config = {
    pending_approval: {
      icon: Clock,
      title: "Application Under Review",
      color: "text-warning",
      desc: "Your account is pending approval by the YBS team. You will be notified once your workspace and coaching plan are assigned.",
    },
    suspended: {
      icon: AlertCircle,
      title: "Account Suspended",
      color: "text-destructive",
      desc: "Your account has been suspended. Please contact YBS management.",
    },
    rejected: {
      icon: XCircle,
      title: "Application Rejected",
      color: "text-destructive",
      desc: application?.rejection_reason
        ? `Your application was not approved: ${application.rejection_reason}`
        : "Your application was not approved at this time.",
    },
    disabled: {
      icon: XCircle,
      title: "Account Disabled",
      color: "text-destructive",
      desc: "Your account is currently disabled. Please contact YBS management.",
    },
    unknown: {
      icon: Clock,
      title: "Access Pending",
      color: "text-warning",
      desc: "Your access is currently being provisioned.",
    },
  };

  const c = config[status] || config.unknown;
  const Icon = c.icon;
  const needsMoreInfo = application?.status === "more_info_required";

  return (
    <AuthLayout brand title={c.title}>
      <div className="flex flex-col items-center text-center py-2">
        <div className="w-14 h-14 rounded-2xl bg-secondary border border-border flex items-center justify-center mb-4">
          <Icon className={`w-7 h-7 ${c.color}`} />
        </div>
        <p className="text-[14px] text-muted-foreground max-w-sm">{c.desc}</p>

        {application && (
          <div className="w-full mt-5 p-4 rounded-md bg-secondary/40 border border-border text-left">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Registration Status</span>
              <span className={`text-[11px] font-medium capitalize ${c.color}`}>
                {application.status.replace(/_/g, " ")}
              </span>
            </div>
            <p className="text-[13px] font-medium mt-1">{application.applicant_name}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Submitted on {new Date(application.submitted_at || application.created_at).toLocaleDateString()}
            </p>
          </div>
        )}

        {needsMoreInfo && (
          <div className="w-full mt-4 text-left">
            <div className="p-3 rounded-md bg-warning/10 border border-warning/20 mb-3">
              <p className="text-[11px] uppercase tracking-wider text-warning mb-1">Additional Information Requested</p>
              <p className="text-[13px] text-foreground">{application.more_info_request}</p>
            </div>
            <label className="text-[12px] font-medium text-muted-foreground">Your Response</label>
            <TextArea
              rows={3}
              value={response}
              onChange={(e) => setResponse(e.target.value)}
              placeholder="Provide the requested information…"
              className="mt-1.5"
            />
            <Button className="w-full mt-3" onClick={submitMoreInfo} disabled={submitting || !response.trim()}>
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Submitting...
                </>
              ) : (
                "Submit Response"
              )}
            </Button>
          </div>
        )}

        {msg && <p className="text-[12px] text-success mt-3">{msg}</p>}

        <button onClick={() => logout()} className="mt-6 text-[12px] text-muted-foreground hover:text-foreground">
          Sign out
        </button>
      </div>
    </AuthLayout>
  );
}