/** Letter badge for an option index: A, B, C… (beyond Z no badge). */
export const optionKey = (index: number): string | undefined =>
  index < 26 ? String.fromCharCode(65 + index) : undefined;
