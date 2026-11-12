import { BookOpen, GraduationCap, Layers, LayoutDashboard, Library, UserRound, Users } from "lucide-react";
import { AppLayout } from "./AppLayout.jsx";

const items = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/admin/students", label: "Students", icon: Users },
  { to: "/admin/teachers", label: "Teachers", icon: GraduationCap },
  { to: "/admin/courses", label: "Courses", icon: BookOpen },
  { to: "/admin/subjects", label: "Subjects", icon: Library },
  { to: "/admin/batches", label: "Batches", icon: Layers },
  { to: "/admin/profile", label: "My profile", icon: UserRound }
];

export function AdminLayout() {
  return <AppLayout items={items} roleLabel="Administration" profilePath="/admin/profile" />;
}
