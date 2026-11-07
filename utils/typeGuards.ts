/**
 * Runtime shape checks shared by the load and migration code, where saved data comes from
 * IndexedDB or a file and has to be inspected before it is trusted.
 */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

/** The value as a plain object, or undefined for anything else. */
export const asRecord = (value: unknown): Record<string, unknown> | undefined =>
    isRecord(value) ? value : undefined;
