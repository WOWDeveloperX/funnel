/** Two-digit display used by the progress counter and the result list ("03"). */
export const pad2 = (n: number): string => String(Math.max(0, n)).padStart(2, '0');
