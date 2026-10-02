import { ArrowRight, Check, CircleHelp, FolderOpen, ShieldCheck } from 'lucide-react';
import type { Project } from '@/types';

type Translate = (zh: string, en: string) => string;
export type GuideDestination = 'projects' | 'settings' | 'spec' | 'board' | 'manager';
interface Props {
  t: Translate; project?: Project; taskCount: number; integratedCount: number;
  onCreate: () => void; onNavigate: (tab: GuideDestination) => void; onExample: () => void;
}

export default function UsageGuide({ t, project, taskCount, integratedCount, onCreate, onNavigate, onExample }: Props) {
  const hasRepo = Boolean(project?.repoPath);
  const complete = taskCount > 0 && integratedCount === taskCount;
  const steps = [
    { title: t('选好项目目录', 'Choose your project'), text: t('选择要交付的项目文件夹。目录需要 Git 和至少一次提交；新建项目时填写的是已有文件夹路径。', 'Choose the folder you want to work on. It needs Git and at least one commit. Creating a project registers an existing folder.'), done: hasRepo, action: t('选择 / 新建项目', 'Choose / create project'), run: () => onNavigate('projects') },
    { title: t('选择三个 AI 角色', 'Choose your three AI roles'), text: t('经理把控整个项目，执行者完成任务，独立审查者检查单个任务。分别选择已安装并登录的工具、模型和思考等级。', 'The manager coordinates the project, the executor performs each task, and the independent reviewer checks it. Select an installed, authenticated harness, model and effort for each.'), action: t('配置角色', 'Configure roles'), run: () => onNavigate('settings') },
    { title: t('确认想法与任务方案', 'Confirm your idea and plan'), text: t('用自己的话讲需求，让经理起草；已有方案也可粘贴 JSON。先确认方案是不是你想要的，再发布任务卡。', 'Describe what you want and ask the manager to draft it, or paste an existing JSON plan. Confirm the plan matches your intent before publishing task cards.'), done: taskCount > 0, action: t('生成 / 导入任务', 'Generate / import tasks'), run: () => onNavigate('spec') },
    { title: t('启动、审查与返工', 'Execute, review and revise'), text: t('在任务卡里启动。执行后会经过独立审查和经理把关；需要处理时，经理记录会说明原因和下一步。', 'Start from a task card. Execution is followed by independent review and manager checks. Manager records explain any blocker and the next action.'), action: t('查看任务看板', 'Open task board'), run: () => onNavigate('board') },
    { title: t('体验确认，然后合入', 'Try the result, then integrate'), text: t('你只需确认实际体验。经理和审查者负责检查代码证据。验收后合入，才能解锁依赖它的下游任务；误点 Done 可填写原因重新打开。', 'Confirm the actual experience; the manager and reviewer check code evidence. Integrate accepted work to unlock dependents. An accidental Done can be reopened with a reason.'), done: taskCount > 0 && integratedCount === taskCount, action: t('查看经理意见', 'Read manager recommendations'), run: () => onNavigate('manager') },
  ];
  return <div className="sb-guide">
    <section className="sb-sheet sb-guide-intro"><span className="sb-eyebrow">{t('从想法到交付', 'FROM IDEA TO DELIVERY')}</span><h2>{t('不用懂代码，也能掌握项目进展', 'Keep control without reading every line of code')}</h2><p>{t('先用手动模式走完一个小任务，再按需要开启完全托管。每一步都可以从这里进入。', 'Try one small task in manual mode first, then enable fully managed mode when useful. Each step is reachable here.')}</p>
      {project ? <div className="sb-guide-project"><FolderOpen size={17} /><div><strong>{project.name}</strong><code>{project.repoPath || t('尚未指定项目目录', 'No repository selected')}</code><small>{t('确认这是你要处理的项目。', 'Check this is the project you intend to work on.')} · {integratedCount}/{taskCount} {t('任务已合入', 'tasks integrated')}</small></div></div> : <p className="sb-muted">{t('先选择或新建一个项目。', 'Choose or create a project first.')}</p>}
      <div className="sb-actions"><button className="sb-button sb-primary" onClick={hasRepo ? () => onNavigate(taskCount ? 'board' : 'spec') : onCreate}>{hasRepo ? (taskCount ? (complete ? t('查看已交付任务', 'View delivered work') : t('继续当前任务', 'Continue current work')) : t('开始准备任务方案', 'Prepare a task plan')) : t('新建项目', 'Create project')}<ArrowRight size={15} /></button><button className="sb-button" disabled={!hasRepo || taskCount > 0} title={taskCount ? t('此项目已有任务，请新建演示项目', 'This project already has tasks; use a separate demo project') : undefined} onClick={onExample}>{t('载入两任务示例', 'Load two-task example')}</button></div><small className="sb-muted">{t('示例会先填入编辑区，确认后才创建卡片。建议在独立演示项目中尝试。', 'The example opens in the editor for confirmation. Try it in a separate demo project.')}</small>
    </section>
    <ol className="sb-guide-steps">{steps.map((step, index) => <li className="sb-sheet" key={index}><span className={`sb-guide-number ${step.done ? 'sb-guide-done' : ''}`}>{step.done ? <Check size={18} /> : String(index + 1).padStart(2, '0')}</span><div><h3>{step.title}</h3><p>{step.text}</p><button className="sb-button sb-small" disabled={index > 0 && !hasRepo} onClick={step.run}>{step.action}<ArrowRight size={14} /></button></div></li>)}</ol>
    <section className="sb-sheet"><h2><ShieldCheck size={19} />{t('手动模式与完全托管', 'Manual and fully managed modes')}</h2><p className="sb-muted">{t('默认逐批启动、由你验收和合入。角色与设置里的完全托管可授权经理自动推进、客观验收和合入；需要你体验、发生冲突或达到返工上限时，会停下来给出意见。', 'By default, you start batches, accept results and integrate work. Fully managed mode in role settings can authorize progression, objective acceptance and integration. Experience checks, conflicts and revision limits still stop for attention.')}</p><button className="sb-button" disabled={!hasRepo} onClick={() => onNavigate('settings')}>{t('查看授权设置', 'View authorizations')}</button></section>
    <section className="sb-sheet"><h2><CircleHelp size={19} />{t('卡住时看哪里', 'Where to look when blocked')}</h2><p className="sb-muted">{t('先看任务卡状态和“经理给你的消息”，再打开经理记录。模型调用失败先检查工具登录、模型名称与思考等级；不要用反复拖到 Done 的方式跳过审核。', 'Start with the task status and manager guidance, then manager records. For model failures, check harness login, model ID and effort. Dragging to Done does not bypass review.')}</p></section>
  </div>;
}
