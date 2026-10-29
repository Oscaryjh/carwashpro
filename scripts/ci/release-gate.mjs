import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { checkChanges,checkDeploymentCommands,checkIdentity,checkApproval } from './release-policy.mjs';

const git=(...args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:16*1024*1024}).trim();
const options=process.argv.slice(2);
const option=name=>{const index=options.indexOf(name);return index < 0 ? '' : options[index+1] ?? '';};
try {
  const base=option('--base'),expected=option('--expected'),ref=option('--latest-ref');
  if (!/^[a-f0-9]{40}$/.test(base) || !/^[a-f0-9]{40}$/.test(expected) ||
      !/^refs\/(heads\/[A-Za-z0-9_./-]+|pull\/[0-9]+\/merge)$/.test(ref)) throw new Error('缺少合法 base、expected 或 ref');
  const status=git('status','--porcelain=v1','--untracked-files=all');
  const head=git('rev-parse','--verify','HEAD^{commit}');
  // 必须重新读取真实 origin ref。无网络或无权限时失败，不降级为本地缓存。
  const rows=git('ls-remote','--exit-code','origin',ref).split('\n');
  const row=rows.map(line=>line.split(/\s+/)).find(parts=>parts[1]===ref);
  if (!row) throw new Error('远程 ref 不存在');
  const latest=row[0];
  const identity=checkIdentity({expectedSha:expected,headSha:head,latestSha:latest,baseSha:base,clean:!status});
  git('cat-file','-e',base+'^{commit}');
  git('merge-base','--is-ancestor',base,head);
  if (readdirSync('.').some(name=>/^\.env($|\.)/.test(name) && !name.endsWith('.example'))) throw new Error('候选 checkout 不允许实际 dotenv 文件（example 模板除外）');
  const changed=git('diff','--name-only','--no-renames','-z',base,head).split('\0').filter(Boolean);
  const controlled=checkChanges(changed);
  checkDeploymentCommands(JSON.parse(readFileSync('package.json','utf8')));
  if (existsSync('whatsapp-connector/package.json')) checkDeploymentCommands(JSON.parse(readFileSync('whatsapp-connector/package.json','utf8')),true);
  // Railway 的有效配置无法从 Git 认证；仓库内未审查过的配置一律拒绝。
  for (const name of ['railway.json','railway.toml','nixpacks.toml','Procfile']) {
    if (existsSync(name)) throw new Error('未审查的部署配置：'+name);
  }
  checkApproval({paths:controlled,sha:head,base,approval:process.env.RELEASE_GATE_APPROVAL,publicKey:process.env.RELEASE_GATE_APPROVAL_PUBLIC_KEY});
  const schemaManifest=execFileSync('git',['ls-tree','-r','-z',head,'--','prisma'],{maxBuffer:16*1024*1024});
  const tree=git('rev-parse',head+'^{tree}');
  console.log(JSON.stringify({
    version:1,kind:'ci-validation-candidate',...identity,tree,
    schemaDigest:createHash('sha256').update(schemaManifest).digest('hex'),
    ref,controlledPaths:controlled,
    deploymentAuthorized:false,
    railwayConfigurationVerified:false,
    schemaApplicationVerified:false,
  },null,2));
} catch(error) {
  console.error('[Release Gate] '+error.message);
  process.exitCode=1;
}
