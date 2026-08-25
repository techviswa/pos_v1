import React, { createContext, useContext, useMemo, useState } from "react";
import { DEFAULT_UI_SETTINGS, getStoredUiSettings, saveStoredUiSettings } from "../lib/pos";

const UiContext = createContext(null);

export const UiProvider = ({ children }) => {
  const [settings, setSettings] = useState(getStoredUiSettings);

  const updateSettings = (partial) => {
    setSettings((current) => {
      const next = { ...current, ...partial };
      saveStoredUiSettings(next);
      return next;
    });
  };

  const resetSettings = () => {
    saveStoredUiSettings(DEFAULT_UI_SETTINGS);
    setSettings(DEFAULT_UI_SETTINGS);
  };

  const value = useMemo(
    () => ({ settings, updateSettings, resetSettings }),
    [settings]
  );

  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
};

export const useUi = () => {
  const context = useContext(UiContext);
  if (!context) {
    throw new Error("useUi must be used within UiProvider");
  }
  return context;
};
