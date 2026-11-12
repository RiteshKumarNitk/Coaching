import { Navigate, Outlet, useLocation } from "react-router-dom";
import { homeRouteForRoles } from "@coaching/shared";
import { useAuth } from "../hooks/useAuth.js";
import { FullPageLoader } from "./Skeleton.jsx";

export function ProtectedRoute({ roles }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) return <FullPageLoader label="Checking your session" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  if (roles && roles.length > 0 && !roles.some((role) => user.roles.includes(role))) {
    // Never render another role's area; send the user to their own home.
    return <Navigate to={homeRouteForRoles(user.roles)} replace />;
  }

  return <Outlet />;
}

export function PublicOnlyRoute() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <FullPageLoader label="Loading portal" />;
  if (user) return <Navigate to={homeRouteForRoles(user.roles)} replace />;
  return <Outlet />;
}
