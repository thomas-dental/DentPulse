import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a number as a currency amount with commas
 * @param value - The number to format
 * @returns Formatted string (e.g., 3000 -> "3,000")
 */
export function formatAmount(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  return value.toLocaleString('en-US');
}

/**
 * Parse a formatted amount string back to a number
 * @param value - The formatted string (e.g., "3,000")
 * @returns The numeric value (e.g., 3000)
 */
export function parseAmount(value: string): number {
  if (!value || value.trim() === '') {
    return 0;
  }
  // Remove commas and parse
  const cleanValue = value.replace(/,/g, '');
  const parsed = Number(cleanValue);
  return isNaN(parsed) ? 0 : parsed;
}
