export interface PersonSummaryView {
  id: string;
  name: string;
  avatar: string;
  role: 'customer' | 'tasker';
  phoneCountryCode?: string;
  phoneNumber?: string;
}

export interface ConversationMessageView {
  id: string;
  bookingId: string;
  senderId: string;
  isMine: boolean;
  body: string;
  attachments: unknown[];
  readAt: string | null;
  createdAt: string;
}

export interface ConversationView {
  bookingId: string;
  otherParty: PersonSummaryView;
  service: {
    id: string;
    slug: string;
    name: string;
    icon: string;
  };
  bookingStatus: string;
  lastMessage: ConversationMessageView | null;
  unreadCount: number;
}

export interface ConversationListView {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
  items: ConversationView[];
}

export interface MessageListView {
  bookingId: string;
  otherParty: PersonSummaryView;
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
  items: ConversationMessageView[];
}
