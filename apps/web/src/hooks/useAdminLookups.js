import { useQuery } from "@tanstack/react-query";
import { adminService } from "../services/admin.service.js";

export function useBatches() {
  return useQuery({
    queryKey: ["admin", "batches", "lookup"],
    queryFn: () => adminService.batches({ pageSize: 100 }),
    select: (data) => data.items
  });
}

export function useSubjects() {
  return useQuery({
    queryKey: ["admin", "subjects", "lookup"],
    queryFn: () => adminService.subjects({ pageSize: 100 }),
    select: (data) => data.items
  });
}

export function useCourses() {
  return useQuery({
    queryKey: ["admin", "courses", "lookup"],
    queryFn: () => adminService.courses({ pageSize: 100 }),
    select: (data) => data.items
  });
}

export function useTeachersLookup() {
  return useQuery({
    queryKey: ["admin", "teachers", "lookup"],
    queryFn: () => adminService.teachers({ pageSize: 100 }),
    select: (data) => data.items
  });
}
