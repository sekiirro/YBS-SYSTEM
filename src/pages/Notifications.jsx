const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import React, { useState, useEffect } from 'react';

import { useAuth } from '@/lib/AuthContext';
import { PageHeader, LoadingState, EmptyState, Badge, Button } from '@/components/ui';
import { timeAgo } from '@/lib/ybs-utils';
import { Bell, Check, CheckCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function Notifications() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState([]);

  useEffect(() => { loadNotifications(); }, []);

  const loadNotifications = async () => {
    try {
      setLoading(true);
      const data = await db.entities.Notification.filter({ user_id: user.id }, '-created_date', 100);
      setNotifications(data);
    } finally { setLoading(false); }
  };

  const markAllRead = async () => {
    try {
      await db.entities.Notification.updateMany(
        { user_id: user.id, is_read: false },
        { $set: { is_read: true } }
      );
      loadNotifications();
    } catch (err) { console.error(err); }
  };

  const markRead = async (id) => {
    try {
      await db.entities.Notification.update(id, { is_read: true });
      loadNotifications();
    } catch (err) { console.error(err); }
  };

  if (loading) return <LoadingState label="Loading notifications…" />;

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <div>
      <PageHeader
        title="Notifications"
        description={unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
        icon={Bell}
        actions={unreadCount > 0 && <Button variant="secondary" onClick={markAllRead}><CheckCheck className="w-4 h-4" /> Mark all read</Button>}
      />
      {notifications.length === 0 ? (
        <EmptyState icon={Bell} title="No notifications" description="You'll see updates here as they come in" />
      ) : (
        <div className="surface-card divide-y divide-border">
          {notifications.map((n) => (
            <div
              key={n.id}
              className={cn('flex items-start gap-3 p-4 hover:bg-secondary/30 transition-colors cursor-pointer', !n.is_read && 'bg-primary/5')}
              onClick={() => !n.is_read && markRead(n.id)}
            >
              <div className={cn('w-2 h-2 rounded-full mt-2 shrink-0', n.is_read ? 'bg-transparent' : 'bg-primary')} />
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium">{n.title}</p>
                <p className="text-[12px] text-muted-foreground mt-0.5">{n.message}</p>
                <p className="text-[11px] text-muted-foreground mt-1">{timeAgo(n.created_date)}</p>
              </div>
              {!n.is_read && <Badge className="text-primary bg-primary/10 border-primary/20">New</Badge>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}