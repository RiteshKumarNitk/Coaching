import { useQuery } from "@tanstack/react-query";
import { teacherService } from "../services/teacher.service.js";

/** Batches assigned to the signed-in teacher (admins see every batch). */
export function useTeacherBatches() {
  return useQuery({
    queryKey: ["teacher", "batches"],
    queryFn: teacherService.batches,
    select: (data) => data.items
  });
}

export function useTeacherBatch(batchId) {
  return useQuery({
    queryKey: ["teacher", "batch", batchId],
    queryFn: () => teacherService.batch(batchId),
    enabled: Boolean(batchId)
  });
}
