import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';
import { canRetryRead, createBackendRecovery, isTemporaryBackendFailure } from '../lib/backendRecovery';
import { clearTabSessionId, getTabSessionHeaders, getTabSessionId, setTabSessionId } from '../lib/sessionSlots';
import { API_URL } from '../lib/apiUrl';
import { setOfflineOwner } from '../core/offline/offlineQueue';
import {
  clearOfflineData,
  clearOfflineSession,
  isUnreachable,
  loadOfflineSession,
  saveOfflineSession,
  setOfflineScope,
} from '../lib/offlineCache';

const AuthContext = createContext();
const recoveryClient = axios.create({ timeout: 65000 });

export { API_URL };
const isWrappedApiResponse = (payload) =>
  payload &&
  typeof payload === 'object' &&
  !Array.isArray(payload) &&
  Object.prototype.hasOwnProperty.call(payload, 'success') &&
  Object.prototype.hasOwnProperty.call(payload, 'data');

const unwrapApiData = (payload) => (isWrappedApiResponse(payload) ? payload.data : payload);
const isAuthEndpoint = (url = '') =>
  url.includes('/api/auth/login') || url.includes('/api/auth/logout') || url.includes('/api/auth/refresh') || url.includes('/api/auth/me');
const GET_CACHE_TTL_MS = 30000;
const MAX_GET_CACHE_ENTRIES = 40;
const responseCache = new Map();
const inflightRequests = new Map();

const buildCacheKey = (config = {}) => {
  const method = String(config.method || 'get').toLowerCase();
  const baseUrl = config.baseURL || '';
  const url = config.url || '';
  const params = JSON.stringify(config.params || {});
  return `${method}:${baseUrl}${url}:${params}`;
};

const cloneCachedResponse = (response) => ({
  ...response,
  data: response?.data,
  headers: { ...(response?.headers || {}) },
  config: { ...(response?.config || {}) },
});

const clearRequestCaches = () => {
  responseCache.clear();
  inflightRequests.clear();
};

