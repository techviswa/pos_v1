// Operating selectors use active outlets. Reports also retain closed outlets
// with transactions so closure cannot erase or change historical totals.
export const reportOutlets = (outlets, historicalOutletIds, selectedOutletId = null) =>
  outlets.filter(outlet =>
    (!selectedOutletId || outlet.id === selectedOutletId) &&
    (!['inactive', 'archived'].includes(String(outlet.status || 'active').toLowerCase()) || historicalOutletIds.has(outlet.id))
  );
