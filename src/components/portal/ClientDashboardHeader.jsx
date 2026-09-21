import React, { useMemo } from 'react';
import { Activity } from 'lucide-react';

export default function ClientDashboardHeader({ client, workspaceName }) {
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  }, []);
  const firstName = client?.full_name?.trim()?.split(' ')?.[0] || 'Athlete';
  return (
    <section className="ybs-hero ybs-dashboard-hero">
      <div>
        <div className="flex items-center gap-2 text-primary text-xs font-semibold tracking-wide">
          <Activity className="w-4 h-4" aria-hidden="true" />
          <span>{workspaceName || 'Your personal coaching space'}</span>
        </div>
        <h1 className="font-bold">{greeting},<br /><span className="text-primary">{firstName}.</span></h1>
        <p>Your next step, made clear. Training, nutrition, and progress — all in one place.</p>
      </div>
      {client?.client_code && <div className="ybs-dashboard-id"><span className="ybs-eyebrow block">Your membership</span><span>{client.client_code}</span></div>}
    </section>
  );
}
