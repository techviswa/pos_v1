import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import axios from "axios";

import { useAuth } from "../../../contexts/AuthContext";

const API_URL = process.env.REACT_APP_BACKEND_URL;
const ACTIVE_OUTLET_STORAGE_KEY = "cashflow-lite-active-outlet";

const ActiveOutletContext = createContext(null);

const getOutletStorageKey = (user) => {
  const businessKey = user?.business_id || user?.businessId || user?.tenantId || "guest";
  return `${ACTIVE_OUTLET_STORAGE_KEY}:${businessKey}`;
};

const getStoredOutletId = (user) => {
  try {
    return window.sessionStorage.getItem(getOutletStorageKey(user)) || "";
  } catch {
    return "";
  }
};

const persistOutletId = (user, outletId) => {
  try {
    const storageKey = getOutletStorageKey(user);
    if (outletId) {
      window.sessionStorage.setItem(storageKey, outletId);
      return;
    }

    window.sessionStorage.removeItem(storageKey);
  } catch {
    // Ignore storage failures so outlet selection never blocks the UI.
  }
};

export const ActiveOutletProvider = ({ children }) => {
  const { user } = useAuth();
  const [outlets, setOutlets] = useState([]);
  const [selectedOutletId, setSelectedOutletIdState] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const loadOutlets = async () => {
      if (!user) {
        if (!cancelled) {
          setOutlets([]);
          setSelectedOutletIdState("");
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      try {
        const response = await axios.get(`${API_URL}/api/outlets`, {
          withCredentials: true,
        });
        if (!cancelled) {
          setOutlets(response.data || []);
        }
      } catch {
        if (!cancelled) {
          setOutlets([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadOutlets();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const availableOutlets = useMemo(() => {
    if (!user) {
      return [];
    }

    const assignedOutletIds = user.assigned_outlet_ids || [];
    if (user.role === "Owner" || user.role === "Manager" || !assignedOutletIds.length) {
      return outlets;
    }

    const allowedOutletIds = new Set(assignedOutletIds);
    return outlets.filter((outlet) => allowedOutletIds.has(outlet.id));
  }, [outlets, user]);

  useEffect(() => {
    if (loading) {
      return;
    }

    const allowedOutletIds = new Set(availableOutlets.map((outlet) => outlet.id));
    if (selectedOutletId && allowedOutletIds.has(selectedOutletId)) {
      return;
    }

    const storedOutletId = getStoredOutletId(user);
    const nextOutletId =
      storedOutletId && allowedOutletIds.has(storedOutletId)
        ? storedOutletId
        : availableOutlets.length === 1
          ? availableOutlets[0].id
          : "";

    setSelectedOutletIdState(nextOutletId);
    persistOutletId(user, nextOutletId);
  }, [availableOutlets, loading, selectedOutletId, user]);

  const setSelectedOutletId = useCallback((outletId) => {
    const normalizedOutletId = outletId || "";
    setSelectedOutletIdState(normalizedOutletId);
    persistOutletId(user, normalizedOutletId);
  }, [user]);

  const selectedOutlet =
    availableOutlets.find((outlet) => outlet.id === selectedOutletId) || null;

  const value = useMemo(
    () => ({
      outlets: availableOutlets,
      loading,
      selectedOutlet,
      selectedOutletId,
      setSelectedOutletId,
      clearSelectedOutlet: () => setSelectedOutletId(""),
      hasOutletSelection: Boolean(selectedOutletId),
    }),
    [availableOutlets, loading, selectedOutlet, selectedOutletId, setSelectedOutletId],
  );

  return (
    <ActiveOutletContext.Provider value={value}>
      {children}
    </ActiveOutletContext.Provider>
  );
};

export const useActiveOutlet = () => {
  const context = useContext(ActiveOutletContext);
  if (!context) {
    throw new Error("useActiveOutlet must be used within ActiveOutletProvider");
  }
  return context;
};
