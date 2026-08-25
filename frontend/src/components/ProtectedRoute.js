import React from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { hasPermission } from '../lib/pos';
import { getDefaultRouteForUser } from '../core/navigation/utils/defaultRoute';
import { ApiErrorPanel } from './ApiErrorPanel';

const AccessDenied = ({ user, reason }) => {
  const navigate = useNavigate();
  const defaultRoute = getDefaultRouteForUser(user);

  return (
    <div className="cf-app-error">
      <ApiErrorPanel
        action="Open the correct role screen, or sign in in another tab with an account that has this permission."
        message={reason}
        onBack={() => navigate(defaultRoute, { replace: true })}
        title="Access denied"
      />
    </div>
  );
};

export const ProtectedRoute = ({ children, requireOwner = false, requirePermission = null, requireRoles = null, allowIncompleteProfile = false }) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-[#002DF5] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-[#475467] font-medium">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!allowIncompleteProfile && user.profile_required && location.pathname !== "/complete-profile") {
    return <Navigate to="/complete-profile" replace />;
  }

  if (requireOwner && user.role !== 'Owner') {
    return <AccessDenied reason="Only an Owner account can open this screen." user={user} />;
  }

  if (requireRoles && !requireRoles.includes(user.role)) {
    return (
      <AccessDenied
        reason={`This screen is for ${requireRoles.join(" or ")}. You are signed in as ${user.role}.`}
        user={user}
      />
    );
  }

  if (requirePermission && !hasPermission(user, requirePermission)) {
    return (
      <AccessDenied
        reason={`Your account does not have the "${requirePermission}" permission.`}
        user={user}
      />
    );
  }

  return children;
};
