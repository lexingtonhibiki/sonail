import { useEffect, useState } from 'react';
import type { WorkbenchSettings } from '../../../../shared/workbench';

export default function ToolsDirectorySettings({ value, t, pending, onSave }: {
  value: WorkbenchSettings; t: (zh: string, en: string) => string; pending: boolean; onSave: (value: WorkbenchSettings) => void;
}) {
  const [directory, setDirectory] = useState(value.toolsDirectory || '');
  useEffect(() => setDirectory(value.toolsDirectory || ''), [value.toolsDirectory]);
  return <>
    <h2>{t('工具安装目录', 'Tools directory')}</h2>
    <p className="sb-muted">{t('供经理规划、任务执行和复制交接时使用。需要安装工具时，AI会在这个目录下按工具区分子目录。', 'Planning, task execution and copied handoffs use separate subdirectories for each tool.')}</p>
    <label>{t('安装目录', 'Installation directory')}<input value={directory} disabled={pending} onChange={e => setDirectory(e.target.value)} placeholder={t('绝对路径；留空恢复默认', 'Absolute path; blank restores default')} /></label>
    <div className="sb-actions">
      <button className="sb-button sb-primary" disabled={pending} onClick={() => onSave({ ...value, toolsDirectory: directory })}>{t('保存工具目录', 'Save tools directory')}</button>
      <button className="sb-button" disabled={pending} onClick={() => { setDirectory(value.toolsDirectory || ''); onSave({ ...value, toolsDirectory: '' }); }}>{t('恢复默认目录', 'Restore default directory')}</button>
    </div>
    <p className="sb-muted">{t('Windows 有 D 盘时默认 D:/DevTools，否则使用用户本地应用数据目录；其他系统使用用户数据目录。保存设置不会创建目录或安装工具，联网与安装仍遵守项目授权。', 'Windows defaults to D:/DevTools when D exists, otherwise local app data; other systems use user data. Saving does not create directories or install tools. Network and installation follow project permissions.')}</p>
  </>;
}
