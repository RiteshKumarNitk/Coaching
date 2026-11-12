import { Navigate, Route, Routes } from "react-router-dom";
import { ADMIN_ROLES, ROLES, homeRouteForRoles } from "@coaching/shared";
import { useAuth } from "../hooks/useAuth.js";
import { ProtectedRoute, PublicOnlyRoute } from "../components/ProtectedRoute.jsx";
import { FullPageLoader } from "../components/Skeleton.jsx";
import { AdminLayout } from "../layouts/AdminLayout.jsx";
import { TeacherLayout } from "../layouts/TeacherLayout.jsx";
import { StudentLayout } from "../layouts/StudentLayout.jsx";
import { LoginPage } from "../pages/auth/LoginPage.jsx";
import { AdminDashboard } from "../pages/admin/AdminDashboard.jsx";
import { TeacherDashboard } from "../pages/teacher/TeacherDashboard.jsx";
import { StudentDashboard } from "../pages/student/StudentDashboard.jsx";
import { ProfilePage } from "../pages/ProfilePage.jsx";
import { NotFoundPage } from "../pages/NotFoundPage.jsx";

function HomeRedirect() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <FullPageLoader label="Loading portal" />;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={homeRouteForRoles(user.roles)} replace />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<PublicOnlyRoute />}>
        <Route path="/login" element={<LoginPage />} />
      </Route>

      <Route element={<ProtectedRoute roles={ADMIN_ROLES} />}>
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<AdminDashboard />} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute roles={[ROLES.TEACHER]} />}>
        <Route path="/teacher" element={<TeacherLayout />}>
          <Route index element={<TeacherDashboard />} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute roles={[ROLES.STUDENT]} />}>
        <Route path="/student" element={<StudentLayout />}>
          <Route index element={<StudentDashboard />} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>
      </Route>

      <Route path="/" element={<HomeRedirect />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
