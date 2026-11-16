import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck } from "lucide-react";
import { notificationService } from "../services/notifications.service.js";
import { formatDateTime } from "../utils/format.js";

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const queryClient = useQueryClient();

  const countQuery = useQuery({
    queryKey: ["notifications", "unread"],
    queryFn: notificationService.unreadCount,
    refetchInterval: 60_000
  });

  const listQuery = useQuery({
    queryKey: ["notifications", "list"],
    queryFn: () => notificationService.list({ pageSize: 8 }),
    enabled: open
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["notifications"] });

  const readMutation = useMutation({
    mutationFn: (id) => notificationService.markRead(id),
    onSuccess: invalidate
  });

  const readAllMutation = useMutation({
    mutationFn: () => notificationService.markAllRead(),
    onSuccess: invalidate
  });

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const unread = countQuery.data?.count ?? 0;
  const items = listQuery.data?.items ?? [];

  return (
    <div className="notif" ref={wrapRef}>
      <button
        type="button"
        className="icon-btn notif__trigger"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Bell size={18} aria-hidden="true" />
        {unread > 0 ? <span className="notif__count">{unread > 9 ? "9+" : unread}</span> : null}
      </button>

      {open ? (
        <div className="notif__panel" role="dialog" aria-label="Notifications">
          <div className="notif__head">
            <span>Notifications</span>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => readAllMutation.mutate()}
              disabled={readAllMutation.isPending || unread === 0}
            >
              <CheckCheck size={14} aria-hidden="true" /> Mark all read
            </button>
          </div>

          {listQuery.isPending ? <p className="notif__empty">Loading…</p> : null}
          {!listQuery.isPending && items.length === 0 ? (
            <p className="notif__empty">Nothing yet. Notices, results and fee updates land here.</p>
          ) : null}

          <ul className="notif__list">
            {items.map((item) => (
              <li key={item.id} className={`notif__item${item.readAt ? "" : " is-unread"}`}>
                <button
                  type="button"
                  className="notif__link"
                  onClick={() => {
                    if (!item.readAt) readMutation.mutate(item.id);
                  }}
                >
                  <span className="notif__title">{item.title}</span>
                  {item.body ? <span className="notif__body">{item.body}</span> : null}
                  <span className="notif__meta">{formatDateTime(item.createdAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
