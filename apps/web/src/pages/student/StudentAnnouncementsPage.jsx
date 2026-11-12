import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Megaphone } from "lucide-react";
import { studentService } from "../../services/student.service.js";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.js";
import { PageHeader } from "../../components/PageHeader.jsx";
import { SectionCard } from "../../components/SectionCard.jsx";
import { Badge } from "../../components/Badge.jsx";
import { EmptyState } from "../../components/EmptyState.jsx";
import { ErrorState } from "../../components/ErrorState.jsx";
import { Pagination } from "../../components/Pagination.jsx";
import { formatDateTime } from "../../utils/format.js";

export function StudentAnnouncementsPage() {
  useDocumentTitle("Notices");
  const [page, setPage] = useState(1);
  const noticesQuery = useQuery({
    queryKey: ["student", "announcements", page],
    queryFn: () => studentService.announcements({ page, pageSize: 20 })
  });

  return (
    <>
      <PageHeader title="Notices" description="Announcements for everyone, your batch and your course." />

      {noticesQuery.isError ? <ErrorState error={noticesQuery.error} onRetry={noticesQuery.refetch} /> : null}

      {noticesQuery.data && noticesQuery.data.items.length === 0 ? (
        <SectionCard>
          <EmptyState icon={Megaphone} title="No notices" description="Institute announcements will appear here." />
        </SectionCard>
      ) : null}

      {noticesQuery.data?.items.map((notice) => (
        <article className="card" key={notice.id}>
          <div className="card__body stack" style={{ gap: 8 }}>
            <div className="row row--between">
              <p className="cell-primary">{notice.title}</p>
              {notice.isPinned ? <Badge tone="accent">Pinned</Badge> : null}
            </div>
            <p className="small">{notice.body}</p>
            <p className="small muted">
              {formatDateTime(notice.publishedAt)}
              {notice.authorName ? ` · ${notice.authorName}` : ""}
            </p>
          </div>
        </article>
      ))}

      {noticesQuery.data ? (
        <Pagination page={page} pageSize={20} total={noticesQuery.data.total} onChange={setPage} />
      ) : null}
    </>
  );
}
