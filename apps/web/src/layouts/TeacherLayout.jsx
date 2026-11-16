import {
  ClipboardCheck,
  ClipboardList,
  FileText,
  LayoutDashboard,
  Layers,
  ListChecks,
  Megaphone,
  UserRound,
  Video
} from "lucide-react";
import { AppLayout } from "./AppLayout.jsx";

const items = [
  { to: "/teacher", label: "Teaching desk", icon: LayoutDashboard, end: true },
  { to: "/teacher/batches", label: "My batches", icon: Layers },
  { to: "/teacher/attendance", label: "Attendance", icon: ClipboardCheck },
  { to: "/teacher/lectures", label: "Lectures", icon: Video },
  { to: "/teacher/materials", label: "Study material", icon: FileText },
  { to: "/teacher/assignments", label: "Assignments", icon: ClipboardList },
  { to: "/teacher/exams", label: "Exams", icon: ListChecks },
  { to: "/teacher/notices", label: "Notices", icon: Megaphone },
  { to: "/teacher/profile", label: "My profile", icon: UserRound }
];

export function TeacherLayout() {
  return <AppLayout items={items} roleLabel="Teaching desk" profilePath="/teacher/profile" />;
}
