import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {prisma} from "../../src/lib/prisma";
import {enqueue,findQueued,markSending,recoverExpiredSending,markDeliveryStatus} from "../../src/lib/notification-queue/repository";
import {enqueueClosingReportForSnapshot,enqueueUnclosedClosingReminders,enqueueManualClosingWhatsAppSend} from "../../src/lib/closing-whatsapp/queue";
import {queueDueUnclosedClosingReminders} from "../../src/lib/closing-whatsapp/scheduler";
import {walletTestDatabase} from "../helpers/wallet-fixture";

async function assertDisposableDatabase() {
 try {
  // Match the official disposable runner context; reuse its existing DB safety helper.
  assert.equal(process.env.TETAMU_ENVIRONMENT,"TESTING");
  assert.equal(process.env.TETAMU_WALLET_LOCAL_TEST,"true");
  const checkedDatabase=walletTestDatabase();
  await checkedDatabase.$disconnect();
 } catch {
  throw new Error("REFUSING_NON_DISPOSABLE_DATABASE: local disposable DB and disposable runner test context required");
 }
}

test("retirement database guard refuses unsafe hosts, ordinary databases and unsafe execution contexts before writes",async()=>{
  for(const [url,environment,localTest] of [
   ["postgresql://test:test@unsafe.invalid/retirement_disposable","TESTING","true"],
   ["postgresql://test:test@localhost/tetamu_local","TESTING","true"],
   ["postgresql://test:test@localhost/retirement_disposable","PRODUCTION","true"],
   ["postgresql://test:test@localhost/retirement_disposable","TESTING","false"],
  ]) {
   // Separate processes keep Prisma's lazy environment capture isolated as well.
   const env:NodeJS.ProcessEnv={...process.env,DATABASE_URL:url,TETAMU_ENVIRONMENT:environment,TETAMU_WALLET_LOCAL_TEST:localTest};
   delete env.NODE_TEST_CONTEXT;
   const result=spawnSync(process.execPath,["--import","tsx","--test","--test-name-pattern=^retired Closing producers",fileURLToPath(import.meta.url)],{
    env,encoding:"utf8",timeout:15000,
   });
   assert.equal(result.error,undefined);
   assert.equal(result.status,1);
   assert.match(result.stdout+result.stderr,/REFUSING_NON_DISPOSABLE_DATABASE/);
   assert.doesNotMatch(result.stdout+result.stderr,/PrismaClientInitializationError|Invalid `prisma\./);
  }
});

test("retired Closing producers reject before writes and pending work is never claimed or recovered",async()=>{
 await assertDisposableDatabase();
 const business=await prisma.business.create({data:{name:"Retirement fixture",slug:randomUUID()}});
 const branch=await prisma.branch.create({data:{businessId:business.id,name:"Main"}});
 for(const call of [
  ()=>enqueueClosingReportForSnapshot(randomUUID()),
  ()=>enqueueUnclosedClosingReminders({businessId:business.id,branchId:branch.id,businessDate:"2026-10-02"}),
  ()=>enqueueManualClosingWhatsAppSend({businessId:business.id,attemptId:randomUUID(),requestedByUserId:randomUUID(),trigger:"MANUAL_RETRY",reason:"test"}),
  ()=>enqueue({businessId:business.id,messageType:"DAILY_CLOSING_REPORT",phone:"synthetic",message:"Never sent"}),
 ])await assert.rejects(call,/DAILY_CLOSING_RETIRED/);
 assert.equal(await prisma.notificationQueue.count({where:{businessId:business.id}}),0);
 assert.deepEqual(await queueDueUnclosedClosingReminders({businessId:business.id}),{branchesChecked:0,queued:0,skipped:0});
 const ids:string[]=[];
 for(const messageType of ["DAILY_CLOSING_REPORT","DAILY_CLOSING_UNCLOSED_REMINDER"]){
  for(const status of ["QUEUED","SENDING","SENT","FAILED"] as const){
   const row=await prisma.notificationQueue.create({data:{businessId:business.id,messageType,status,phone:"synthetic",message:"Frozen",retryCount:1,nextAttemptAt:new Date(0),leaseExpiresAt:status==="SENDING"?new Date(0):null,claimToken:status==="SENDING"?randomUUID():null}});ids.push(row.id);
  }
 }
 const rows=()=>prisma.notificationQueue.findMany({where:{id:{in:ids}},orderBy:{id:"asc"}});
 const before=await rows();
 assert.deepEqual(await findQueued({businessId:business.id}),[]);
 for(const id of ids)assert.equal(await markSending(id),null);
 await recoverExpiredSending();
 assert.deepEqual(await rows(),before);
 assert.equal(await prisma.whatsAppSendAttempt.count({where:{businessId:business.id}}),0);
 const ordinary=await enqueue({businessId:business.id,messageType:"APPOINTMENT_REMINDER",phone:"synthetic",message:"Mock only"});
 assert.equal((await findQueued({businessId:business.id}))[0].id,ordinary.id);
 assert.equal((await markSending(ordinary.id))?.status,"SENDING");
 // Already-sent historical delivery callbacks remain supported, without resend.
 const historical=await prisma.notificationQueue.create({data:{businessId:business.id,messageType:"DAILY_CLOSING_REPORT",status:"SENT_TO_SERVER",phone:"synthetic",message:"Already sent",providerMessageId:randomUUID()}});
 const count=await prisma.notificationQueue.count({where:{businessId:business.id}});
 const attempts=await prisma.whatsAppSendAttempt.count({where:{businessId:business.id}});
 const callback=await markDeliveryStatus({businessId:business.id,providerMessageId:historical.providerMessageId!,status:"DELIVERED"});
 assert.equal(callback.updated,1);
 assert.equal((await prisma.notificationQueue.findUniqueOrThrow({where:{id:historical.id}})).status,"DELIVERED");
 assert.equal(await prisma.notificationQueue.count({where:{businessId:business.id}}),count);
 assert.equal(await prisma.whatsAppSendAttempt.count({where:{businessId:business.id}}),attempts);
 assert.equal(await prisma.whatsAppSendAttempt.count({where:{queueId:historical.id}}),0);
});
