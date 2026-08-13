export const normalizeHttpOrigin = (value: string | undefined): string | undefined => {
  if (!value) return undefined;

  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
};

export const buildAllowedOrigins = (
  configuredOrigins: readonly string[],
  apiBaseUrl?: string,
): ReadonlySet<string> => {
  const normalized = [...configuredOrigins, apiBaseUrl]
    .map((origin) => normalizeHttpOrigin(origin))
    .filter((origin): origin is string => Boolean(origin));

  return new Set(normalized);
};
