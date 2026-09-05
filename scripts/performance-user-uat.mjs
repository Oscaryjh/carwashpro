import { readFileSync, writeFileSync, existsSync, mkdirSync, openSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import net from 'node:net';
const root='/Users/innovdia/.codex/local-uat/tetamu-performance-20260905';
const repository='/Users/innovdia/Development/carwashpro';
const output='/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-uat';
const runtime=`${root}/runtime`, base='http://127.0.0.1:3106';
mkdirSync(root,{recursive:true,mode:0o700});mkdirSync(output,{recursive:true});
const mode=process.argv[2];
if(mode==='configure'&&!existsSync(`${root}/config.json`)){
  writeFileSync(`${root}/config.json`,JSON.stringify({ownerPassword:`UatOnly-${randomBytes(9).toString('base64url')}!`,env:{
    PATH:process.env.PATH,DATABASE_URL:'postgresql://postgres:postgres@127.0.0.1:5432/tetamu_performance_disposable_phase3_20260905_a?application_name=tetamu_performance_user_uat',
    PORT:'3106',TETAMU_ENVIRONMENT:'TESTING',APP_ENVIRONMENT:'testing',NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',
    SESSION_SECRET:randomBytes(48).toString('hex'),EMPLOYEE_AUTH_SECRET:randomBytes(48).toString('hex'),
    OTP_PROVIDER:'sms123',SMS123_API_KEY:'INVALID-ISOLATED-UAT-NO-SEND',AI_GLOBAL_ENABLED:'false',
    TETAMU_PERFORMANCE_PHASE1:'true',TETAMU_PERFORMANCE_PHASE2:'true',TETAMU_STAFF_PERFORMANCE:'true'
  }}),{mode:0o600,flag:'wx'});
}
const config=JSON.parse(readFileSync(`${root}/config.json`,'utf8'));
const env={...config.env};
if(!env.DATABASE_URL.startsWith('postgresql://postgres:postgres@127.0.0.1:5432/tetamu_performance_disposable_phase3_20260905_a?')||env.PORT!=='3106')throw new Error('Unexpected UAT configuration');
const run=(cmd,args,cwd=runtime,options={})=>{const result=spawnSync(cmd,args,{cwd,env,stdio:'inherit',...options});if(result.status!==0)throw new Error(`${cmd} exited ${result.status}`);};
const listening=()=>new Promise(resolve=>{const socket=net.connect({host:'127.0.0.1',port:3106});socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));});
if(mode==='configure'){
  if(await listening())throw new Error('Refusing to replace an active UAT runtime');
  run('/usr/bin/rsync',['-a','--exclude=/.git','--exclude=/.local-postgres','--exclude=/node_modules','--exclude=/.next','--exclude=/.env*','--exclude=/uploads','--exclude=/logs','--exclude=*.log',`${repository}/`,`${runtime}/`],repository);
  if(!existsSync(`${runtime}/node_modules`))run('/bin/ln',['-s',`${repository}/node_modules`,`${runtime}/node_modules`],repository);
  console.log('Full dirty source copied; private testing configuration generated. No production environment inherited.');
}else if(mode==='build'){
  if(await listening())throw new Error('Stop only the UAT server before rebuilding its runtime');
  run('npm',['run','build'],runtime,{stdio:['ignore',openSync(`${output}/build.log`,'w'),openSync(`${output}/build-stderr.log`,'w')]});
}else if(mode==='seed'){
  run(`${repository}/node_modules/.bin/tsx`,['scripts/prepare-performance-user-uat.ts']);
}else if(mode==='start'){
  if(await listening()){
    const state=JSON.parse(readFileSync(`${root}/server.json`,'utf8'));
    const cwd=execFileSync('/usr/sbin/lsof',['-a','-p',String(state.pid),'-d','cwd','-Fn'],{encoding:'utf8'});
    if(!cwd.includes(`n${runtime}\n`))throw new Error('Port 3106 belongs to a different process');
    console.log(`UAT already running: ${base}`);process.exit(0);
  }
  if(!existsSync(`${runtime}/.next/BUILD_ID`))throw new Error('Optimized build missing');
  run(process.execPath,['scripts/validate-release-environment.mjs','web']);
  const log=openSync(`${output}/server.log`,'a');
  const child=spawn(process.execPath,['--import',`${runtime}/scripts/performance-user-uat-network-guard.mjs`,`${runtime}/node_modules/next/dist/bin/next`,'start','--hostname','127.0.0.1','--port','3106'],{cwd:runtime,env,detached:true,stdio:['ignore',log,log]});
  child.unref();writeFileSync(`${root}/server.json`,JSON.stringify({pid:child.pid,runtime,base,database:'tetamu_performance_disposable_phase3_20260905_a',startedAt:new Date().toISOString()}),{mode:0o600});
  for(let i=0;i<40;i++){if(await listening()){console.log(`UAT running: ${base}; PID ${child.pid}; worker not started.`);process.exit(0);}await new Promise(r=>setTimeout(r,250));}throw new Error('UAT did not start; inspect server.log');
}else if(mode==='stop'){
  if(!await listening()){console.log('UAT is already stopped. Original 3000 was not touched.');process.exit(0);}
  const state=JSON.parse(readFileSync(`${root}/server.json`,'utf8'));
  const cwd=execFileSync('/usr/sbin/lsof',['-a','-p',String(state.pid),'-d','cwd','-Fn'],{encoding:'utf8'});
  const command=execFileSync('/bin/ps',['-p',String(state.pid),'-o','command='],{encoding:'utf8'});
  if(!cwd.includes(`n${runtime}\n`)||!command.includes('next-server'))throw new Error('UAT PID identity mismatch; refusing to stop it');
  process.kill(state.pid,'SIGTERM');console.log('Only isolated UAT port 3106 stopped. Database/data retained.');
}else if(mode==='open'){
  const role=process.argv[3];if(!['owner','owner-pos','manager','A','B','C'].includes(role))throw new Error('Unknown UAT role');
  run(process.execPath,['scripts/performance-user-uat.mjs','start']);
  run(`${repository}/node_modules/.bin/tsx`,['scripts/prepare-performance-user-uat.ts']);
  const log=openSync(`${output}/desktop-browser.log`,'a');
  const child=spawn(process.execPath,['scripts/performance-user-uat-browser.mjs',role],{cwd:runtime,env,detached:true,stdio:['ignore',log,log]});child.unref();
  console.log(`Opening isolated ${role} browser. No OTP, no shared browser identity. Close and use this shortcut again to restore an expired session.`);
}else if(mode==='smoke'){
  run(process.execPath,['scripts/performance-user-uat-browser.mjs','smoke']);
}else if(mode==='verify'){
  run(process.execPath,['scripts/verify-performance-user-uat.mjs']);
}else if(mode==='shortcuts'){
  mkdirSync(`${output}/试用入口`,{recursive:true});
  for(const [name,args] of [['01 老板 Owner','open owner'],['02 店长 Manager','open manager'],['03 员工 A','open A'],['04 员工 B','open B'],['05 员工 C','open C'],['06 POS 服务结账','open owner-pos'],['启动 UAT','start'],['停止 UAT','stop']]){
    const path=`${output}/试用入口/${name}.command`;
    writeFileSync(path,`#!/bin/zsh\n${JSON.stringify(process.execPath)} ${JSON.stringify(`${runtime}/scripts/performance-user-uat.mjs`)} ${args}\n`,{mode:0o700});chmodSync(path,0o700);
  }
  console.log('Double-click role shortcuts generated; no credentials are embedded.');
}else throw new Error('Use configure/build/seed/start/stop/open <role>/smoke/shortcuts');
