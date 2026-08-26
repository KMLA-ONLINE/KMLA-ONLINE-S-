export const ABSENCE_REASON_MIN_LENGTH = 2;
export const ABSENCE_REASON_MAX_LENGTH = 100;

export function normalizeAbsenceReason(value: string): string {
  return value.trim();
}

export function isAbsenceReasonValid(value: string): boolean {
  const length = normalizeAbsenceReason(value).length;

  return (
    length >= ABSENCE_REASON_MIN_LENGTH && length <= ABSENCE_REASON_MAX_LENGTH
  );
}
