export interface PaginationView {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
}

export interface MoneyView {
  amount: number;
  currency: string;
}

export interface PersonSummaryView {
  id: string;
  name: string;
  avatar: string;
  phoneCountryCode?: string;
  phoneNumber?: string;
}

export interface ServiceSummaryView {
  id: string;
  slug: string;
  name: string;
  icon: string;
}

export interface TaskActionView {
  confirm: boolean;
  cancel: boolean;
  startNavigation: boolean;
  markArrived: boolean;
  startTimer: boolean;
  pauseTimer: boolean;
  resumeTimer: boolean;
  stopTimer: boolean;
  complete: boolean;
  messageCustomer: boolean;
  reviewCustomer: boolean;
}

export interface TaskerTaskView {
  id: string;
  status: string;
  date: string;
  startTime: string;
  endTime: string;
  hourlyRate: MoneyView;
  estimatedPrice: MoneyView;
  service: ServiceSummaryView;
  customer: PersonSummaryView;
  location: {
    label: string;
    venueAddress: string;
    apartmentSuite: string | null;
    lat: number;
    lng: number;
    city: string | null;
    area: string | null;
  };
  description: string;
  attachments: unknown[];
  lifecycle: {
    confirmedAt: string | null;
    enRouteAt: string | null;
    arrivedAt: string | null;
    taskStartedAt: string | null;
    taskCompletedAt: string | null;
    cancelledAt: string | null;
    cancellationReason: string | null;
  };
  actions: TaskActionView;
}

export interface TaskerTaskListView extends PaginationView {
  bucket: 'booked' | 'ongoing' | 'history';
  items: TaskerTaskView[];
}

export interface TaskTimerView {
  bookingId: string;
  status: 'not_started' | 'running' | 'paused' | 'stopped';
  startedAt: string | null;
  pausedAt: string | null;
  stoppedAt: string | null;
  accumulatedPausedSeconds: number;
  elapsedSeconds: number;
  notes: string;
}

export interface NavigationView {
  bookingId: string;
  status: string;
  customer: PersonSummaryView;
  destination: {
    label: string;
    venueAddress: string;
    apartmentSuite: string | null;
    lat: number;
    lng: number;
  };
  latestTaskerLocation: {
    lat: number;
    lng: number;
    accuracyM: number | null;
    headingDeg: number | null;
    capturedAt: string;
  } | null;
  routeMetrics: null;
  routeMetricsReason: string;
  actions: TaskActionView;
}


export interface TaskerSkillView {
  serviceId: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  active: boolean;
  hourlyRate: number | null;
}

export interface TaskerPersonalProfileView {
  firstName: string;
  lastName: string;
  email: string;
  phoneCountryCode: string;
  phoneNumber: string;
  bio: string;
  profilePicture: string;
}

export interface TaskerBusinessProfileView {
  yearsOfExperience: number | null;
  isProfilePublic: boolean;
  serviceArea: {
    label: string | null;
    lat: number | null;
    lng: number | null;
    radiusKm: number | null;
    city: string | null;
    area: string | null;
  };
  skills: TaskerSkillView[];
}

export interface PayoutCapabilityView {
  type: string;
  setupSupported: boolean;
  withdrawalSupported: boolean;
  executionMode: string;
  reason: string | null;
}

export interface PayoutMethodView {
  id: string;
  type: string;
  label: string;
  maskedIdentifier: string;
  isDefault: boolean;
  status: string;
  createdAt: string;
}

export interface WalletTransactionView {
  id: string;
  kind: string;
  status: string;
  amount: MoneyView;
  availableDelta: number;
  pendingDelta: number;
  description: string;
  bookingId: string | null;
  withdrawalId: string | null;
  booking: {
    customer: PersonSummaryView;
    service: ServiceSummaryView;
  } | null;
  createdAt: string;
}

export interface WithdrawalView {
  id: string;
  amount: MoneyView;
  status: string;
  payoutMethod: PayoutMethodView;
  providerReference: string | null;
  failureReason: string | null;
  requestedAt: string;
  processedAt: string | null;
  cancelledAt: string | null;
}

export interface WalletSummaryView {
  availableBalance: MoneyView;
  pendingBalance: MoneyView;
  totalEarningsThisMonth: MoneyView;
  totalWithdrawn: MoneyView;
  payoutExecutionMode: string;
  payoutPinConfigured: boolean;
}

export interface PayoutSecurityView {
  pinConfigured: boolean;
  lockedUntil: string | null;
}

export interface WalletTransactionsListView extends PaginationView {
  items: WalletTransactionView[];
}

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

export interface NotificationListView extends PaginationView {
  unreadCount: number;
  items: NotificationView[];
}

export interface ChatMessageView {
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
  customer: PersonSummaryView;
  service: ServiceSummaryView;
  bookingStatus: string;
  lastMessage: ChatMessageView | null;
  unreadCount: number;
}

export interface ConversationListView extends PaginationView {
  items: ConversationView[];
}

export interface MessageListView extends PaginationView {
  bookingId: string;
  customer: PersonSummaryView;
  items: ChatMessageView[];
}

export interface ReviewView {
  id: string;
  bookingId: string;
  rating: number;
  comment: string;
  author: PersonSummaryView;
  recipient: PersonSummaryView;
  canEdit: boolean;
  canDelete: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewListView extends PaginationView {
  view: 'received' | 'given';
  averageRating: number;
  items: ReviewView[];
}

export interface DashboardOverviewView {
  tasker: {
    id: string;
    firstName: string;
    profilePicture: string;
    onboardingStatus: string | null;
    accountStatus: string;
  };
  setup: {
    completed: number;
    total: number;
    steps: Array<{
      key: 'payout_method' | 'profile_picture' | 'skill';
      completed: boolean;
    }>;
  };
  wallet: WalletSummaryView;
  metrics: {
    totalEarnings: MoneyView;
    averageRatingReceived: number;
    averageRatingGiven: number;
    taskCompletionPercent: number;
    completedTasks: number;
  };
  nextTask: TaskerTaskView | null;
  monthlyEarnings: Array<{ month: string; amount: number; currency: string }>;
  elite: {
    isElite: boolean;
    completedTasks: number;
    progress: null;
    criteriaConfigured: false;
  };
  recentTransactions: WalletTransactionView[];
}
