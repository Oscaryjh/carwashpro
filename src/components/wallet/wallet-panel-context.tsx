"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { walletPanelAction } from "@/app/(business)/crm/wallet/actions";
import { walletMoney, type WalletPanel } from "./wallet-views";

type WalletPanelRead = {
  customerId: string;
  enabled: boolean;
  panel: WalletPanel | null;
  pending: boolean;
  error: string;
  refresh: () => void;
};
export const WalletPanelContext = createContext<WalletPanelRead | null>(null);

// CRM shares the existing authorized DTO between its metric and Overview card.
export function CrmWalletProvider({ customerId, enabled, children }: { customerId: string; enabled: boolean; children: ReactNode }) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ customerId: string; revision: number; panel: WalletPanel | null; error: string } | null>(null);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    async function load() {
      try {
        const response = await walletPanelAction(customerId);
        if (current) setResult({ customerId, revision, panel: response.ok ? response.data : null, error: response.ok ? "" : response.message });
      } catch {
        if (current) setResult({ customerId, revision, panel: null, error: "Wallet balance is unavailable. Try again." });
      }
    }
    void load();
    return () => { current = false; };
  }, [customerId, enabled, revision]);
  const visible = enabled && result?.customerId === customerId && result.revision === revision ? result : null;
  return <WalletPanelContext.Provider value={{ customerId, enabled, panel: visible?.panel ?? null, error: visible?.error ?? "", pending: enabled && !visible, refresh }}>{children}</WalletPanelContext.Provider>;
}

export function CrmWalletMetric() {
  const read = useContext(WalletPanelContext);
  if (!read?.enabled) return null;
  return <div className="crm-wallet-metric" aria-live="polite">
    <span>Wallet</span>
    <strong title={read.error || undefined}>{read.panel ? walletMoney(read.panel.totalBalance) : read.pending ? "Loading…" : "Unavailable"}</strong>
  </div>;
}
