import React from "react";

export default function AuthLayout({ icon: Icon, title, subtitle, footer, children, brand }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          {brand ? (
            <div className="flex flex-col items-center gap-3 mb-2">
              <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center glow-primary">
                <span className="text-primary-foreground font-bold text-lg tracking-tight font-display">Y</span>
              </div>
              <div className="flex flex-col leading-none">
                <span className="font-display font-bold text-2xl tracking-tight text-foreground">YBS</span>
                <span className="text-[11px] text-muted-foreground tracking-[0.2em] uppercase mt-1">Coaching OS</span>
              </div>
            </div>
          ) : (
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary mb-4">
              <Icon className="w-7 h-7 text-primary-foreground" aria-hidden="true" />
            </div>
          )}
          {!brand && <h1 className="text-3xl font-bold tracking-tight text-foreground font-display">{title}</h1>}
          {subtitle && <p className="text-muted-foreground mt-2 text-sm">{subtitle}</p>}
        </div>
        <div className="bg-card rounded-xl shadow-sm border border-border p-7">
          {children}
        </div>
        {footer && (
          <p className="text-center text-sm text-muted-foreground mt-6">{footer}</p>
        )}
      </div>
    </div>
  );
}