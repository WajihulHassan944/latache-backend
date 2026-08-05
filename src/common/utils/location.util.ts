const toNumberOrNull = (value: string | number | null | undefined): number | null =>
  value === null || value === undefined ? null : Number(value);

export interface LocationSource {
  label?: string | null;
  lat?: string | number | null;
  lng?: string | number | null;
  city?: string | null;
  area?: string | null;
  radiusKm?: string | number | null;
}

export const formatLocation = (source: LocationSource = {}) => ({
  ...(source.label !== undefined ? { label: source.label } : {}),
  lat: toNumberOrNull(source.lat),
  lng: toNumberOrNull(source.lng),
  city: source.city ?? null,
  area: source.area ?? null,
  ...(source.radiusKm !== undefined
    ? { serviceRadiusKm: toNumberOrNull(source.radiusKm) }
    : {}),
});
