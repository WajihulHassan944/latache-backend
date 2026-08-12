export const normalizePagination = (
  page: number | undefined,
  limit: number | undefined,
  defaultLimit: number,
  maximumLimit = 100,
): { page: number; limit: number; offset: number } => {
  const normalizedPage = page && page > 0 ? Math.floor(page) : 1;
  const normalizedLimit =
    limit && limit > 0 ? Math.min(Math.floor(limit), maximumLimit) : defaultLimit;
  return {
    page: normalizedPage,
    limit: normalizedLimit,
    offset: (normalizedPage - 1) * normalizedLimit,
  };
};
