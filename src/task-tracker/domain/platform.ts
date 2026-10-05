export const PLATFORM = "stub" as const;

export type Platform = typeof PLATFORM | "waha";
