export interface NotificationView {
  id: string;
  audienceRole: string | null;
  category: string;
  type: string;
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  metadata: unknown;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
  templateKey: string;
  templateParams: unknown;
  renderedLocale: string;
  translationFallback: boolean;
}

export interface NotificationListView {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
  unreadCount: number;
  nextCursor: string | null;
  hasMore: boolean;
  items: NotificationView[];
}
