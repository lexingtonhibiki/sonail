import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { AiCredentialInfo, AiPermission } from '@ai-agent-board/shared/workflow.js';

interface Credential extends AiCredentialInfo { digest?: string; fingerprint: string; }
const digest = (token: string) => createHash('sha256').update(token).digest('hex');

/** Credentials authorize this HTTP integration, not arbitrary local harness commands. */
export class AiAccessStore {
  private items: Credential[];
  constructor(private file: string) {
    this.items = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  }
  private save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.items), { mode: 0o600 });
    fs.renameSync(temporary, this.file);
  }
  list(projectId: string): AiCredentialInfo[] {
    return this.items.filter(item => item.projectId === projectId).map(({ digest: _digest, fingerprint: _fingerprint, ...info }) => info);
  }
  create(projectId: string, fingerprint: string, name: string, permission: AiPermission) {
    if (typeof name !== 'string' || !name.trim() || name.length > 100 || !['read', 'preview'].includes(permission)) throw new Error('填写凭据名称和权限 / Name and permission required');
    const token = `sonail_${randomBytes(32).toString('base64url')}`;
    const info: Credential = { id: randomUUID(), projectId, fingerprint, name: name.trim(), permission, createdAt: Date.now(), expiresAt: Date.now() + 30 * 86400_000, digest: digest(token) };
    this.items.push(info); this.save();
    const { digest: _digest, fingerprint: _fingerprint, ...credential } = info;
    return { token, credential };
  }
  authenticate(token?: string): Credential | undefined {
    if (!token?.startsWith('sonail_')) return;
    const hash = Buffer.from(digest(token), 'hex');
    return this.items.find(item => !item.revokedAt && item.expiresAt > Date.now() && item.digest && timingSafeEqual(hash, Buffer.from(item.digest, 'hex')));
  }
  revoke(projectId: string, id: string): void {
    const item = this.items.find(item => item.projectId === projectId && item.id === id);
    if (!item) throw new Error('凭据不属于此项目 / Credential belongs to another project');
    item.revokedAt = Date.now(); delete item.digest; this.save();
  }
}
