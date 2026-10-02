import { useEffect, useRef, useState } from 'react';
import { Archive, ArrowUpRight, ChevronDown, ChevronRight, FolderOpen, Pin, Plus, Search } from 'lucide-react';
import { filterProjects, type ProjectSummary, type ProjectTaskPreview } from '../../../../shared/workbench';
type Translate = (zh: string, en: string) => string;
interface Props {
  t: Translate; pending: boolean; refreshKey: number;
  request: <T>(url: string, method?: string, body?: unknown) => Promise<T>;
  onOpen: (id: string, taskId?: string) => void;
  onCreate: () => void; onNotice: (message: string) => void;
  phase: (value: string) => string;
}
export default function ProjectHub({ t, request, pending, refreshKey, onOpen, onCreate, onNotice, phase }: Props) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [filter, setFilter] = useState('recent'); const [query, setQuery] = useState(''); const [category, setCategory] = useState('');
  const [expanded, setExpanded] = useState<string[]>([]); const [previews, setPreviews] = useState<Record<string, ProjectTaskPreview[]>>({});
  const expandedRef = useRef(expanded); expandedRef.current = expanded;
  const [busy, setBusy] = useState(''); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [categories, setCategories] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    const load = async () => { try { const data = await request<ProjectSummary[]>('/projects'); if (!cancelled) { setProjects(data); setError(''); } await Promise.all(expandedRef.current.map(async id => { const tasks = await request<ProjectTaskPreview[]>('/projects/' + id + '/tasks'); if (!cancelled) setPreviews(values => ({ ...values, [id]: tasks })); })); } catch (e) { if (!cancelled) setError((e as Error).message); } finally { if (!cancelled) setLoading(false); } };
    void load(); const timer = setInterval(load, 15000); return () => { cancelled = true; clearInterval(timer); };
  }, [refreshKey]);
  const mutate = async (id: string, patch: unknown, message: string) => {
    setBusy(id); try { await request('/projects/' + id, 'PUT', patch); setProjects(await request<ProjectSummary[]>('/projects')); onNotice(message); } catch (e) { onNotice((e as Error).message); } finally { setBusy(''); }
  };
  const expand = async (id: string) => {
    if (expanded.includes(id)) { setExpanded(expanded.filter(value => value !== id)); return; }
    setExpanded([...expanded, id]);
    try { const tasks = await request<ProjectTaskPreview[]>('/projects/' + id + '/tasks'); setPreviews(values => ({ ...values, [id]: tasks })); }
    catch (e) { onNotice((e as Error).message); setExpanded(values => values.filter(value => value !== id)); }
  };
  const visible = filterProjects(projects, filter, query, category);
  const categoryNames = [...new Set(projects.map(p => p.meta.category).filter(Boolean))].sort();
  return <section className="sb-project-hub"><div className="sb-hub-heading"><div><h2>{t('项目总览', 'Project overview')}</h2><p>{t('先看全局，展开看任务，进入项目看细节。归档保留全部记录和代码。', 'Overview first, expand for tasks, enter for detail. Archives preserve records and code.')}</p></div><button className="sb-button sb-primary" onClick={onCreate}><Plus size={16} />{t('新建项目', 'New project')}</button></div>
    <div className="sb-hub-metrics"><span>{t('活跃', 'Active')} <strong>{projects.filter(p => !p.meta.archivedAt && !p.complete).length}</strong></span><span>{t('已完成', 'Completed')} <strong>{projects.filter(p => !p.meta.archivedAt && p.complete).length}</strong></span><span>{t('已归档', 'Archived')} <strong>{projects.filter(p => p.meta.archivedAt).length}</strong></span><span>{t('待你处理', 'Needs attention')} <strong>{projects.filter(p => !p.meta.archivedAt).reduce((sum, p) => sum + p.attention, 0)}</strong></span></div>
    <div className="sb-hub-controls"><label className="sb-hub-search"><Search size={16} /><input aria-label={t('搜索项目', 'Search projects')} placeholder={t('搜索名称、路径或分类…', 'Search name, path or category…')} value={query} onChange={e => setQuery(e.target.value)} /></label><select aria-label={t('项目分类筛选', 'Filter by category')} value={category} onChange={e => setCategory(e.target.value)}><option value="">{t('所有分类', 'All categories')}</option>{categoryNames.map(name => <option key={name}>{name}</option>)}</select></div>
    <div className="sb-hub-filters" role="group" aria-label={t('项目状态筛选', 'Project filters')}>{[['recent', '最近活跃 · 前 10', 'Recent · top 10'], ['active', '全部活跃', 'All active'], ['attention', '待我处理', 'Needs attention'], ['completed', '已完成', 'Completed'], ['archived', '已归档', 'Archived'], ['all', '全部未归档', 'All unarchived']].map(([id, zh, en]) => <button key={id} aria-pressed={filter === id} className={filter === id ? 'sb-button sb-primary' : 'sb-button'} onClick={() => setFilter(id)}>{t(zh, en)}</button>)}</div>
    {error && <p role="alert" className="sb-recovery">{error}</p>}{loading && <p role="status">{t('正在加载项目…', 'Loading projects…')}</p>}
    {!loading && !visible.length && <div className="sb-hub-empty"><FolderOpen size={30} /><h3>{t('这里还没有项目', 'No projects here')}</h3><p>{t('试试其他筛选，或新建一个项目。', 'Try another filter or create a project.')}</p></div>}
    <div className="sb-project-grid">{visible.map(project => <article className="sb-project-card" key={project.id}>
      <header><span className="sb-project-mark"><FolderOpen size={22} /></span><div><span className="sb-eyebrow">{project.meta.category || t('未分类', 'Uncategorized')}{project.meta.archivedAt ? ' · ' + t('已归档', 'Archived') : ''}</span><button className="sb-project-title" onClick={() => onOpen(project.id)}>{project.name}</button></div><button disabled={!!busy || pending} className={`sb-icon ${project.meta.pinned ? 'sb-pinned' : ''}`} title={t('置顶 / 取消置顶', 'Pin / unpin')} aria-label={t('置顶项目 ', 'Pin project ') + project.name} aria-pressed={project.meta.pinned} onClick={() => void mutate(project.id, { pinned: !project.meta.pinned }, t('项目置顶已更新', 'Pin updated'))}><Pin size={17} /></button></header>
      <p className="sb-project-path" title={project.repoPath}>{project.repoPath || t('未指定路径', 'No path')}</p><div className="sb-project-stats"><strong>{project.integrated}<small> / {project.total} {t('已合入', 'integrated')}</small></strong>{project.attention > 0 && <span className="sb-warning">{project.attention} {t('待处理', 'need attention')}</span>}{project.running > 0 && <span>{project.running} {t('运行中', 'running')}</span>}</div><div className="sb-progress"><i style={{ width: `${project.integrated / Math.max(1, project.total) * 100}%` }} /></div>
      <footer><button className="sb-button sb-small" onClick={() => void expand(project.id)} aria-expanded={expanded.includes(project.id)}>{expanded.includes(project.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{t('展开任务', 'Expand tasks')} · {project.total}</button><button className="sb-button sb-small" onClick={() => onOpen(project.id)}>{t('进入项目', 'Open project')}<ArrowUpRight size={14} /></button></footer>
      {expanded.includes(project.id) && <div className="sb-project-expansion">{!previews[project.id] ? <p>{t('正在读取任务…', 'Loading tasks…')}</p> : !previews[project.id].length ? <p>{t('尚无任务，可以让经理起草方案。', 'No tasks yet. Ask the manager to draft a plan.')}</p> : previews[project.id].map(task => <button className="sb-project-task" key={task.id} onClick={() => onOpen(project.id, task.id)}><span>{task.title}</span><small>{phase(task.phase)}</small><ChevronRight size={14} /></button>)}<label>{t('项目分类', 'Project category')}<input aria-label={t('分类 ', 'Category ') + project.name} maxLength={60} placeholder={t('例如：个人、工作、试验', 'Personal, work, experiments')} value={categories[project.id] ?? project.meta.category} onChange={e => setCategories({ ...categories, [project.id]: e.target.value })} /></label><div className="sb-actions"><button className="sb-button sb-small" disabled={!!busy || pending} onClick={() => void mutate(project.id, { category: categories[project.id] ?? project.meta.category }, t('项目分类已保存', 'Category saved'))}>{t('保存分类', 'Save category')}</button><button className="sb-button sb-small" disabled={!!busy || pending || (!project.meta.archivedAt && !project.complete)} title={!project.meta.archivedAt && !project.complete ? t('所有任务验收并合入后可以归档', 'Accept and integrate every task before archive') : ''} onClick={() => void mutate(project.id, { archived: !project.meta.archivedAt }, project.meta.archivedAt ? t('项目已恢复，保持暂停。可进入设置恢复推进。', 'Project restored and paused. Resume in project settings.') : t('项目已归档，记录与代码保留', 'Archived; records and code preserved'))}><Archive size={14} />{project.meta.archivedAt ? t('恢复项目', 'Restore') : t('归档项目', 'Archive')}</button></div></div>}
      <small className="sb-project-time">{t('最近活动 ', 'Last activity ')}{new Date(project.lastActivity).toLocaleString()}</small>
    </article>)}</div></section>;
}
