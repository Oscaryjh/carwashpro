import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { createClosingActionsFixture } from "./closing-actions-fixture";

export async function createOptionalSettingsFixture(database:PrismaClient) {
  const auth=await createClosingActionsFixture(database);
  const dir=await mkdtemp(join(process.cwd(),'node_modules/.cache/optional-settings-actions-'));
  try{
    await build({entryPoints:['src/app/(business)/business/settings/cashier-operations-actions.ts'],outfile:join(dir,'actions.cjs'),bundle:true,packages:'external',platform:'node',format:'cjs',plugins:[{name:'request',setup(b){b.onResolve({filter:/^@\/lib\/prisma$|^next\/(headers|cache|navigation)$/},a=>({path:a.path,namespace:'request'}));b.onLoad({filter:/.*/,namespace:'request'},a=>({contents:a.path.endsWith('prisma')?'export const prisma=globalThis.closingDb;':a.path.endsWith('headers')?'export async function cookies(){return {get(){return globalThis.closingCookie ? {value:globalThis.closingCookie}:undefined}}} export async function headers(){return new Headers()}':a.path.endsWith('navigation')?'export function redirect(url){throw Object.assign(new Error("REDIRECT"),{url})} export function unstable_rethrow(){}':'export function revalidatePath(){}'}));}}]});
    const actions=createRequire(import.meta.url)(join(dir,'actions.cjs')) as typeof import('../../src/app/(business)/business/settings/cashier-operations-actions');
    return {actions,login:auth.login,async close(){await auth.close();await rm(dir,{recursive:true,force:true});}};
  }catch(error){await auth.close();await rm(dir,{recursive:true,force:true});throw error;}
}

// Test-only barrier after a real Business row lock, never a mock lock. The
// second Prisma connection must wait for this transaction before it can write.
export function holdBusinessLock(database:PrismaClient,kind:'SHARE'|'UPDATE') {
  let held=false;let unlock!:()=>void;let acquired!:()=>void;
  const ready=new Promise<void>(r=>acquired=r),releasePromise=new Promise<void>(r=>unlock=r);
  const db=new Proxy(database,{get(target,key){if(key==='$transaction')return (cb:Function,options:unknown)=>target.$transaction(tx=>cb(new Proxy(tx,{get(t,k){if(k==='$queryRaw')return async (...args:unknown[])=>{const result=await (t.$queryRaw as Function)(...args);const text=args.map(a=>Array.isArray(a)?a.join(''):(a as {strings?:string[]})?.strings?.join('')??String(a)).join('');if(!held && text.includes('FROM businesses') && text.includes('FOR ') && text.endsWith(kind)){held=true;acquired();await releasePromise;}return result;};return Reflect.get(t,k);}})),options as never);return Reflect.get(target,key);}}) as PrismaClient;
  return {db,ready,release:unlock};
}
