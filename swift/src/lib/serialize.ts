// Helpers for the String-encoded JSON columns (SQLite-friendly).
import { RubricCriterion } from "./constants";

export function parseJSON<T>(value: string | null | undefined, fallback: T): T {
  if (value === null || value === undefined || value === "") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export const parseScores = (s: string | null | undefined): Record<string, number> =>
  parseJSON<Record<string, number>>(s, {});

export const parseFlags = (s: string | null | undefined): string[] => parseJSON<string[]>(s, []);

export const parseUrls = (s: string | null | undefined): string[] => parseJSON<string[]>(s, []);

export const parseCriteria = (s: string | null | undefined): RubricCriterion[] =>
  parseJSON<RubricCriterion[]>(s, []);
