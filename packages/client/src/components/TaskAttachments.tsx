import { useEffect, useState } from 'react';
import type { TaskAttachment } from '@/types';
import { api } from '@/lib/api';
import ImageUpload from './ImageUpload';

// The dialog keys this owner by task and session. In-flight mutations from an
// exiting dialog retain only its setter, never the next session's image list.
export default function TaskAttachments({ taskId }: { taskId: string }) {
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.getAttachments(taskId)
      .then((result) => {
        if (!cancelled) setAttachments(result);
      })
      .catch(() => {
        if (!cancelled) setAttachments([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  // Do not race a new upload against the initial snapshot. A failed load also
  // leaves this state, preserving the ability to upload or reopen to retry.
  if (loading) return <p role="status" className="text-xs text-muted-foreground">Loading images…</p>;

  return <ImageUpload taskId={taskId} existing={attachments} onAttachmentsChange={setAttachments} />;
}