const pruneResponseCache = () => {
  const now = Date.now();

  for (const [key, cached] of responseCache.entries()) {
    if (now - cached.timestamp >= GET_CACHE_TTL_MS) {
      responseCache.delete(key);
    }
  }

  while (responseCache.size > MAX_GET_CACHE_ENTRIES) {
    const oldestKey = responseCache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    responseCache.delete(oldestKey);
  }
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  // Offline bills and offline data copies are kept per signed-in user and business.
  useEffect(() => {
    setOfflineOwner(user || null);
    setOfflineScope(user || null);
    if (user && !user.offline) saveOfflineSession(user);
  }, [user]);
  const [loading, setLoading] = useState(true);
  const [waking, setWaking] = useState(false);
  const [authUnavailable, setAuthUnavailable] = useState(false);
  const [tenantNotice, setTenantNotice] = useState(null);

  useEffect(() => {
    const wakeBackend = createBackendRecovery(() => recoveryClient.get(`${API_URL}/health/ready`));
    const requestInterceptor = axios.interceptors.request.use((config) => {
      if (!config.timeout) config.timeout = 20000;
      const method = String(config.method || 'get').toLowerCase();
      const requestUrl = config.url || '';
      const tabSessionId = getTabSessionId();
      if (tabSessionId) {
        config.headers = {
          ...(config.headers || {}),
          ...getTabSessionHeaders(),
        };
      }

      if (method !== 'get') {
        clearRequestCaches();
        return config;
      }

      if (config.skipCache || isAuthEndpoint(requestUrl)) {
        return {
          ...config,
          metadata: {
            ...(config.metadata || {}),
            cacheKey: null,
          },
        };
      }

      const cacheKey = buildCacheKey(config);
      const now = Date.now();
      const cached = responseCache.get(cacheKey);

      if (cached && now - cached.timestamp < GET_CACHE_TTL_MS) {
        return {
          ...config,
          metadata: {
            ...(config.metadata || {}),
            cacheKey,
            servedFromCache: true,
          },
          adapter: async () => cloneCachedResponse(cached.response),
        };
      }

      if (inflightRequests.has(cacheKey)) {
        return {
          ...config,
          metadata: {
            ...(config.metadata || {}),
            cacheKey,
            servedFromInflight: true,
          },
          adapter: async () => cloneCachedResponse(await inflightRequests.get(cacheKey)),
        };
      }

      let resolveInflight;
      let rejectInflight;
      const inflightPromise = new Promise((resolve, reject) => {
        resolveInflight = resolve;
        rejectInflight = reject;
      });
      inflightPromise.catch(() => {});

      inflightRequests.set(cacheKey, inflightPromise);

      return {
        ...config,
        metadata: {
          ...(config.metadata || {}),
          cacheKey,
          resolveInflight,
          rejectInflight,
        },
      };
    });

    const interceptor = axios.interceptors.response.use(
      (response) => {
        const method = String(response?.config?.method || 'get').toLowerCase();
        const metadata = response?.config?.metadata || {};
        const cacheKey = metadata.cacheKey;
        const unwrappedData = unwrapApiData(response?.data);
        const normalizedResponse = {
          ...response,
          apiMeta: response?.data?.meta,
          apiMessage: response?.data?.message,
          data: unwrappedData,
        };

        if (method === 'get' && cacheKey && !metadata.servedFromCache && !metadata.servedFromInflight) {
          pruneResponseCache();
          responseCache.set(cacheKey, {
            timestamp: Date.now(),
            response: cloneCachedResponse(normalizedResponse),
          });
          metadata.resolveInflight?.(normalizedResponse);
          inflightRequests.delete(cacheKey);
        }

        return normalizedResponse;
      },
      async (error) => {
        const originalRequest = error.config;
        const status = error.response?.status;
        const requestUrl = originalRequest?.url || '';
        const cacheKey = originalRequest?.metadata?.cacheKey;
        const errorCode = error.response?.data?.error?.code;

        // Subscription lifecycle: tell the user why everything is refused instead of failing silently.
        if (errorCode === 'TENANT_SUSPENDED' || errorCode === 'SUBSCRIPTION_INACTIVE') {
          setTenantNotice({ code: errorCode, message: error.response.data.error.message });
        }

        if (canRetryRead(error) && !originalRequest.metadata?.servedFromInflight && navigator.onLine !== false) {
          const metadata = originalRequest.metadata;
          originalRequest._wakeRetry = true;
          setWaking(true);
          try {
            await wakeBackend();
            const response = await axios({ ...originalRequest, skipCache: true });
            metadata?.resolveInflight?.(response);
            if (cacheKey) inflightRequests.delete(cacheKey);
            return response;
          } catch (recoveryError) {
            error = recoveryError;
          } finally { setWaking(false); }
        }

        if (cacheKey) {
          if (!isAuthEndpoint(requestUrl)) {
            originalRequest?.metadata?.rejectInflight?.(error);
          }
          inflightRequests.delete(cacheKey);
        }

        if (
          status === 401 &&
          originalRequest &&
          !originalRequest._retry &&
          !isAuthEndpoint(requestUrl)
        ) {
          originalRequest._retry = true;
          try {
            const { data } = await axios.post(`${API_URL}/api/auth/refresh`, {}, {
              withCredentials: true,
              headers: getTabSessionHeaders(),
            });
            setUser(unwrapApiData(data));
            return axios({
              ...originalRequest,
              withCredentials: true,
            });
          } catch (refreshError) {
            if (refreshError.response?.status === 401) setUser(false);
            return Promise.reject(refreshError);
          }
        }

        if (status === 401 && isAuthEndpoint(requestUrl)) {
          setUser(false);
        }

        return Promise.reject(error);
      }
    );

    return () => {
      axios.interceptors.request.eject(requestInterceptor);
      axios.interceptors.response.eject(interceptor);
    };
  }, []);

  useEffect(() => { checkAuth(); }, []);

  const checkAuth = async () => {
    setLoading(true);
    setAuthUnavailable(false);
    try {
      const response = await axios.get(`${API_URL}/api/auth/me`, {
        withCredentials: true,
        headers: getTabSessionHeaders(),
        skipCache: true,
        validateStatus: (status) => status < 500,
      });
      if (response.status === 401) {
        setUser(false);
        return false;
      }
      const { data } = response;
      const unwrapped = unwrapApiData(data);
      if (!unwrapped) {
        setUser(false);
        return false;
      }
      setUser(unwrapped);
      return unwrapped;
    } catch (error) {
      // No connection at all: a cashier who was signed in on this tab keeps working from the tab's snapshot.
      // The server re-checks the session as soon as it is reachable again.
      const snapshot = isUnreachable(error) ? loadOfflineSession() : null;
      if (snapshot) {
        const offlineUser = { ...snapshot.user, offline: true };
        setUser(offlineUser);
        return offlineUser;
      }
      if (isTemporaryBackendFailure(error)) {
        setAuthUnavailable(true);
        return false;
      }
      try {
        const response = await axios.post(`${API_URL}/api/auth/refresh`, {}, {
          withCredentials: true,
          headers: getTabSessionHeaders(),
          validateStatus: (status) => status < 500,
        });
        if (response.status === 401) {
          setUser(false);
          return false;
        }
        const { data } = response;
        const unwrapped = unwrapApiData(data);
        setUser(unwrapped);
        return unwrapped;
      } catch (refreshError) {
        if (refreshError.response?.status === 401) setUser(false);
        else setAuthUnavailable(true);
        return false;
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user?.offline) return undefined;
    let cancelled = false;
    const revalidate = async () => {
      if (navigator.onLine === false) return;
      try {
        const response = await axios.get(`${API_URL}/api/auth/me`, {
          withCredentials: true,
          headers: getTabSessionHeaders(),
          skipCache: true,
          validateStatus: (status) => status < 500,
        });
        if (cancelled) return;
        const fresh = response.status === 401 ? null : unwrapApiData(response.data);
        // Signed out or revoked while offline: back to the login screen. Queued bills stay for this user.
        setUser(fresh || false);
      } catch {
        // still unreachable; keep working offline
      }
    };
    const timer = window.setInterval(revalidate, 30000);
    window.addEventListener('online', revalidate);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('online', revalidate);
    };
  }, [user?.offline]);

  const login = async (email, password, businessId = null) => {
    const { data } = await axios.post(
      `${API_URL}/api/auth/login`,
      { email, password, ...(businessId ? { business_id: businessId } : {}) },
      { withCredentials: true }
    );
    const unwrapped = unwrapApiData(data);
    const nextUser = unwrapped?.user || unwrapped;
    setTabSessionId(unwrapped?.session_id);
    clearRequestCaches();
    setUser(nextUser);
    return nextUser;
  };

  const logout = async () => {
    try {
      await axios.post(`${API_URL}/api/auth/logout`, {}, {
        withCredentials: true,
        headers: getTabSessionHeaders(),
      });
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      clearOfflineData();
      clearOfflineSession();
      clearTabSessionId();
      clearRequestCaches();
      setUser(false);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, checkAuth }}>
      {waking && <div role="status" style={{ padding: 12, background: '#fff3cd', color: '#332700' }}>The server may be waking up. Reconnecting…</div>}
      {tenantNotice && (
        <div role="alert" style={{ padding: 12, background: '#fdecea', color: '#611a15', display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ flex: 1 }}>{tenantNotice.message}</span>
          {tenantNotice.code === 'TENANT_SUSPENDED' && <button onClick={() => { setTenantNotice(null); logout(); }}>Sign out</button>}
          {tenantNotice.code === 'SUBSCRIPTION_INACTIVE' && <button onClick={() => setTenantNotice(null)}>Dismiss</button>}
        </div>
      )}
      {authUnavailable ? <div role="alert" style={{ padding: 24 }}><p>The server is temporarily unavailable. Your saved session has been kept.</p><button onClick={checkAuth}>Try connecting again</button></div> : children}
    </AuthContext.Provider>
  );
};

