export const REFRESH_TOKEN_BYTES = 64;
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;
export const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>])[A-Za-z\d!@#$%^&*(),.?":{}|<>]{8,128}$/;
export const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const CLOCK_TIME_PATTERN = /^(?:(?:0?[1-9]|1[0-2]):[0-5]\d\s*(?:AM|PM)|(?:[01]?\d|2[0-3]):[0-5]\d)$/i;
