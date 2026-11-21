export const fillSalesDays = (rows = []) => {
  const sorted = [...rows].filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date)).sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 2) return sorted;
  const indexed = new Map(sorted.map((row) => [row.date, row]));
  const result = [];
  const end = new Date(`${sorted.at(-1).date}T00:00:00Z`);
  for (let day = new Date(`${sorted[0].date}T00:00:00Z`); day <= end; day.setUTCDate(day.getUTCDate() + 1)) {
    const date = day.toISOString().slice(0, 10);
    result.push(indexed.get(date) || { date, sales: 0, bills: 0 });
  }
  return result;
};
