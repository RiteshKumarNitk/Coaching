import { LayoutDashboard, UserRound } from "lucide-react";
import { AppLayout } from "./AppLayout.jsx";

const items = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/admin/profile", label: "My profile", icon: UserRound }
];

export function AdminLayout() {
  return <AppLayout items={items} roleLabel="Administration" profilePath="/admin/profile" />;
}
