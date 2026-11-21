import React from 'react';
import { Layout } from '../components/Layout';
import { API_URL } from '../lib/apiUrl';
import { useUi } from '../contexts/UiContext';
import { useAuth } from '../contexts/AuthContext';
import { useActiveOutlet } from '../core/outlets/store/ActiveOutletContext';
import { CashierSettlement } from '../core/billing/components/CashierSettlement';
import { OutletOverviewPanel } from '../core/outlets/components/OutletOverviewPanel';

export const CashDrawer = () => {
  const { settings } = useUi();
  const { user } = useAuth();
  const { selectedOutlet, selectedOutletId } = useActiveOutlet();
  return <Layout title={selectedOutlet ? `Cash drawer · ${selectedOutlet.name}` : 'Cash drawer'}>
    <div className="cf-page" data-testid="cash-drawer-page">
      <div className="cf-page__header"><div><h1>Cash drawer</h1><p>Open and reconcile cashier shifts, then review completed settlements.</p></div></div>
      {!selectedOutletId ? <OutletOverviewPanel description="Select an outlet to manage its cash drawer and settlement history." />
        : user?.offline ? <p role="status">Connect to manage shifts and view confirmed settlements.</p>
          : <CashierSettlement key={selectedOutletId} initiallyOpen apiUrl={API_URL} outletId={selectedOutletId} currency={settings.currency} />}
    </div>
  </Layout>;
};
