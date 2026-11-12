import { Link } from "react-router-dom";
import { Compass } from "lucide-react";
import { homeRouteForRoles } from "@coaching/shared";
import { useAuth } from "../hooks/useAuth.js";
import { useDocumentTitle } from "../hooks/useDocumentTitle.js";

export function NotFoundPage() {
  useDocumentTitle("Page not found");
  const { user } = useAuth();
  const home = user ? homeRouteForRoles(user.roles) : "/login";

  return (
    <div className="full-loader" style={{ minHeight: "70dvh" }}>
      <span className="empty__icon" aria-hidden="true">
        <Compass size={22} />
      </span>
      <h1>Page not found</h1>
      <p className="muted small">The page you are looking for does not exist or has moved.</p>
      <Link className="btn btn--primary btn--sm" to={home} style={{ marginTop: 8 }}>
        Go to my dashboard
      </Link>
    </div>
  );
}
