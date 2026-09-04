import type { User } from '../../generated/prisma/client';
import { ADMINISTRATIVE_ROLES, UserRole } from '../enums/user-role.enum';
import { userRoles } from './user-role.util';

/** Every role sees these: core identity, contact, and account-state fields. */
const SHARED_FIELDS = [
  'id',
  'firstName',
  'lastName',
  'email',
  'phoneCountryCode',
  'phoneNumber',
  'preferredLanguage',
  'zipCode',
  'profilePicture',
  'bio',
  'accountStatus',
  'isVerified',
  'isAdmin',
  'authType',
  'lastLoginAt',
  'acceptedTermsAt',
  'acceptedPrivacyAt',
  'createdAt',
  'updatedAt',
] as const;

/** Booking/marketplace-participant fields shared by Customer and Tasker only. */
const MARKETPLACE_SHARED_FIELDS = [
  'disputeStrikePoints',
  'disciplinaryState',
  'lastDisciplinaryActionAt',
  'rating',
  'reviewsCount',
  'completedTasks',
  'referralCode',
] as const;

const CUSTOMER_ONLY_FIELDS = [
  'stripeCustomerId',
  'defaultStripePaymentMethodId',
  'latitude',
  'longitude',
  'locationUpdatedAt',
] as const;

const TASKER_ONLY_FIELDS = [
  'yearsOfExperience',
  'hourlyRate',
  'idType',
  'isDocVerified',
  'docType',
  'dateOfBirth',
  'isProfilePublic',
  'serviceAreaLabel',
  'serviceAreaLat',
  'serviceAreaLng',
  'serviceAreaRadiusKm',
  'serviceAreaCity',
  'serviceAreaArea',
  'onboardingStatus',
  'submittedAt',
  'vehicles',
  'workImages',
  'isElite',
  'eliteTierId',
  'eliteSince',
  'eliteAtRiskSince',
  'eliteGraceUntil',
  'eliteLastEvaluatedAt',
  'aboutMe',
  'skills',
] as const;

const ADMIN_ONLY_FIELDS = [
  'adminRole',
  'permissions',
  'rbacRoleId',
  'inheritsRolePermissions',
  'mustChangePassword',
  'createdById',
] as const;

const ROLE_FIELDS: Partial<Record<UserRole, readonly string[]>> = {
  [UserRole.Customer]: [...MARKETPLACE_SHARED_FIELDS, ...CUSTOMER_ONLY_FIELDS],
  [UserRole.Tasker]: [...MARKETPLACE_SHARED_FIELDS, ...TASKER_ONLY_FIELDS],
  [UserRole.Admin]: ADMIN_ONLY_FIELDS,
  [UserRole.SuperAdmin]: ADMIN_ONLY_FIELDS,
};

export type PublicUser = Record<string, unknown>;

/**
 * Serializes the single Latache identity for the currently active portal role
 * only: Customer/Tasker/Admin each see just their own relevant subset of the
 * shared User row, not the full record (which also carries every other role's
 * fields, since Customer, Tasker, and Admin data all live on one table).
 * `primaryRole` is the original/canonical database role and `roles` lists
 * every enabled role; `role` stays the legacy field name for the active one.
 */
export const serializeUser = (user: User, activeRole?: UserRole): PublicUser => {
  const source = user as unknown as Record<string, unknown>;
  const roles = userRoles(user);
  const selected = (activeRole ?? (user.role as UserRole)) as UserRole;
  const allowedFields = new Set<string>([...SHARED_FIELDS, ...(ROLE_FIELDS[selected] ?? [])]);

  const plain: Record<string, unknown> = {};
  for (const field of allowedFields) {
    plain[field] = source[field];
  }

  plain.primaryRole = user.role;
  plain.roles = roles;
  plain.activeRole = selected;
  plain.role = selected;

  if (ADMINISTRATIVE_ROLES.some((role) => roles.includes(role))) {
    plain.adminId = `ADM-${String(user.id).padStart(3, '0')}`;
  }

  plain.preferredLanguage = user.preferredLanguage ?? 'en';

  return plain;
};
