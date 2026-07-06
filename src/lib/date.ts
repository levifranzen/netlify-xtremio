export function formatDate(dateStr?: string): string | undefined {
  if (!dateStr) return undefined;
  const time = Date.parse(dateStr);
  if (Number.isNaN(time)) return dateStr;
  return new Date(time).toISOString();
}
