import React, { useMemo } from 'react';
import { Sparkles } from 'lucide-react';

export default function ClientDashboardHeader({ client, workspaceName }) {
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }, []);

  const firstName = client?.full_name?.trim()?.split(' ')?.[0] || 'Athlete';

  return (
    <div className="relative mb-8 pb-6 border-b border-border/60">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          {workspaceName && (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-[11px] font-semibold uppercase tracking-wider mb-2">
              <Sparkles className="w-3 h-3" />
              <span>{workspaceName}</span>
            </div>
          )}
          <h1 className="text-2xl sm:text-3xl font-display font-bold tracking-tight text-foreground">
            {greeting}, {firstName} 👋
          </h1>
          <p className="text-[14px] text-muted-foreground mt-1">
            Here&apos;s what&apos;s waiting for you today. Stay disciplined and trust the process.
          </p>
        </div>

        {client?.client_code && (
          <div className="flex items-center gap-3">
            <div className="px-3 py-1.5 rounded-lg bg-secondary/50 border border-border/80 text-right">
              <span className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground block">Client ID</span>
              <span className="text-[13px] font-mono font-medium text-foreground">{client.client_code}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
