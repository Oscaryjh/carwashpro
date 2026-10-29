import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { checkChanges, checkDeploymentCommands, checkIdentity, checkApproval, evaluateResults } from '../scripts/ci/release-policy.mjs';

const sha = 'a'.repeat(40), base = 'b'.repeat(40);
const identity = { expectedSha: sha, headSha: sha, latestSha: sha, baseSha: base, clean: true };
const scripts = { build: 'prisma generate && node scripts/guard-next-build.mjs && next build --webpack', start: 'node scripts/validate-release-environment.mjs web && next start' };
test('普通文档变更可通过，候选身份绑定完整 SHA', () => {
  assert.deepEqual(checkChanges(['docs/help.md']), []);
  assert.equal(checkIdentity(identity).sha, sha);
  assert.doesNotThrow(() => checkDeploymentCommands({ scripts }));
});
for (const path of ['prisma/schema.prisma', 'prisma/migrations/new/migration.sql', 'scripts/prisma-helper.ts', 'scripts/ci/release-policy.mjs', '.github/workflows/x.yml', 'package.json', 'package-lock.json', 'Dockerfile.web', 'railway.toml', 'nixpacks.toml', 'prisma/seed.ts', 'whatsapp-connector/package.json', 'next.config.mjs', '.npmrc', 'src/instrumentation.ts', 'postcss.config.mjs', 'babel.config.js', '.babelrc', 'prisma.config.ts']) {
  test('受控路径必须要求审批：' + path, () => assert.deepEqual(checkChanges([path]), [path]));
}
for (const cmd of ['npx prisma migrate deploy', 'prisma migrate dev', 'prisma migrate reset', 'prisma db push', 'npm run prisma:seed', 'node prisma/seed.ts', 'npm run reset', 'node scripts/custom-start.mjs', 'echo safe && prisma\n migrate deploy']) {
  test('普通部署命令拒绝：' + cmd, () => assert.throws(() => checkDeploymentCommands({ scripts: { ...scripts, start: cmd } })));
}
for (const hook of ['preinstall','install','postinstall','preprepare','prepare','postprepare','dependencies','prebuild','postbuild','prestart','poststart']) {
  test('拒绝隐式生命周期钩子：' + hook, () => assert.throws(() => checkDeploymentCommands({ scripts: { ...scripts, [hook]: 'node tool.js' } })));
}
for (const patch of [{expectedSha:'short'}, {headSha:base}, {latestSha:base}, {baseSha:''}, {clean:false}]) {
  test('身份不完整、不匹配、过期或脏工作区均拒绝：' + JSON.stringify(patch), () => assert.throws(() => checkIdentity({...identity,...patch})));
}
test('没有可信审批不能放行受控变更，也不接受自声明 JSON', () => {
  assert.throws(() => checkApproval({ paths:['prisma/schema.prisma'], sha, base }));
  assert.throws(() => checkApproval({ paths:['prisma/schema.prisma'], sha, base, approval:'{"approved":true}' }));
});

