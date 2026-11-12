import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { LogOut, Menu, ShieldCheck, UserRound, X } from "lucide-react";
import { initials } from "../utils/format.js";
import { useAuth } from "../hooks/useAuth.js";

export function AppLayout({ items, roleLabel, productLabel = "Coaching Institute", profilePath }) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  async function handleSignOut() {
    setSigningOut(true);
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>

      {open ? (
        <button
          type="button"
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      ) : null}

      <aside className="sidebar" data-open={open} id="primary-navigation">
        <Link to={items[0]?.to ?? "/"} className="brand">
          <span className="brand__mark" aria-hidden="true">
            CI
          </span>
          <span>
            <span className="brand__name">{productLabel}</span>
            <span className="brand__sub">{roleLabel}</span>
          </span>
        </Link>

        <nav className="nav" aria-label="Primary">
          <p className="nav__group-label">Workspace</p>
          <ul>
            {items.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} end={item.end} className={({ isActive }) => `nav__link${isActive ? " is-active" : ""}`}>
                  <item.icon size={17} strokeWidth={2} aria-hidden="true" />
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="sidebar__footer">
          <div className="user-chip">
            <span className="avatar" aria-hidden="true">
              {initials(user?.fullName)}
            </span>
            <span className="grow">
              <span className="user-chip__name">{user?.fullName}</span>
              <span className="user-chip__meta">{user?.email}</span>
            </span>
          </div>
          <div className="sidebar__actions">
            <Link className="sidebar__link" to={profilePath}>
              <UserRound size={16} aria-hidden="true" />
              My profile
            </Link>
            <button type="button" className="sidebar__link" onClick={handleSignOut} disabled={signingOut}>
              <LogOut size={16} aria-hidden="true" />
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button
            type="button"
            className="icon-btn menu-toggle"
            aria-expanded={open}
            aria-controls="primary-navigation"
            aria-label={open ? "Close navigation" : "Open navigation"}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
          <span className="topbar__title">
            <ShieldCheck size={14} aria-hidden="true" style={{ display: "inline", verticalAlign: "-2px", marginRight: 5 }} />
            {roleLabel} · {user?.roles?.length ? "Verified session" : "Signed in"}
          </span>
          <div className="topbar__right">
            <span className="badge badge--brand">{roleLabel}</span>
          </div>
        </header>
        <main className="content" id="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
