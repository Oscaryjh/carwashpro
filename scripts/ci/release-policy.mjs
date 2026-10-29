import { verify } from 'node:crypto';

const shaPattern = /^[a-f0-9]{40}$/;
const rootCommands = {
  build: 'prisma generate && node scripts/guard-next-build.mjs && next build --webpack',
  start: 'node scripts/validate-release-environment.mjs web && next start',
  'analytics:worker': 'node scripts/validate-release-environment.mjs analytics && node --use-system-ca --import tsx scripts/analytics-refresh-worker.ts',
  'notification:worker': 'node scripts/validate-release-environment.mjs notification && node --use-system-ca --import tsx scripts/notification-queue-worker.ts',
  'whatsapp:worker': 'node scripts/validate-release-environment.mjs whatsapp && node --use-system-ca scripts/run-whatsapp-worker.mjs',
};
const connectorCommands = {
  build: 'tsc -p tsconfig.json',
  start: 'node --use-system-ca dist/server.js',
};

export function checkChanges(paths) {
  return [...new Set(paths.filter(path =>
    /^(prisma\/|scripts\/|\.github\/|supabase\/|deploy\/|deployment\/|infra\/|docker\/)/i.test(path) ||
    /(^|\/)(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|Dockerfile[^/]*|docker-compose[^/]*|compose[^/]*\.ya?ml|Procfile|railway\.[^/]+|nixpacks\.[^/]+|.*\.(sh|bash|ps1|cmd|bat))$/i.test(path) ||
    /(^|\/)(seed|migrat|reset|deploy|startup|entrypoint|instrumentation)/i.test(path) ||
    /(^|\/)[^/]*config[^/]*$/i.test(path) ||
    /(^|\/)\.[^/]*rc([^/]*)?$/i.test(path) ||
    /(^|\/)(\.gitattributes|\.gitignore|\.pnp\.[^/]+)$/i.test(path) ||
    /(^|\/)(next\.config\.[^/]+|tsconfig[^/]*|\.npmrc|\.node-version|\.nvmrc|\.pnpmfile\.[^/]+|pnpm-workspace\.yaml|\.yarnrc[^/]*)$/i.test(path)
  ))].sort();
}

export function checkDeploymentCommands(pkg, connector = false) {
  const scripts = pkg?.scripts;
  if (!scripts || typeof scripts !== 'object') throw new Error('缺少部署 scripts');
  for (const name of Object.keys(scripts)) {
    if (/^(preinstall|install|postinstall|preprepare|prepare|postprepare|dependencies|prepublish|prepublishOnly|prebuild|postbuild|prestart|poststart)$/.test(name) ||
        /^(pre|post)(analytics:worker|notification:worker|whatsapp:worker)$/.test(name)) {
      throw new Error('普通部署不允许生命周期钩子：' + name);
    }
  }
  const allowed = connector ? connectorCommands : rootCommands;
  for (const [name, expected] of Object.entries(allowed)) {
    if (!(name in scripts) && !['build','start'].includes(name)) continue;
    const command = scripts[name];
    if (typeof command !== 'string' || command !== expected) {
      throw new Error('部署入口不是审查过的固定命令：' + name);
    }
  }
}

export function checkIdentity({expectedSha,headSha,latestSha,baseSha,clean}) {
  for (const value of [expectedSha,headSha,latestSha,baseSha]) {
    if (!shaPattern.test(value ?? '') || /^0+$/.test(value)) throw new Error('必须提供完整非零 Git SHA');
  }
  if (!clean) throw new Error('Git checkout 不干净');
  if (expectedSha !== headSha) throw new Error('候选 SHA 与 checkout 不匹配');
  if (latestSha !== expectedSha) throw new Error('候选 SHA 已过期或 ref 不匹配');
  return {sha:headSha,base:baseSha};
}

export function checkApproval({paths,sha,base,approval,publicKey,now=Date.now()}) {
  if (!paths.length) return;
  if (!approval || !publicKey) throw new Error('受控变更缺少可信签名审批证据：' + paths.join(', '));
  try {
    const envelope=JSON.parse(approval);
    if (typeof envelope.payload !== 'string' || typeof envelope.signature !== 'string' ||
        !verify(null,Buffer.from(envelope.payload),publicKey,Buffer.from(envelope.signature,'base64'))) {
      throw new Error('审批签名无效');
    }
    const payload=JSON.parse(Buffer.from(envelope.payload,'base64').toString('utf8'));
    if (payload.version !== 1 || payload.environment !== 'testing' ||
        payload.purpose !== 'reviewed-source-change' || payload.sha !== sha || payload.base !== base ||
        !Array.isArray(payload.paths) ||
        JSON.stringify(payload.paths) !== JSON.stringify([...paths].sort()) ||
        !Number.isFinite(Date.parse(payload.expiresAt)) || Date.parse(payload.expiresAt) <= now) {
      throw new Error('审批内容、范围或有效期不匹配');
    }
  } catch {
    throw new Error('可信审批验证失败');
  }
}

export function evaluateResults(linux,policy) {
  if (linux !== 'success' || policy !== 'success') throw new Error('Linux validation 与 Release policy 必须均为 success');
}
