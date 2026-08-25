import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';
import { clearTabSessionId, getTabSessionHeaders, getTabSessionId, setTabSessionId } from '../lib/sessionSlots';

const AuthContext = createContext();

const API_URL = (() => {
  const configured = String(process.env.REACT_APP_BACKEND_URL || "").replace(/\/+$/, "");
  if (typeof window === "undefined") return configured;

  const currentOrigin = window.location.origin.replace(/\/+$/, "");
  const currentHost = window.location.hostname;
  if (configured && configured !== currentOrigin && !configured.includes("vercel.app")) {
    return configured;
  }

  if (currentHost === "localhost" || currentHost === "127.0.0.1") {
    return configured || "http://localhost:4001";
  }

  return "https://pos-v1-fwjm.onrender.com";
})();
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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    const requestInterceptor = axios.interceptors.request.use((config) => {
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
            setUser(false);
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

  const checkAuth = async () => {
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
        setUser(false);
        return false;
      }
    } finally {
      setLoading(false);
    }
  };

  const login = async (email, password) => {
    const { data } = await axios.post(
      `${API_URL}/api/auth/login`,
      { email, password },
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
      clearTabSessionId();
      clearRequestCaches();
      setUser(false);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, checkAuth }}>
      {children}
    </AuthContext.Provider>
  );
};

