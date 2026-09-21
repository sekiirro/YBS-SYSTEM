import React from "react";
import { Link } from 'react-router-dom';
import { Activity } from 'lucide-react';

export default function AuthLayout({ icon: Icon, title, subtitle, footer, children, brand }) {
  return (
    <div className="ybs-auth">
      <aside className="ybs-auth-story">
        <Link to="/" className="ybs-brand w-fit" aria-label="YBS home"><span className="ybs-monogram">Y</span><span><span className="ybs-wordmark block">YBS</span><span className="ybs-eyebrow">Coaching OS</span></span></Link>
        <div className="py-8 lg:py-20">
          <p className="ybs-eyebrow mb-6 flex items-center gap-2"><Activity size={16} /> Built around your progress</p>
          <h2>Your effort.<br />A clearer direction.</h2>
          <p className="mt-6 max-w-md text-base text-slate-300">Training, nutrition, and your coach. Together in one place, so you can focus on the next step.</p>
        </div>
        <p className="text-sm text-slate-300">YBS · Technology meets human performance.</p>
      </aside>
      <main className="ybs-auth-form">
        <header>
          {!brand && Icon && <div className="mb-5 inline-flex rounded-2xl bg-primary/10 p-3"><Icon className="h-6 w-6 text-primary" aria-hidden="true" /></div>}
          <h1 className="font-bold text-foreground">{title || 'Welcome to YBS'}</h1>
          {subtitle && <p className="text-muted-foreground mt-2 text-sm">{subtitle}</p>}
        </header>
        <div>
          {children}
        </div>
        {footer && (
          <p className="text-center text-sm text-muted-foreground mt-6">{footer}</p>
        )}
      </main>
    </div>
  );
}
