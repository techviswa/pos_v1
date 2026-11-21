import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { DEFAULT_UI_SETTINGS } from '../lib/pos';
import { API_URL, useAuth } from './AuthContext';
import { apiData } from '../lib/apiData';
import { subscribeLiveUpdates } from '../lib/liveUpdates';

const UiContext = createContext(null);

export const UiProvider = ({ children }) => {
  const { user } = useAuth();
  const businessId = user?.business_id || user?.businessId;
  const [snapshot, setSnapshot] = useState(null);
  const [profileError, setProfileError] = useState('');
  const generation = useRef(0);
  const confirmed = useRef(null);
  const invalidateReads = useCallback(() => { generation.current++; }, []);
  const currentBusiness = useRef(businessId);
  currentBusiness.current = businessId;
  const accept = useCallback((id, data) => {
    if (currentBusiness.current !== id) return;
    if (confirmed.current?.id === id && Date.parse(confirmed.current.data?.updated_at) > Date.parse(data?.updated_at)) return;
    confirmed.current = { id, data };
    setSnapshot({ id, data });
    setProfileError('');
    try { localStorage.setItem(`cashflow-lite-business-profile:${id}`, JSON.stringify(data)); } catch { /* optional offline copy */ }
  }, []);
  const refreshProfile = useCallback(async () => {
    if (!businessId || user?.offline) return;
    const request = ++generation.current;
    try {
      const response = await axios.get(`${API_URL}/api/businesses/profile`, { withCredentials: true, skipCache: true });
      const data = apiData(response);
      if (data?.business_id !== businessId || typeof data?.shopName !== 'string' || !data?.updated_at) throw new Error('Invalid business profile response');
      if (request === generation.current) accept(businessId, data);
    } catch {
      if (request === generation.current) setProfileError('Business details could not be refreshed. Retry before editing.');
    }
  }, [businessId, user?.offline, accept]);
  useEffect(() => {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(`cashflow-lite-business-profile:${businessId}`)); } catch { /* no offline copy */ }
    if (data?.business_id !== businessId) data = null;
    confirmed.current = businessId ? { id: businessId, data } : null;
    setSnapshot(businessId ? { id: businessId, data } : null);
    setProfileError('');
    refreshProfile();
    const refresh = () => { if (document.visibilityState !== 'hidden') refreshProfile(); };
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    const unsubscribe = businessId && !user?.offline ? subscribeLiveUpdates(event => {
      if (['businesses', '*'].includes(event.resource)) refreshProfile();
    }) : () => {};
    return () => { invalidateReads(); unsubscribe(); window.clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh); };
  }, [businessId, user?.offline, refreshProfile, invalidateReads]);
  // The old unscoped browser cache must never supply another business's identity.
  const settings = useMemo(() => ({ ...DEFAULT_UI_SETTINGS, shopName: '', gst: '', address: '', phone: '', ...(snapshot?.id === businessId ? snapshot?.data : null) }), [snapshot, businessId]);
  const updateSettings = async (partial, expectedVersion = settings.updated_at) => {
    if (!businessId || !expectedVersion || user?.offline) throw new Error('Load the online business profile before saving.');
    generation.current++;
    const response = await axios.put(`${API_URL}/api/businesses/profile`, { ...partial, expected_updated_at: expectedVersion }, { withCredentials: true });
    const result = apiData(response);
    if (currentBusiness.current === businessId) { generation.current++; accept(businessId, result); }
    return result;
  };
  const value = { settings, updateSettings, profileError, refreshProfile,
    profileLoaded: Boolean(settings.updated_at) && !profileError && !user?.offline };

  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
};

export const useUi = () => {
  const context = useContext(UiContext);
  if (!context) {
    throw new Error("useUi must be used within UiProvider");
  }
  return context;
};
