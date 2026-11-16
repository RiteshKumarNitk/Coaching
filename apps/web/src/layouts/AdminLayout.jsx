import {
  BarChart3,
  BookOpen,
  ClipboardList,
  GraduationCap,
  Layers,
  LayoutDashboard,
  Library,
  Megaphone,
  ScrollText,
  Settings,
  ShieldCheck,
  UserRound,
  Users,
  Wallet
} from "lucide-react";
import { useAuth } from "../hooks/useAuth.js";
import { AppLayout } from "./AppLayout.jsx";

const items = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/admin/students", label: "Students", icon: Users },
  { to: "/admin/teachers", label: "Teachers", icon: GraduationCap },
  { to: "/admin/courses", label: "Courses", icon: BookOpen },
  { to: "/admin/subjects", label: "Subjects", icon: Library },
  { to: "/admin/batches", label: "Batches", icon: Layers },
  { to: "/admin/exams", label: "Exams", icon: ClipboardList },
  { to: "/admin/fees", label: "Fees", icon: Wallet },
  { to: "/admin/notices", label: "Notices", icon: Megaphone },
  { to: "/admin/reports", label: "Reports", icon: BarChart3, permission: "fees:read" },
  { to: "/admin/team", label: "Staff accounts", icon: ShieldCheck, permission: "admins:manage" },
  { to: "/admin/audit", label: "Audit log", icon: ScrollText, permission: "audit:read" },
  { to: "/admin/settings", label: "Settings", icon: Settings, permission: "settings:manage" },
  { to: "/admin/profile", label: "My profile", icon: UserRound }
];

export function AdminLayout() {
  const { user } = useAuth();
  const visible = items.filter(
    (item) => !item.permission || (user?.permissions ?? []).includes(item.permission)
  );
  return <AppLayout items={visible} roleLabel="Administration" profilePath="/admin/profile" />;
}
