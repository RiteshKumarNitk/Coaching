import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";
import { useAuth } from "../hooks/useAuth.js";
import { initials } from "../utils/format.js";

export function GuardianLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  async function handleSignOut() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="student-shell">
      <a className="skip-link" href="#guardian-main">
        Skip to content
      </a>

      <header className="student-header">
        <Link to="/guardian" className="brand brand--ink">
          <span
            className="brand__mark"
            aria-hidden="true"
            style={{ width: 34, height: 34, borderRadius: 11, fontSize: "0.86rem" }}
          >
            CI
          </span>
          <span>
            <span className="brand__name" style={{ fontSize: "0.9rem" }}>
              Coaching Institute
            </span>
            <span className="brand__sub">Guardian portal</span>
          </span>
        </Link>

        {user ? (
          <div className="row" style={{ gap: 8 }}>
            <span
              className="avatar avatar--brand"
              aria-hidden="true"
              style={{ width: 32, height: 32, fontSize: "0.72rem" }}
            >
              {initials(user.fullName)}
            </span>
            <button
              type="button"
              className="icon-btn"
              onClick={handleSignOut}
              aria-label="Sign out"
              title="Sign out"
              style={{ width: 34, height: 34 }}
            >
              <LogOut size={15} />
            </button>
          </div>
        ) : null}
      </header>

      <main className="student-content" id="guardian-main" key={location.pathname}>
        <Outlet />
      </main>
    </div>
  );
}
