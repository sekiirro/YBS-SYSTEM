import React, { useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { hasPermission } from '@/lib/permissions';
import { PageHeader, Badge, Button, Input, Select } from '@/components/ui';
import { Settings as SettingsIcon, Shield, Bell, Bot, Sparkles } from 'lucide-react';

export default function Settings() {
  const { user } = useAuth();
  const [section, setSection] = useState('general');

  const sections = [
    { id: 'general', label: 'General', icon: SettingsIcon },
    { id: 'permissions', label: 'Permissions', icon: Shield },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'integrations', label: 'Integrations', icon: Bot },
  ];

  return (
    <div>
      <PageHeader title="Settings" description="Organization configuration" icon={SettingsIcon} />
      <div className="flex flex-col lg:flex-row gap-4">
        <div className="lg:w-56 shrink-0">
          <div className="surface-card p-2 space-y-1">
            {sections.map((s) => {
              const Icon = s.icon;
              return (
                <button
                  key={s.id}
                  onClick={() => setSection(s.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors ${
                    section === s.id ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                  }`}
                >
                  <Icon className="w-4 h-4" /> {s.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex-1">
          <div className="surface-card p-6">
            {section === 'general' && (
              <div className="space-y-4">
                <h3 className="text-[14px] font-display font-semibold">Organization Settings</h3>
                <Input label="Organization Name" defaultValue="YBS Coaching" />
                <Input label="Notification Time" defaultValue="10:00 AM" />
                <div className="flex gap-2 pt-2">
                  <Button>Save Changes</Button>
                </div>
              </div>
            )}
            {section === 'permissions' && (
              <div className="space-y-4">
                <h3 className="text-[14px] font-display font-semibold">Permission Model</h3>
                <p className="text-[13px] text-muted-foreground">Hybrid RBAC with granular permission overrides. Role defaults apply, with custom per-user overrides for flexibility.</p>
                <div className="space-y-2">
                  {['owner', 'manager', 'trainer'].map((r) => (
                    <div key={r} className="flex items-center justify-between p-3 rounded-lg bg-secondary/30">
                      <span className="text-[13px] font-medium capitalize">{r === 'manager' ? 'Head Coach' : r}</span>
                      <Badge className="text-muted-foreground bg-secondary border-border">
                        {r === 'owner' ? 'All permissions' : r === 'manager' ? 'Operational access' : 'Scoped access'}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {section === 'notifications' && (
              <div className="space-y-4">
                <h3 className="text-[14px] font-display font-semibold">Notification Settings</h3>
                <p className="text-[13px] text-muted-foreground">Automated Telegram notifications are sent at 10:00 AM for follow-ups, subscription reminders, and plan updates.</p>
                <div className="space-y-2">
                  {['Follow-up reminders', 'Subscription expiring', 'Plan updates', 'Workout assigned', 'Nutrition plan assigned'].map((n) => (
                    <div key={n} className="flex items-center justify-between p-3 rounded-lg bg-secondary/30">
                      <span className="text-[13px]">{n}</span>
                      <Badge className="text-emerald-400 bg-emerald-500/10 border-emerald-500/20">Enabled</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {section === 'integrations' && (
              <div className="space-y-4">
                <h3 className="text-[14px] font-display font-semibold">Integrations</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-4 rounded-lg bg-secondary/30 border border-border">
                    <div className="flex items-center gap-3">
                      <Bot className="w-5 h-5 text-primary" />
                      <div>
                        <p className="text-[13px] font-medium">Telegram Bot</p>
                        <p className="text-[11px] text-muted-foreground">Client notifications and reminders</p>
                      </div>
                    </div>
                    <Badge className="text-amber-400 bg-amber-500/10 border-amber-500/20">Not Configured</Badge>
                  </div>
                  <div className="flex items-center justify-between p-4 rounded-lg bg-secondary/30 border border-border">
                    <div className="flex items-center gap-3">
                      <Sparkles className="w-5 h-5 text-primary" />
                      <div>
                        <p className="text-[13px] font-medium">Gemini AI</p>
                        <p className="text-[11px] text-muted-foreground">On-demand progress analysis</p>
                      </div>
                    </div>
                    <Badge className="text-amber-400 bg-amber-500/10 border-amber-500/20">Not Configured</Badge>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}