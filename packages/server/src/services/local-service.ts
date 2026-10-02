import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ServiceStatus, ShortcutStatus } from '../../../../shared/workbench.js';
import { isLoopbackAddress } from '../network-policy.js';
const execute = promisify(execFile);
type ShortcutAction = 'Status' | 'EnableAutostart' | 'DisableAutostart' | 'CreateDesktop';
type Runner = (action: ShortcutAction) => Promise<ShortcutStatus>;
export function isLocalServicePeer(address: string | undefined): boolean {
  return isLoopbackAddress({ address: (address || '').replace(/^::ffff:/i, ''), family: 'IPv4', port: 0 });
}

/** Local OS operations accept fixed actions, never user-provided commands or paths. */
export class LocalService {
  private changing = false;
  constructor(readonly root = path.resolve('.'), private platform: string = process.platform, private runner?: Runner, private probe = async (url: string) => {
    try { return (await fetch(url, { method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(2000) })).ok; } catch { return false; }
  }) {}
  private uiPort() {
    try {
      const facts = JSON.parse(fs.readFileSync(path.join(this.root, 'data/runtime/processes.json'), 'utf8').replace(/^\uFEFF/, ''));
      const port = facts.find((item: { name: string }) => item.name === 'sonail-ui')?.port;
      if (Number.isInteger(port) && port > 0 && port <= 65535) return port;
    } catch { /* No saved runtime yet; the launcher's stable default applies. */ }
    return 19101;
  }
  private async shortcuts(action: ShortcutAction): Promise<ShortcutStatus> {
    if (this.platform !== 'win32') throw new Error('当前自启动入口仅支持 Windows / Windows startup only');
    if (this.runner) return this.runner(action);
    const binary = path.join(process.env.WINDIR || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const { stdout } = await execute(binary, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(this.root, 'scripts/manage-shortcuts.ps1'), '-Action', action], { cwd: this.root, windowsHide: true, encoding: 'utf8', timeout: 20000, maxBuffer: 128000 });
    const result = JSON.parse(stdout.trim().replace(/^\uFEFF/, '')) as ShortcutStatus;
    if (typeof result.enabled !== 'boolean' || typeof result.conflict !== 'boolean' || typeof result.desktopExists !== 'boolean') throw new Error('启动项状态无法核实 / Cannot verify shortcut state');
    return result;
  }
  async status(): Promise<ServiceStatus> {
    const url = `http://127.0.0.1:${this.uiPort()}/workbench`;
    const result: ServiceStatus = { supported: this.platform === 'win32', apiRunning: true, uiRunning: await this.probe(url), url, launcherPath: path.join(this.root, '打开Sonail.cmd'), dataPath: path.join(this.root, 'data') };
    if (result.supported) try { result.shortcuts = await this.shortcuts('Status'); } catch (e) { result.error = `读取 Windows 启动项失败 / Startup state unavailable: ${(e as Error).message}`; }
    return result;
  }
  private async change(action: ShortcutAction) {
    if (this.changing) throw new Error('启动设置正在更新，请稍候 / Startup change in progress');
    this.changing = true;
    try { await this.shortcuts(action); return await this.status(); } finally { this.changing = false; }
  }
  async setAutostart(input: unknown): Promise<ServiceStatus> {
    if (!input || typeof input !== 'object' || Object.keys(input).some(key => key !== 'enabled') || typeof (input as { enabled?: unknown }).enabled !== 'boolean') throw new Error('自启动设置无效 / Invalid autostart settings');
    return this.change((input as { enabled: boolean }).enabled ? 'EnableAutostart' : 'DisableAutostart');
  }
  async createDesktop(): Promise<ServiceStatus> { return this.change('CreateDesktop'); }
  launcher(): string {
    if (this.platform !== 'win32') throw new Error('当前启动入口仅支持 Windows / Windows launcher only');
    const file = path.join(this.root, 'scripts/launch-sonail.ps1').replace(/'/g, "''");
    const encoded = Buffer.from(`& '${file}' -Open`, 'utf16le').toString('base64');
    return `@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -EncodedCommand ${encoded}\r\n`;
  }
}
