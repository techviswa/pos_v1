import React, { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  CaretDoubleLeft,
  CaretDoubleRight,
  List,
  SignOut,
} from "@phosphor-icons/react";
import { useAuth } from "../contexts/AuthContext";
import { useUi } from "../contexts/UiContext";
import { getInitials } from "../lib/pos";
import { useClientModules } from "../core/modules/store/useClientModules";
import { useActiveOutlet } from "../core/outlets/store/ActiveOutletContext";
import { useBusinessTemplate } from "../core/platform/store/useBusinessTemplate";
import { getDefaultRouteForUser, getNavigationItemLabel, getVisibleNavigationGroups } from "../core/navigation/utils/appAccess";

const SIDEBAR_STATE_STORAGE_KEY = "cashflow-lite-sidebar-collapsed";

const getStoredSidebarState = () => {
  try {
    return window.localStorage.getItem(SIDEBAR_STATE_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
};

export const Layout = ({ title, children, billingMode = false }) => {
  const { user, logout } = useAuth();
  const { settings } = useUi();
  const { outlets, selectedOutletId, setSelectedOutletId, clearSelectedOutlet } = useActiveOutlet();
  const { isModuleEnabled } = useClientModules();
  const { isFeatureEnabled } = useBusinessTemplate();
  const navigate = useNavigate();
  const location = useLocation();
  const [clock, setClock] = useState(new Date());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(getStoredSidebarState);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const sidebarNavRef = useRef(null);
  const effectiveSidebarCollapsed = sidebarCollapsed && !mobileSidebarOpen;

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  const groupedItems = useMemo(() => {
    return getVisibleNavigationGroups({ user, isModuleEnabled, isFeatureEnabled });
  }, [isFeatureEnabled, isModuleEnabled, user]);

  useEffect(() => {
    const savedTop = Number(window.sessionStorage.getItem("cf-sidebar-scroll-top") || 0);
    if (sidebarNavRef.current && Number.isFinite(savedTop)) {
      sidebarNavRef.current.scrollTop = savedTop;
    }
  }, [groupedItems]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_STATE_STORAGE_KEY, String(sidebarCollapsed));
    } catch {
      // Ignore persistence failures so the layout still works.
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 960) {
        setMobileSidebarOpen(false);
      }
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setMobileSidebarOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const displayName = user?.name || "Staff";
  const displayEmail = user?.email || "staff@pos.com";
  const defaultPath = getDefaultRouteForUser(user);
  const showBackButton = location.pathname !== defaultPath;
  const canSwitchOutlets = user?.role === "Owner" || user?.role === "Manager";

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate(defaultPath);
  };

  return (
    <div className={`cf-shell ${billingMode ? "cf-shell--billing" : ""}`}>
      <header className="cf-topbar">
        <div className="cf-topbar__left">
          <button
            aria-label="Open navigation"
            className="cf-topbar__menu"
            onClick={() => setMobileSidebarOpen(true)}
            type="button"
          >
            <List size={18} weight="bold" />
          </button>
          {showBackButton ? (
            <button className="cf-topbar__back" onClick={handleBack} type="button">
              <ArrowLeft size={15} weight="bold" />
              <span>Back</span>
            </button>
          ) : null}
          <div className="cf-topbar__title">{title}</div>
        </div>
        <div className="cf-topbar__user">
          {canSwitchOutlets && outlets.length ? (
            <div className="cf-topbar__outlet-picker">
              <label htmlFor="cf-active-outlet">Outlet</label>
              <select
                className="cf-topbar__outlet-select"
                id="cf-active-outlet"
                onChange={(event) => {
                  if (!event.target.value) {
                    clearSelectedOutlet();
                    return;
                  }

                  setSelectedOutletId(event.target.value);
                }}
                value={selectedOutletId || ""}
              >
                <option value="">All outlets overview</option>
                {outlets.map((outlet) => (
                  <option key={outlet.id} value={outlet.id}>
                    {outlet.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <span className="cf-topbar__meta">
            {clock.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} ·{" "}
            {clock.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
          </span>
          <div className="cf-topbar__avatar">{getInitials(displayName)}</div>
          <span className="cf-topbar__name">{displayName}</span>
        </div>
      </header>

      <div className="cf-shell__body">
        {mobileSidebarOpen ? (
          <button
            aria-label="Close navigation"
            className="cf-sidebar__scrim"
            onClick={() => setMobileSidebarOpen(false)}
            type="button"
          />
        ) : null}
        <aside className={`cf-sidebar ${effectiveSidebarCollapsed ? "is-collapsed" : ""} ${mobileSidebarOpen ? "is-mobile-open" : ""}`}>
          <div className="cf-sidebar__logo">
            <div className="cf-sidebar__logo-row">
              <div className="cf-sidebar__brand">
                {effectiveSidebarCollapsed ? "CF" : <>Cash<span>Flow</span></>}
              </div>
              <button
                aria-label={effectiveSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                className="cf-sidebar__toggle"
                onClick={() => setSidebarCollapsed((current) => !current)}
                title={effectiveSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                type="button"
              >
                {effectiveSidebarCollapsed ? <CaretDoubleRight size={14} weight="bold" /> : <CaretDoubleLeft size={14} weight="bold" />}
              </button>
            </div>
            {!effectiveSidebarCollapsed ? <div className="cf-sidebar__gst">GST: {settings.gst}</div> : null}
          </div>

          <div
            className="cf-sidebar__nav"
            ref={sidebarNavRef}
            onScroll={(event) => {
              window.sessionStorage.setItem("cf-sidebar-scroll-top", String(event.currentTarget.scrollTop || 0));
            }}
          >
            {Object.entries(groupedItems).map(([group, items]) => (
              <div key={group}>
                {!effectiveSidebarCollapsed ? <div className="cf-nav__label">{group}</div> : null}
                {items.map((item) => {
                  const Icon = item.icon;
                  const itemLabel = getNavigationItemLabel({ item, user });
                  return (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      title={effectiveSidebarCollapsed ? itemLabel : undefined}
                      onClick={() => setMobileSidebarOpen(false)}
                      className={({ isActive }) =>
                        `cf-nav__item ${isActive ? "is-active" : ""}`
                      }
                    >
                      <Icon size={15} weight="bold" />
                      {!effectiveSidebarCollapsed ? <span>{itemLabel}</span> : null}
                    </NavLink>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="cf-sidebar__footer">
            <div className="cf-sidebar__role">{user?.role || "Owner"}</div>
            {!effectiveSidebarCollapsed ? <div className="cf-sidebar__username">{displayName}</div> : null}
            {!effectiveSidebarCollapsed ? <div className="cf-sidebar__email">{displayEmail}</div> : null}
            <button
              className="cf-btn cf-btn--secondary cf-btn--full cf-btn--small"
              onClick={handleLogout}
              title={effectiveSidebarCollapsed ? "Sign out" : undefined}
              type="button"
            >
              <SignOut size={14} weight="bold" />
              {!effectiveSidebarCollapsed ? <span>Sign Out</span> : null}
            </button>
          </div>
        </aside>

        <main className={`cf-main ${billingMode ? "cf-main--billing" : ""}`}>{children}</main>
      </div>
    </div>
  );
};

