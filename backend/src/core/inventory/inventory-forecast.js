// Quantities keep ledger precision. Formatting belongs at the presentation edge.
export function inventoryForecast({ stock, reorderLevel = 0, consumed = 0, movementCount = 0, days = 30 }) {
  const known = stock != null && Number.isFinite(stock);
  const average = known && movementCount > 0 ? consumed / days : null;
  return {
    avg_daily_consumption: average,
    days_remaining: average > 0 ? Math.round(stock / average * 10) / 10 : null,
    usage_history_available: known && movementCount > 0,
    observation_days: days,
    consumption_movements: movementCount,
    low_stock: known && stock <= reorderLevel,
    risk_reason: known && stock <= reorderLevel ? "At or below reorder level" : null,
  };
}
