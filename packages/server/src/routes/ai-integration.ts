import { Router } from 'express';
import { fileURLToPath } from 'node:url';
import type { Workflow } from '../services/workflow.js';
import { asyncHandler } from './helpers.js';
import { bearerToken } from '../middleware/auth.js';

export function aiIntegrationRouter(engine: Workflow): Router {
  const router = Router();
  router.use(asyncHandler(async (req, res, next) => {
    const token = bearerToken(req.headers.authorization);
    const credential = engine.aiAccess.authenticate(token);
    if (!credential) { res.status(401).json({ error: '凭据无效、已撤销或已过期 / Invalid, revoked or expired credential' }); return; }
    const context = await engine.importContext(credential.projectId);
    if (context.fingerprint !== credential.fingerprint) { res.status(409).json({ error: '项目目录已变化，请重新签发凭据 / Project changed; issue a new credential' }); return; }
    res.locals.credential = credential; res.locals.context = context;
    next();
  }));
  router.get('/context', (_req, res) => res.json({ ...res.locals.context, permission: res.locals.credential.permission }));
  router.post('/preview', asyncHandler(async (req, res) => {
    const credential = res.locals.credential;
    if (credential.permission !== 'preview') { res.status(403).json({ error: '只读凭据不能提交方案 / Read-only credential cannot submit a draft' }); return; }
    const token = bearerToken(req.headers.authorization)!;
    if (JSON.stringify(req.body).includes(token)) { res.status(400).json({ error: '不要在方案内放入密钥 / Keep credentials out of the plan' }); return; }
    try {
      const preview = await engine.previewImport(credential.projectId, req.body.proposal, req.body.expectedRevision, req.body.fingerprint, credential.name);
      res.json({ preview, message: '方案已送审，尚未创建任务卡；请让用户在想法与规格页面确认 / Draft staged, no cards created; user confirmation required' });
    } catch (error) { res.status(409).json({ error: engine.store.redact(String((error as Error).message)) }); }
  }));
  return router;
}

export function aiSetup(port: number | undefined) {
  return { url: `http://127.0.0.1:${port}`, command: process.execPath, script: fileURLToPath(new URL('../../../../scripts/sonail-mcp.mjs', import.meta.url)) };
}
