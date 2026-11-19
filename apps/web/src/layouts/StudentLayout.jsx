import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { BookOpen, CalendarCheck, ClipboardList, Home, LogOut, UserRound, Wallet, WifiOff } from "lucide-react";
import { useAuth } from "../hooks/useAuth.js";
import { useOnlineStatus } from "../hooks/useOnlineStatus.js";
import { initials } from "../utils/format.js";

export function StudentLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const online = useOnlineStatus();

  async function handleSignOut() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="student-shell">
      <a className="skip-link" href="#student-main">
        Skip to content
      </a>

      <header className="student-header">
        <Link to="/student" className="brand brand--ink">
          <span className="brand__mark" aria-hidden="true" style={{ width: 34, height: 34, borderRadius: 11, fontSize: "0.86rem" }}>
            CI
          </span>
          <span>
            <span className="brand__name" style={{ fontSize: "0.9rem" }}>
              Coaching Institute
            </span>
            <span className="brand__sub">Student app</span>
          </span>
        </Link>

        {user ? (
          <div className="row" style={{ gap: 8 }}>
            <span className="avatar avatar--brand" aria-hidden="true" style={{ width: 32, height: 32, fontSize: "0.72rem" }}>
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

      {!online ? (
        <div className="offline-banner" role="status">
          <WifiOff size={15} aria-hidden="true" />
          <span>You are offline. Cached pages remain readable; lessons, tests and fees need a connection.</span>
        </div>
      ) : null}

      <main className="student-content" id="student-main" key={location.pathname}>
        <Outlet />
      </main>

      <nav className="bottom-nav" aria-label="Student navigation">
        <NavLink to="/student" end className={({ isActive }) => `bottom-nav__link${isActive ? " is-active" : ""}`}>
          <Home size={19} aria-hidden="true" />
          Home
        </NavLink>
        <NavLink to="/student/courses" className={({ isActive }) => `bottom-nav__link${isActive ? " is-active" : ""}`}>
          <BookOpen size={19} aria-hidden="true" />
          Learn
        </NavLink>
        <NavLink to="/student/exams" className={({ isActive }) => `bottom-nav__link${isActive ? " is-active" : ""}`}>
          <ClipboardList size={19} aria-hidden="true" />
          Tests
        </NavLink>
        <NavLink to="/student/attendance" className={({ isActive }) => `bottom-nav__link${isActive ? " is-active" : ""}`}>
          <CalendarCheck size={19} aria-hidden="true" />
          Attendance
        </NavLink>
        <NavLink to="/student/fees" className={({ isActive }) => `bottom-nav__link${isActive ? " is-active" : ""}`}>
          <Wallet size={19} aria-hidden="true" />
          Fees
        </NavLink>
        <NavLink to="/student/profile" className={({ isActive }) => `bottom-nav__link${isActive ? " is-active" : ""}`}>
          <UserRound size={19} aria-hidden="true" />
          Profile
        </NavLink>
      </nav>
    </div>
  );
}
