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
import { StudentsPage } from "../pages/admin/StudentsPage.jsx";
import { StudentDetailPage } from "../pages/admin/StudentDetailPage.jsx";
import { TeachersPage } from "../pages/admin/TeachersPage.jsx";
import { CoursesPage } from "../pages/admin/CoursesPage.jsx";
import { SubjectsPage } from "../pages/admin/SubjectsPage.jsx";
import { BatchesPage } from "../pages/admin/BatchesPage.jsx";
import { BatchDetailPage } from "../pages/admin/BatchDetailPage.jsx";
import { TeacherDashboard } from "../pages/teacher/TeacherDashboard.jsx";
import { TeacherBatchesPage } from "../pages/teacher/TeacherBatchesPage.jsx";
import { TeacherBatchPage } from "../pages/teacher/TeacherBatchPage.jsx";
import { TeacherAttendancePage } from "../pages/teacher/TeacherAttendancePage.jsx";
import { TeacherLessonsPage } from "../pages/teacher/TeacherLessonsPage.jsx";
import { TeacherMaterialsPage } from "../pages/teacher/TeacherMaterialsPage.jsx";
import { TeacherAssignmentsPage } from "../pages/teacher/TeacherAssignmentsPage.jsx";
import { StudentDashboard } from "../pages/student/StudentDashboard.jsx";
import { StudentCoursesPage } from "../pages/student/StudentCoursesPage.jsx";
import { StudentLecturesPage } from "../pages/student/StudentLecturesPage.jsx";
import { StudentLessonPage } from "../pages/student/StudentLessonPage.jsx";
import { StudentMaterialsPage } from "../pages/student/StudentMaterialsPage.jsx";
import { StudentAssignmentsPage } from "../pages/student/StudentAssignmentsPage.jsx";
import { StudentAttendancePage } from "../pages/student/StudentAttendancePage.jsx";
import { StudentAnnouncementsPage } from "../pages/student/StudentAnnouncementsPage.jsx";
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
          <Route path="students" element={<StudentsPage />} />
          <Route path="students/:id" element={<StudentDetailPage />} />
          <Route path="teachers" element={<TeachersPage />} />
          <Route path="courses" element={<CoursesPage />} />
          <Route path="subjects" element={<SubjectsPage />} />
          <Route path="batches" element={<BatchesPage />} />
          <Route path="batches/:id" element={<BatchDetailPage />} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute roles={[ROLES.TEACHER]} />}>
        <Route path="/teacher" element={<TeacherLayout />}>
          <Route index element={<TeacherDashboard />} />
          <Route path="batches" element={<TeacherBatchesPage />} />
          <Route path="batches/:id" element={<TeacherBatchPage />} />
          <Route path="attendance" element={<TeacherAttendancePage />} />
          <Route path="lectures" element={<TeacherLessonsPage />} />
          <Route path="materials" element={<TeacherMaterialsPage />} />
          <Route path="assignments" element={<TeacherAssignmentsPage />} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute roles={[ROLES.STUDENT]} />}>
        <Route path="/student" element={<StudentLayout />}>
          <Route index element={<StudentDashboard />} />
          <Route path="courses" element={<StudentCoursesPage />} />
          <Route path="lectures" element={<StudentLecturesPage />} />
          <Route path="lectures/:id" element={<StudentLessonPage />} />
          <Route path="materials" element={<StudentMaterialsPage />} />
          <Route path="assignments" element={<StudentAssignmentsPage />} />
          <Route path="attendance" element={<StudentAttendancePage />} />
          <Route path="announcements" element={<StudentAnnouncementsPage />} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>
      </Route>

      <Route path="/" element={<HomeRedirect />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
