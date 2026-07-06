"use client";

import React, { createContext, useContext, useMemo, useEffect } from "react";
import { useStore } from "react-redux";
import { WatchPartyGatewayEngine } from "@/core/services/WatchPartyGatewayEngine";

interface EngineContextLayout {
  gatewayEngine: WatchPartyGatewayEngine;
}

const EngineContext = createContext<EngineContextLayout | null>(null);

export function EngineProvider({ children }: { children: React.ReactNode }) {
  const store = useStore();

  const activeEngines = useMemo(() => {
    return {
      gatewayEngine: new WatchPartyGatewayEngine(store),
    };
  }, [store]);

  useEffect(() => {
    return () => {
      activeEngines.gatewayEngine.disconnect();
    };
  }, [activeEngines]);

  return (
    <EngineContext.Provider value={activeEngines}>
      {children}
    </EngineContext.Provider>
  );
}

export function useEngine() {
  const context = useContext(EngineContext);
  if (!context) {
    throw new Error("useEngine must be called strictly downstream from an EngineProvider layout container.");
  }
  return context;
}