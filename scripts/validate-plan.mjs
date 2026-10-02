import fs from 'node:fs';
import { validateProposal } from '../shared/dist/workflow.js';

try {
  if (!process.argv[2]) throw new Error('Usage: node scripts/validate-plan.mjs <plan.json>');
  const proposal = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  validateProposal(proposal);
  console.log(JSON.stringify({ valid: true, taskCount: proposal.tasks.length }));
} catch (error) { console.error(String(error.message)); process.exitCode = 1; }
