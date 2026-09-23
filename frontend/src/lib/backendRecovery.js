export const isTemporaryBackendFailure = (error) =>
  error?.code !== 'ERR_CANCELED' && (!error?.response || [502, 503, 504].includes(error.response.status));

export const canRetryRead = (error) => Boolean(error?.config)
  && !error.config._wakeRetry
  && !error.config.signal?.aborted
  && ['get', 'head', 'options'].includes(String(error.config.method || 'get').toLowerCase())
  && isTemporaryBackendFailure(error);

export function createBackendRecovery(probe) {
  let pending;
  return () => {
    if (!pending) pending = Promise.resolve().then(probe).finally(() => { pending = null; });
    return pending;
  };
}
