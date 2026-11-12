import { useEffect } from "react";

export function useDocumentTitle(title) {
  useEffect(() => {
    if (title) document.title = `${title} · Coaching Institute`;
    return () => {
      document.title = "Coaching Institute";
    };
  }, [title]);
}
