/**
 * NotificationDropdown Component
 * Displays notifications in a dropdown panel - fetches from database
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCircle2, Mail, FileText, AlertCircle, XCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

// Notification type from database
interface NotificationData {
  id: string;
  title: string;
  message: string | null;
  notification_type: string;
  read_at: string | null;
  created_at: string;
  data: Record<string, any> | null;
}

// Helper function to format time ago
const formatTimeAgo = (dateStr: string): string => {
  const date = new Date(dateStr);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months > 1 ? 's' : ''} ago`;
};

// Get icon config based on notification type and action
const getIconConfig = (type: string, data?: Record<string, any> | null) => {
  // For approver_status_change, check the action in data
  if (type === 'approver_status_change' && data?.action) {
    if (data.action === 'approved') {
      return { icon: CheckCircle2, bg: 'bg-emerald-100', color: 'text-emerald-600' };
    } else if (data.action === 'rejected') {
      return { icon: XCircle, bg: 'bg-red-100', color: 'text-red-600' };
    }
  }

  switch (type) {
    case 'approved':
      return { icon: CheckCircle2, bg: 'bg-emerald-100', color: 'text-emerald-600' };
    case 'rejected':
      return { icon: XCircle, bg: 'bg-red-100', color: 'text-red-600' };
    case 'invoice':
      return { icon: FileText, bg: 'bg-blue-100', color: 'text-blue-600' };
    case 'email':
      return { icon: Mail, bg: 'bg-blue-100', color: 'text-blue-600' };
    case 'reminder':
      return { icon: AlertCircle, bg: 'bg-amber-100', color: 'text-amber-600' };
    case 'approver_status_change':
      return { icon: CheckCircle2, bg: 'bg-indigo-100', color: 'text-indigo-600' };
    case 'cashflow_alert':
    case 'alert':
    case 'warning':
    case 'error':
      return { icon: AlertCircle, bg: 'bg-red-100', color: 'text-red-600' };
    default:
      return { icon: Bell, bg: 'bg-gray-100', color: 'text-gray-600' };
  }
}

// Notification types that should make the bell blink red (urgent alerts).
const ALERT_TYPES = ['cashflow_alert', 'alert', 'warning', 'error'];;

export function NotificationDropdown() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationData[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const organizationId = profile?.current_organization_id;
  const userId = user?.id;

  // Fetch notifications when dropdown opens or organization/user changes
  useEffect(() => {
    if (isOpen && organizationId && userId) {
      fetchNotifications();
    }
  }, [isOpen, organizationId, userId]);

  // Initial fetch for unread count
  useEffect(() => {
    if (organizationId && userId) {
      fetchNotifications();
    }

    // Set up realtime subscription for new notifications filtered by user_id
    const channel = supabase
      .channel('notifications')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'general_notification',
          filter: `user_id=eq.${userId}`,
        },
        () => {
          if (organizationId && userId) {
            fetchNotifications();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [organizationId, userId]);

  const fetchNotifications = async () => {
    if (!organizationId || !userId) return;

    setIsLoading(true);
    try {
      const MIN_NOTIFICATIONS = 4;

      // First, fetch unread notifications for this user
      const { data: unreadData, error: unreadError } = await supabase
        .from('general_notification')
        .select('id, title, message, notification_type, read_at, created_at, data')
        .eq('user_id', userId)
        .is('read_at', null)
        .order('created_at', { ascending: false })
        .limit(10);

      if (unreadError) {
        console.error('Error fetching unread notifications:', unreadError);
        return;
      }

      const unreadNotifications = unreadData || [];

      // If we have less than MIN_NOTIFICATIONS unread, fetch read notifications to fill
      if (unreadNotifications.length < MIN_NOTIFICATIONS) {
        const remainingCount = MIN_NOTIFICATIONS - unreadNotifications.length;

        const { data: readData, error: readError } = await supabase
          .from('general_notification')
          .select('id, title, message, notification_type, read_at, created_at, data')
          .eq('user_id', userId)
          .not('read_at', 'is', null)
          .order('created_at', { ascending: false })
          .limit(remainingCount);

        if (readError) {
          console.error('Error fetching read notifications:', readError);
          setNotifications(unreadNotifications);
          return;
        }

        // Combine: unread first, then read
        setNotifications([...unreadNotifications, ...(readData || [])]);
      } else {
        setNotifications(unreadNotifications);
      }
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Count unread notifications
  const unreadCount = notifications.filter(n => !n.read_at).length;
  // Any unread URGENT alert (e.g. cash-flow below threshold) → blink the bell red.
  const hasAlert = notifications.some(n => !n.read_at && ALERT_TYPES.includes(n.notification_type));

  // Mark all as read and refetch to show last 4 read notifications
  const handleMarkAllAsRead = async () => {
    try {
      const unreadIds = notifications.filter(n => !n.read_at).map(n => n.id);
      if (unreadIds.length === 0) return;

      const { error } = await supabase
        .from('general_notification')
        .update({ read_at: new Date().toISOString() })
        .in('id', unreadIds);

      if (error) throw error;

      // Refetch to show last 4 read notifications
      await fetchNotifications();
    } catch (err) {
      console.error('Error marking all as read:', err);
    }
  };

  // Mark single notification as read and refetch to maintain minimum count
  const handleMarkAsRead = async (id: string) => {
    const notification = notifications.find(n => n.id === id);
    if (notification?.read_at) return;

    try {
      const { error } = await supabase
        .from('general_notification')
        .update({ read_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;

      // Refetch to maintain at least 4 notifications
      await fetchNotifications();
    } catch (err) {
      console.error('Error marking as read:', err);
    }
  };

  // Handle notification click - just mark as read, no redirect
  const handleNotificationClick = (notification: NotificationData) => {
    handleMarkAsRead(notification.id);
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-9 w-9">
          <Bell className={cn('w-5 h-5', hasAlert && 'text-red-500 animate-pulse')} />
          {/* Red ping ring when an urgent alert is unread — draws the eye to the bell. */}
          {hasAlert && (
            <span className="absolute -top-0.5 -right-0.5 inline-flex h-[18px] w-[18px] animate-ping rounded-full bg-red-400 opacity-75" />
          )}
          {unreadCount > 0 && (
            <span className={cn(
              'absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-white rounded-full',
              hasAlert ? 'bg-red-600 ring-2 ring-red-300' : 'bg-red-500'
            )}>
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[380px] p-0 shadow-lg border border-gray-200"
        sideOffset={8}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Notifications</h3>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllAsRead}
              className="text-sm text-indigo-600 hover:text-indigo-700 font-medium hover:underline"
            >
              Mark all as read
            </button>
          )}
        </div>

        {/* Notification List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 px-4">
            <Bell className="w-10 h-10 text-gray-300 mb-2" />
            <p className="text-gray-500 text-sm">No notifications yet</p>
          </div>
        ) : (
          <ScrollArea className="max-h-[400px]">
            <div className="divide-y divide-gray-100">
              {notifications.map((notification) => {
                const iconConfig = getIconConfig(notification.notification_type, notification.data);
                const IconComponent = iconConfig.icon;
                const isRead = !!notification.read_at;

                return (
                  <div
                    key={notification.id}
                    onClick={() => handleNotificationClick(notification)}
                    className={cn(
                      'flex gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-gray-50',
                      !isRead && 'bg-indigo-50/50'
                    )}
                  >
                    {/* Icon */}
                    <div className={cn(
                      'flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center',
                      iconConfig.bg
                    )}>
                      <IconComponent className={cn('w-5 h-5', iconConfig.color)} />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className={cn(
                          'text-sm',
                          !isRead ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'
                        )}>
                          {notification.title}
                        </p>
                        {!isRead && (
                          <span className="flex-shrink-0 w-2 h-2 mt-1.5 bg-indigo-600 rounded-full" />
                        )}
                      </div>
                      <p className="text-sm text-gray-500 mt-0.5 line-clamp-2">
                        {notification.message || 'No message'}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        {formatTimeAgo(notification.created_at)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}

        {/* Footer */}
        <div className="border-t border-gray-100 px-4 py-3">
          <button
            onClick={() => {
              setIsOpen(false);
              navigate('/notifications');
            }}
            className="w-full text-center text-sm text-indigo-600 hover:text-indigo-700 font-medium hover:underline"
          >
            View all notifications
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
