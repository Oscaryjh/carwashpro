import { evaluateResults } from './release-policy.mjs';

try {
  evaluateResults(process.env.LINUX_RESULT, process.env.POLICY_RESULT);
  console.log('Release Gate 通过：仅为 CI 验证，不授权部署或数据库操作。');
} catch (error) {
  console.error('[Release Gate] ' + error.message);
  process.exitCode = 1;
}
