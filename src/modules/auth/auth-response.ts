export interface SuccessEnvelope<T> {
  success: true;
  data: T;
  message: string;
}

export const success = <T>(data: T, message: string): SuccessEnvelope<T> => ({
  success: true,
  data,
  message,
});
