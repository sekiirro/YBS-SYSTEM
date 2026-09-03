import React from "react";
import { Link } from "react-router-dom";
import { ShieldAlert, ArrowLeft } from "lucide-react";

export default function Forbidden() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-destructive/10 border border-destructive/20 mb-5">
          <ShieldAlert className="w-8 h-8 text-destructive" />
        </div>
        <h1 className="text-2xl font-display font-bold tracking-tight text-foreground">Access Restricted</h1>
        <p className="text-[14px] text-muted-foreground mt-2 max-w-sm mx-auto">
          You don't have permission to access this resource. If you believe this is an error, contact your workspace administrator.
        </p>
        <Link
          to="/"
          className="inline-flex items-center gap-2 mt-6 px-4 h-10 rounded-md bg-secondary border border-border text-[13px] font-medium hover:bg-secondary/80 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back to home
        </Link>
      </div>
    </div>
  );
}