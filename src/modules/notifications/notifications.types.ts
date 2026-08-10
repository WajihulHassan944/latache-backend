export interface NotificationView {
  id: string;
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
}

export interface NotificationListView {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
  unreadCount: number;
  items: NotificationView[];
}
