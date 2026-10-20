import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { validateAllowedWritePaths, validRepoPath } from '@ai-agent-board/shared/workflow.js';

// This is a delivery-diff gate, NOT a filesystem sandbox. Ignored files are excluded.
function records(cwd: string, args: string[]): string[] {
  const bytes = execFileSync('git', args, { cwd, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  const output = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  if (!output) return [];
  if (!output.endsWith('\0')) throw new Error('Invalid Git NUL path output');
  return output.slice(0, -1).split('\0');
}
export function assertWriteScope(cwd: string, allowedWritePaths: string[] | undefined, baseCommit: string): void {
  validateAllowedWritePaths(allowedWritePaths);
  if (allowedWritePaths === undefined) return;
  if (!/^[0-9a-f]{40,64}$/.test(baseCommit)) throw new Error('Write scope requires an immutable base commit');
  const changed = new Set<string>(); const links = new Set<string>(); const submodules = new Set<string>();
  // Separate snapshots prevent staged changes canceled by unstaged edits from disappearing.
  for (const comparison of [[baseCommit, 'HEAD'], ['--cached', 'HEAD'], []]) {
    const rows = records(cwd, ['diff', '--no-ext-diff', '--no-textconv', '--ignore-submodules=none', '--raw', '--no-abbrev', '--no-renames', '-z', ...comparison, '--']);
    if (rows.length % 2) throw new Error('Invalid Git raw diff output');
    for (let i = 0; i < rows.length; i += 2) {
      const header = /^:(\d{6}) (\d{6}) [0-9a-f]+ [0-9a-f]+ [A-Z]$/.exec(rows[i]);
      if (!header || !validRepoPath(rows[i + 1])) throw new Error('Invalid Git diff path or mode');
      const name = rows[i + 1]; changed.add(name);
      if (header[1] === '160000' || header[2] === '160000') submodules.add(name);
      if (header[1] === '120000' || header[2] === '120000') links.add(name);
    }
  }
  for (const name of records(cwd, ['ls-files', '--others', '--exclude-standard', '-z'])) {
    if (!validRepoPath(name)) throw new Error('Invalid Git untracked path');
    changed.add(name);
  }
  for (const name of changed) {
    // lstat each component, never follow a symlink to inspect an external target.
    let file = cwd;
    for (const component of name.split('/')) {
      file = path.join(file, component);
      try { if (fs.lstatSync(file).isSymbolicLink()) { links.add(name); break; } }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') break; throw error; }
    }
  }
  const outside = [...changed].filter(name => !allowedWritePaths.some(scope => scope.endsWith('/') ? name.startsWith(scope) : name === scope));
  if (outside.length) throw new Error(`交付超出写入范围 / Write scope violation: ${outside.map(name => JSON.stringify(name)).join(', ')}`);
  if (submodules.size) throw new Error(`范围交付不允许变更子模块 / Changed submodules are not supported: ${[...submodules].map(name => JSON.stringify(name)).join(', ')}`);
  if (links.size) throw new Error(`范围交付不允许变更符号链接 / Changed symlinks are not supported: ${[...links].map(name => JSON.stringify(name)).join(', ')}`);
}
