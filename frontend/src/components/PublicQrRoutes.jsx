import React, { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";

const QrOrdering = lazy(() => import("../pages/QrOrdering").then((module) => ({ default: module.QrOrdering })));
const QrOrderTracking = lazy(() => import("../pages/QrOrdering").then((module) => ({ default: module.QrOrderTracking })));

// Customer pages must never mount staff auth, outlet loading or offline till recovery.
export const PublicQrRoutes = ({ children }) => (
  <Suspense fallback={<div role="status" style={{ padding: 24 }}>Loading menu...</div>}>
    <Routes>
      <Route path="/qr/orders/:trackingToken" element={<QrOrderTracking />} />
      <Route path="/qr/:token" element={<QrOrdering />} />
      <Route path="*" element={children} />
    </Routes>
  </Suspense>
);
