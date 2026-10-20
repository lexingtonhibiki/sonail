type Translate = (zh: string, en: string) => string;

/** Preserve omission for legacy tasks; explicitly blank input is read-only. */
export function writeScopePatch(text: string | undefined): { allowedWritePaths?: string[] } {
  return text === undefined ? {} : { allowedWritePaths: text.split(/\r?\n/).filter(path => path.length > 0) };
}

export function writeScopeText(paths: string[] | undefined, t: Translate): string {
  if (paths === undefined) return t('未配置（旧版任务）；未声明路径白名单。', 'Unconfigured (legacy); no path allowlist declared.');
  if (!paths.length) return t('只读交付：交付中不得包含任何 Git 文件变更；这并非运行时写入沙箱。', 'Read-only delivery: no Git file changes may be delivered; this is not a runtime write sandbox.');
  return `${t('Git 交付变更仅允许以下仓库相对路径（文件精确匹配；目录以 / 结尾并包含子目录；不支持通配符）：', 'Git delivery changes are limited to these repository-relative paths (exact files; trailing / includes directory descendants; no globs):')}\n${paths.join('\n')}`;
}
