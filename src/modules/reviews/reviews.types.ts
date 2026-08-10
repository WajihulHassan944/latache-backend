export interface ReviewPersonView {
  id: string;
  name: string;
  avatar: string;
  role: string;
}

export interface ReviewView {
  id: string;
  bookingId: string;
  rating: number;
  comment: string;
  author: ReviewPersonView;
  recipient: ReviewPersonView;
  canEdit: boolean;
  canDelete: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewListView {
  view: 'received' | 'given';
  averageRating: number;
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
  items: ReviewView[];
}
