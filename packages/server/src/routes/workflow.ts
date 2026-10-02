import { Router } from 'express';
import type { Workflow } from '../services/workflow.js';
import { asyncHandler } from './helpers.js';
import { LocalService, isLocalServicePeer } from '../services/local-service.js';
import { aiSetup } from './ai-integration.js';
import { QuotaService } from '../services/quota.js';

export function workflowRouter(engine: Workflow, service = new LocalService(), quota = new QuotaService()): Router {
  const router = Router();
  router.get('/quota', asyncHandler(async (_req, res) => { res.json(await quota.read(!!engine.store.workbenchSettings().resetForecast)); }));
  router.get('/ai-access/:projectId', asyncHandler(async (req, res) => {
    const id = String(req.params.projectId); await engine.project(id);
    res.json({ credentials: engine.aiAccess.list(id), setup: aiSetup(req.socket.localPort) });
  }));
  router.post('/ai-access/:projectId', asyncHandler(async (req, res) => {
    try {
      const id = String(req.params.projectId); const context = await engine.importContext(id);
      res.json({ ...engine.aiAccess.create(id, context.fingerprint, req.body.name, req.body.permission), setup: aiSetup(req.socket.localPort) });
    } catch (error) { res.status(409).json({ error: engine.store.redact(String((error as Error).message)) }); }
  }));
  router.delete('/ai-access/:projectId/:credentialId', (req, res) => {
    try { engine.aiAccess.revoke(String(req.params.projectId), String(req.params.credentialId)); res.json({ revoked: true }); }
    catch (error) { res.status(409).json({ error: engine.store.redact(String((error as Error).message)) }); }
  });
  router.use('/service', (req, res, next) => { if (!isLocalServicePeer(req.socket.remoteAddress)) { res.status(403).json({ error: '服务启动设置仅允许本机访问 / Local startup settings only' }); return; } next(); });
  router.get('/service', asyncHandler(async (_req, res) => { res.json(await service.status()); }));
  router.put('/service/autostart', asyncHandler(async (req, res) => { try { res.json(await service.setAutostart(req.body)); } catch (e) { res.status(409).json({ error: engine.store.redact(String((e as Error).message)) }); } }));
  router.post('/service/desktop', asyncHandler(async (_req, res) => { try { res.json(await service.createDesktop()); } catch (e) { res.status(409).json({ error: engine.store.redact(String((e as Error).message)) }); } }));
  router.get('/service/launcher', (_req, res) => { try { res.type('application/octet-stream').attachment('Start-Sonail.cmd').send(service.launcher()); } catch (e) { res.status(409).json({ error: engine.store.redact(String((e as Error).message)) }); } });
  router.get('/settings', (_req, res) => res.json(engine.store.workbenchSettings()));
  router.put('/settings', (req, res) => { try { res.json(engine.store.saveWorkbenchSettings(req.body)); } catch (e) { res.status(400).json({ error: engine.store.redact(String((e as Error).message)) }); } });
  router.get('/projects', asyncHandler(async (_req, res) => { res.json(await engine.projectSummaries()); }));
  router.get('/projects/:projectId/tasks', asyncHandler(async (req, res) => { res.json(await engine.projectTaskPreviews(String(req.params.projectId))); }));
  router.put('/projects/:projectId', asyncHandler(async (req, res) => {
    try { res.json(await engine.updateProjectMeta(String(req.params.projectId), req.body)); }
    catch (e) { res.status(409).json({ error: engine.store.redact(String((e as Error).message)) }); }
  }));
  router.get('/endpoints', (_req, res) => res.json(engine.store.listEndpoints()));
  router.get('/:projectId/tasks/:taskId/artifacts', asyncHandler(async (req, res) => {
    try { res.json(await engine.artifacts(String(req.params.projectId), String(req.params.taskId))); }
    catch (e) { res.status(409).json({ error: engine.store.redact(String((e as Error).message)) }); }
  }));
  router.put('/endpoints', (req, res) => { try { engine.store.saveEndpoint(req.body); res.json(engine.store.listEndpoints()); } catch (e) { res.status(400).json({ error: engine.store.redact(String((e as Error).message)) }); } });
  router.get('/:projectId', asyncHandler(async (req, res) => { const id = String(req.params.projectId); await engine.project(id); res.json({ ...engine.store.get(id), projectMeta: engine.store.metadata(id) }); }));
  router.post('/:projectId/:action', asyncHandler(async (req, res) => {
    const id = String(req.params.projectId); await engine.project(id);
    try {
      const action = String(req.params.action); const taskId = String(req.body.taskId || '');
      if (action !== 'pause') engine.assertNotArchived(id);
      if (action === 'preview') {
        const context = await engine.importContext(id);
        await engine.previewImport(id, req.body.proposal, context.revision, context.fingerprint, '手动导入 / Manual import');
      }
      else if (action === 'discard-proposal') await engine.discardProposal(id);
      else if (action === 'settings') engine.saveSettings(id, req.body);
      else if (action === 'propose') { if (engine.busy(id)) throw new Error('项目正在运行 / Project running'); void engine.propose(id).catch(e => engine.store.event(id, { role: 'system', type: 'error', content: String(e.message) })); }
      else if (action === 'publish') await engine.publish(id, req.body.proposal);
      else if (action === 'start') await engine.start(id, taskId, req.body.correction || '');
      else if (action === 'review') { const { policy } = await engine.task(id, taskId); if (['executing', 'reviewing', 'manager-check'].includes(policy.phase)) throw new Error('任务正在运行 / Task running'); void engine.review(id, taskId).catch(() => {}); }
      else if (action === 'accept') await engine.accept(id, taskId);
      else if (action === 'merge') await engine.merge(id, taskId);
      else if (action === 'reopen') await engine.reopen(id, taskId, req.body.reason);
      else if (action === 'edit-task') await engine.editTask(id, taskId, req.body);
      else if (action === 'pause') await engine.pause(id);
      else throw new Error('未知操作 / Unknown action');
      res.json(engine.store.get(id));
    } catch (e) { res.status(409).json({ error: engine.store.redact(String((e as Error).message)) }); }
  }));
  return router;
}
