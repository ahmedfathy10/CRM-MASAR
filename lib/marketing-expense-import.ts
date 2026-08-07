const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function validDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function parseMarketingImportDate(value: unknown) {
  const input = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const [year, month, day] = input.split("-").map(Number);
    return validDate(year, month, day) ? input : "";
  }
  const numeric = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (numeric) {
    const month = Number(numeric[1]),
      day = Number(numeric[2]),
      year = Number(numeric[3]);
    return validDate(year, month, day) ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : "";
  }
  const named = input.match(/^(\d{1,2})[-/\s]([A-Za-z]{3,9})[-/\s](\d{2}|\d{4})$/);
  if (!named) return "";
  const day = Number(named[1]),
    month = MONTHS[named[2].toLowerCase()] || 0,
    rawYear = Number(named[3]),
    year = named[3].length === 2 ? 2000 + rawYear : rawYear;
  return validDate(year, month, day) ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : "";
}
