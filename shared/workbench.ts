/** Stable, versioned seam for separately implemented integrations. No runtime code loader. */
export interface IntegrationAdapter<T> {
  readonly id: string;
  readonly apiVersion: 1;
  read(projectId?: string, signal?: AbortSignal): Promise<T>;
}
export const integrationSlots = [
  { id: 'balance', name: '余额与额度', status: 'planned' },
  { id: 'reset-signals', name: '刷新信号', status: 'available' },
] as const;
export interface WorkbenchSettings { theme: 'sage' | 'warm' | 'indigo'; quotaVisibility?: 'auto' | 'shown' | 'hidden'; resetForecast?: boolean; toolsDirectory?: string; }
export interface ShortcutStatus { enabled: boolean; conflict: boolean; desktopExists: boolean; startupPath: string; desktopPath: string; }
export interface ServiceStatus {
  supported: boolean; apiRunning: boolean; uiRunning: boolean; url: string;
  launcherPath: string; dataPath: string; shortcuts?: ShortcutStatus; error?: string;
}
export interface ProjectMeta { category: string; pinned: boolean; archivedAt?: number; }
export interface ProjectSummary {
  id: string; name: string; repoPath?: string; isDefault: boolean;
  total: number; integrated: number; attention: number; running: number;
  complete: boolean; lastActivity: number; meta: ProjectMeta;
}
export interface ProjectTaskPreview { id: string; title: string; phase: string; integrated: boolean; }
export function filterProjects(projects: ProjectSummary[], filter: string, query: string, category: string): ProjectSummary[] {
  const candidates = projects.filter(p => (filter === 'archived' ? !!p.meta.archivedAt : !p.meta.archivedAt)
    && (filter !== 'completed' || p.complete) && (filter !== 'active' && filter !== 'recent' || !p.complete)
    && (filter !== 'attention' || p.attention > 0) && (!category || p.meta.category === category)
    && `${p.name} ${p.repoPath || ''} ${p.meta.category}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  candidates.sort((a, b) => b.lastActivity - a.lastActivity || a.name.localeCompare(b.name, 'zh', { numeric: true }) || a.id.localeCompare(b.id));
  const result = filter === 'recent' ? candidates.slice(0, 10) : candidates;
  return result.sort((a, b) => Number(b.meta.pinned) - Number(a.meta.pinned) || b.lastActivity - a.lastActivity || a.id.localeCompare(b.id));
}
