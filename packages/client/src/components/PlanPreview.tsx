import type { Proposal } from '../../../../shared/workflow.js';

interface Props {
  proposal: Proposal; source?: string; projectName?: string; repoPath?: string; pending: boolean;
  t: (zh: string, en: string) => string;
  onConfirm: () => void; onDiscard: () => void;
}
export default function PlanPreview({ proposal, source, projectName, repoPath, pending, t, onConfirm, onDiscard }: Props) {
  return <section className="sb-sheet sb-plan" aria-label={t('待确认的方案', 'Plan awaiting confirmation')}>
    <span className="sb-eyebrow">{t('方案预览 · 尚未创建任务', 'Plan preview · no tasks created')}</span>
    <h2>{t('这是不是你想要的结果？', 'Does this match what you want?')}</h2>
    <p className="sb-muted">{t('当前项目：', 'Current project: ')}<strong>{projectName}</strong> · <code>{repoPath}</code></p>
    {source && <p className="sb-muted">{t('来稿来源：', 'Submitted by: ')}{source}</p>}
    {proposal.originalIdea && <details open><summary>{t('来稿附带的原始需求', 'Original request included in the draft')}</summary><p className="sb-preserve">{proposal.originalIdea}</p></details>}
    <p className="sb-preserve">{proposal.productSpec}</p>
    <details><summary>{t('实现说明与执行边界', 'Implementation and execution boundaries')}</summary><p className="sb-preserve">{proposal.technicalSpec}</p></details>
    <ol>{proposal.tasks.map((task, index) => <li key={index}>
      <h3>{task.title}</h3>
      <p className="sb-muted">{task.dependsOn.length ? `${t('等待：', 'After: ')}${task.dependsOn.map(i => proposal.tasks[i].title).join(' · ')}` : t('没有前置任务，可首先执行', 'No dependencies; can run first')}</p>
      {task.criteria.map(criterion => <div className="sb-criterion" key={criterion.id}><span>{criterion.kind === 'human' ? t('你体验确认', 'Your experience') : t('AI 取证检查', 'AI evidence check')}</span><p>{criterion.text}</p></div>)}
      <details><summary>{t('执行说明', 'Execution instructions')}</summary><p className="sb-preserve">{task.description}</p></details>
    </li>)}</ol>
    <p className="sb-muted">{t('确认后只创建任务卡，模型执行仍按项目授权启动。看不懂技术条款时，先让经理解释它如何对应你的目标。', 'Confirmation creates cards only. Execution follows project permissions. Ask the manager to explain technical criteria in terms of your goal if needed.')}</p>
    <div className="sb-actions"><button disabled={pending} className="sb-button sb-primary" onClick={onConfirm}>{t('符合我的想法，发布任务', 'Confirm and publish tasks')}</button><button disabled={pending} className="sb-button" onClick={onDiscard}>{t('丢弃方案，重新准备', 'Discard and prepare again')}</button></div>
  </section>;
}
