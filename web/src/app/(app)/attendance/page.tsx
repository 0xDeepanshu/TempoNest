import type { Metadata } from "next";
import { AttendancePageView } from "@/components/attendance-view";

export const metadata: Metadata = { title: "Attendance" };

export default function AttendancePage() {
  return <AttendancePageView />;
}
