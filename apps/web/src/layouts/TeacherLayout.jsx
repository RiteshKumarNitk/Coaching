import { LayoutDashboard, UserRound } from "lucide-react";
import { AppLayout } from "./AppLayout.jsx";

const items = [
  { to: "/teacher", label: "Teaching desk", icon: LayoutDashboard, end: true },
  { to: "/teacher/profile", label: "My profile", icon: UserRound }
];

export function TeacherLayout() {
  return <AppLayout items={items} roleLabel="Teaching desk" profilePath="/teacher/profile" />;
}
