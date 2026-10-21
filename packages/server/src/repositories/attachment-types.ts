import type { TaskAttachment } from '../types.js';

export interface AttachmentStore {
  /** Insert the whole upload batch in one database transaction. */
  insertMany(attachments: TaskAttachment[]): Promise<void>;
  insert(attachment: TaskAttachment): Promise<void>;
  getByTaskId(taskId: string): Promise<TaskAttachment[]>;
  getById(id: string): Promise<TaskAttachment | undefined>;
  deleteById(id: string): Promise<boolean>;
  countByTaskId(taskId: string): Promise<number>;
}