// 执行 workflow 中实际的 shell 代码；不是只断言源码包含某字符串。
function workflowRun(stepName) {
  const lines=readFileSync(join(import.meta.dirname,'../.github/workflows/cloud-ci.yml'),'utf8').split('\n');
  const start=lines.findIndex(line=>line.trim()==='- name: '+stepName);
  assert.notEqual(start,-1);
  let run=start+1;while(run<lines.length && lines[run].trim()!=='run: |')run++;
  assert.ok(run<lines.length);
  const body=[];
  for(let i=run+1;i<lines.length;i++) {
    if(lines[i] && !lines[i].startsWith('          '))break;
    body.push(lines[i].slice(10));
  }
  return body.join('\n');
}
test('实际汇总步骤只执行基准代码：候选 no-op 不能把失败变绿，dispatch 可用父提交', () => {
  const dir=mkdtempSync(join(tmpdir(),'release-trust-'));
  const git=(...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8'}).trim();
  try {
    git('init','-b','testing');git('config','user.email','fixture@example.invalid');git('config','user.name','Fixture');
    mkdirSync(join(dir,'scripts/ci'),{recursive:true});
    for(const file of ['release-policy.mjs','require-release-results.mjs']) {
      writeFileSync(join(dir,'scripts/ci',file),readFileSync(join(import.meta.dirname,'../scripts/ci',file)));
    }
    git('add','.');git('commit','-m','trusted policy');const base=git('rev-parse','HEAD');
    writeFileSync(join(dir,'scripts/ci/release-policy.mjs'),'export function evaluateResults() {}\n');
    git('add','.');git('commit','-m','poison candidate');const sha=git('rev-parse','HEAD');
    const env={...process.env,RUNNER_TEMP:dir,BASE_SHA:base,EXPECTED_SHA:sha,EVENT_NAME:'push',LINUX_RESULT:'failure',POLICY_RESULT:'failure'};
    let result=spawnSync('bash',['-c',workflowRun('Require both jobs to succeed')],{cwd:dir,env,encoding:'utf8'});
    assert.notEqual(result.status,0,'候选不能修改最终判定');
    result=spawnSync('bash',['-c',workflowRun('Require both jobs to succeed')],{cwd:dir,env:{...env,EVENT_NAME:'workflow_dispatch',BASE_SHA:'',LINUX_RESULT:'success',POLICY_RESULT:'success'},encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('实际策略任务不执行候选测试，不能借 GITHUB_PATH 替换可信解释器', () => {
  const dir=mkdtempSync(join(tmpdir(),'release-path-'));
  const repo=join(dir,'repo'),runner=join(dir,'runner');mkdirSync(repo);mkdirSync(runner);
  const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8'}).trim();
  try {
    git('init','-b','testing');git('config','user.email','fixture@example.invalid');git('config','user.name','Fixture');git('remote','add','origin',repo);
    mkdirSync(join(repo,'scripts/ci'),{recursive:true});mkdirSync(join(repo,'tests'));mkdirSync(join(repo,'prisma'));
    for(const file of ['release-policy.mjs','release-gate.mjs'])writeFileSync(join(repo,'scripts/ci',file),readFileSync(join(import.meta.dirname,'../scripts/ci',file)));
    writeFileSync(join(repo,'package.json'),JSON.stringify({scripts}));git('add','.');git('commit','-m','base');const base=git('rev-parse','HEAD');
    writeFileSync(join(repo,'prisma/schema.prisma'),'unapproved schema');
    writeFileSync(join(repo,'tests/release-gates.test.mjs'),`import {mkdirSync,writeFileSync,appendFileSync} from 'node:fs';
      const bin=process.env.RUNNER_TEMP+'/bin';mkdirSync(bin);writeFileSync(bin+'/node','#!/bin/sh\\nexit 0\\n',{mode:0o755});
      appendFileSync(process.env.GITHUB_PATH,bin+'\\n');writeFileSync(process.env.RUNNER_TEMP+'/executed','yes');`);
    git('add','.');git('commit','-m','malicious tests');const sha=git('rev-parse','HEAD');
    const workflow=readFileSync(join(import.meta.dirname,'../.github/workflows/cloud-ci.yml'),'utf8');
    const section=workflow.split('  release-policy:')[1].split('  release-gate:')[0];
    const lines=section.split('\n');const commands=[];
    for(let i=0;i<lines.length;i++) {
      if(!lines[i].startsWith('        run: '))continue;
      if(lines[i].trim()!=='run: |')commands.push(lines[i].trim().slice(5));
      else {const body=[];for(i++;i<lines.length && (!lines[i] || lines[i].startsWith('          '));i++)body.push(lines[i].slice(10));commands.push(body.join('\n'));i--;}
    }
    assert.ok(commands.length);
    const pathFile=join(runner,'github_path');writeFileSync(pathFile,'');
    const env={...process.env,RUNNER_TEMP:runner,GITHUB_PATH:pathFile,BASE_SHA:base,EXPECTED_SHA:sha,LATEST_REF:'refs/heads/testing',EVENT_NAME:'push',RELEASE_GATE_APPROVAL:'',RELEASE_GATE_APPROVAL_PUBLIC_KEY:''};
    let result;
    for(const command of commands) {
      result=spawnSync('bash',['-e','-c',command],{cwd:repo,env,encoding:'utf8'});
      if(result.status!==0)break;
      env.PATH=readFileSync(pathFile,'utf8').trim()+':'+env.PATH;
    }
    assert.notEqual(result.status,0,'未批准 schema 不能被假 node 放行');
    assert.throws(()=>readFileSync(join(runner,'executed')),'不应执行候选测试');
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('审批签名必须绑定候选、基准、路径、有效期和 Testing 范围', () => {
  const {publicKey,privateKey} = generateKeyPairSync('ed25519');
  const key = publicKey.export({format:'pem',type:'spki'});
  const payload = {version:1,environment:'testing',sha,base,paths:['prisma/schema.prisma'],expiresAt:'2099-01-01T00:00:00Z',purpose:'reviewed-source-change'};
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
  const approval = JSON.stringify({payload:encoded,signature:sign(null,Buffer.from(encoded),privateKey).toString('base64')});
  assert.doesNotThrow(() => checkApproval({paths:payload.paths,sha,base,approval,publicKey:key}));
  for(const patch of [{sha:base},{base:sha},{paths:['scripts/start.mjs']},{now:Date.parse('2100-01-01')}]) {
    assert.throws(() => checkApproval({paths:payload.paths,sha,base,approval,publicKey:key,...patch}));
  }
  const other = generateKeyPairSync('ed25519').publicKey.export({format:'pem',type:'spki'});
  assert.throws(() => checkApproval({paths:payload.paths,sha,base,approval,publicKey:other}));
});
test('Linux CI 失败、跳过、取消、未知状态不能汇总为通过', () => {
  assert.doesNotThrow(() => evaluateResults('success','success'));
  for(const value of ['failure','skipped','cancelled','','unknown']) {
    assert.throws(() => evaluateResults(value,'success'));
    assert.throws(() => evaluateResults('success',value));
  }
});
test('真实 Git checkout：合法候选通过，未跟踪文件和过期远程候选失败', () => {
  const dir=mkdtempSync(join(tmpdir(),'release-gate-'));
  const git=(...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8'}).trim();
  try {
    git('init','-b','testing'); git('config','user.email','fixture@example.invalid'); git('config','user.name','Fixture');
    git('remote','add','origin',dir);
    writeFileSync(join(dir,'package.json'),JSON.stringify({scripts}));
    writeFileSync(join(dir,'.env.example'),'EXAMPLE_ONLY=true\n');
    mkdirSync(join(dir,'prisma'));writeFileSync(join(dir,'prisma/schema.prisma'),'fixture schema\n');
    git('add','.');git('commit','-m','base');const before=git('rev-parse','HEAD');
    mkdirSync(join(dir,'docs'));writeFileSync(join(dir,'docs/help.md'),'help\n');git('add','.');git('commit','-m','docs');
    const head=git('rev-parse','HEAD');
    const cli=join(import.meta.dirname,'../scripts/ci/release-gate.mjs');
    const run=()=>spawnSync(process.execPath,[cli,'--base',before,'--expected',head,'--latest-ref','refs/heads/testing'],{cwd:dir,encoding:'utf8'});
    let result=run(); assert.equal(result.status,0,result.stderr);
    const candidate=JSON.parse(result.stdout);assert.equal(candidate.sha,head);assert.equal(candidate.deploymentAuthorized,false);
    assert.match(candidate.schemaDigest,/^[a-f0-9]{64}$/);
    writeFileSync(join(dir,'dirty'),'dirty');result=run();assert.notEqual(result.status,0);rmSync(join(dir,'dirty'));
    writeFileSync(join(dir,'.git/info/exclude'),'.env.local\n');writeFileSync(join(dir,'.env.local'),'IGNORED_LOCAL_ONLY=true\n');
    result=run();assert.notEqual(result.status,0,'忽略的 dotenv 文件也必须拒绝');rmSync(join(dir,'.env.local'));
    git('branch','other',before);
    result=spawnSync(process.execPath,[cli,'--base',before,'--expected',head,'--latest-ref','refs/heads/other'],{cwd:dir,encoding:'utf8'});
    assert.notEqual(result.status,0);
    git('mv','prisma/schema.prisma','docs/moved.prisma');git('commit','-m','rename protected schema');
    const renamed=git('rev-parse','HEAD');
    result=spawnSync(process.execPath,[cli,'--base',before,'--expected',renamed,'--latest-ref','refs/heads/testing'],{cwd:dir,encoding:'utf8',env:{...process.env,RELEASE_GATE_APPROVAL:'',RELEASE_GATE_APPROVAL_PUBLIC_KEY:''}});
    assert.notEqual(result.status,0);assert.match(result.stderr,/受控变更缺少可信签名审批证据/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
