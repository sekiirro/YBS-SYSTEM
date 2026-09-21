import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '@/lib/AuthContext';
import { NotificationsService } from '@/services/notifications';
import { PageHeader, LoadingState, EmptyState, ErrorState, Badge, Button } from '@/components/ui';
import { timeAgo } from '@/lib/ybs-utils';
import { Bell, CheckCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function Notifications() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState([]);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => { loadNotifications(); }, [user]);

  const loadNotifications = useCallback(async () => {
    if (!user?.id) { setLoading(false); return; }
    try {
      setLoading(true);
      setLoadError(false);
      const data = await NotificationsService.list(user.id);
      setNotifications(data);
    } catch (err) {
      setLoadError(true);
      console.error(err);
    } finally { setLoading(false); }
  }, [user?.id]);

  const markAllRead = async () => {
    try {
      await NotificationsService.markAllAsRead(user.id);
      loadNotifications();
    } catch (err) { console.error(err); }
  };

  const markRead = async (id) => {
    try {
      await NotificationsService.markAsRead(id);
      loadNotifications();
    } catch (err) { console.error(err); }
  };

  const handleClick = async (n) => {
    if (!n.is_read) await markRead(n.id);
    if (n.related_entity_type === 'meal_replacement_request') {
      navigate('/nutrition/requests');
    }
  };

  if (loading) return <LoadingState label="Loading notifications…" />;

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  if (loadError) return <ErrorState onRetry={loadNotifications} />;

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
        <div className="ybs-activity-feed divide-y divide-border">
          {notifications.map((n) => (
            <button
              type="button"
              key={n.id}
              className={cn('w-full text-left flex items-start gap-4 p-5 sm:p-6 hover:bg-secondary/30 transition-colors', !n.is_read && 'bg-primary/5')}
              onClick={() => handleClick(n)}
            >
              <div className={cn('w-2 h-2 rounded-full mt-2 shrink-0', n.is_read ? 'bg-transparent' : 'bg-primary')} />
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-medium">{n.title}</p>
                <p className="text-[12px] text-muted-foreground mt-0.5">{n.message}</p>
                <p className="text-[12px] text-muted-foreground mt-1">{timeAgo(n.created_date)}</p>
              </div>
              {!n.is_read && <Badge className="text-primary bg-primary/10 border-primary/20">New</Badge>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
