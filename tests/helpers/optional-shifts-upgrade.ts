import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { PrismaClient } from "@prisma/client";
// Existing repository-owned disposable PostgreSQL lifecycle, not a new runner.
// @ts-expect-error Repository mjs utility has no declaration file.
import { createEmbeddedPostgres, ensureDatabaseExists } from "../../scripts/embedded-postgres-utils.mjs";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { assertMigrationHistory } from "../../scripts/lib/canonical-migration-history.mjs";

const foundationMigration = "20261002010000_optional_cashier_shifts";
const defaultOffMigration = "20261003000000_cashier_shifts_default_off";
// Pin the historical target schema, not today's schema with later additions.
const defaultOffRevision = "78cb25468ac9ab247cbff96c64e4cac24d45be12";

export function optionalShiftMigrationChain(names: string[], baseline: string[]) {
  assert.deepEqual(names, [...names].sort(), "Migration order must remain chronological");
  assert.equal(new Set(names).size, names.length, "Duplicate migration names");
  const chain = [...baseline, foundationMigration, defaultOffMigration];
  assert.deepEqual(names.slice(0, chain.length), chain, "Optional Shift migrations must follow the immutable baseline without gaps or insertions");
  return chain;
}

export async function verifyOptionalShiftsUpgrade() {
  const root=process.cwd();
  const names=(await readdir('prisma/migrations',{withFileTypes:true})).filter(x=>x.isDirectory()).map(x=>x.name).sort();
  // Pinned canonical226 revision: execution HEAD may already contain227.
  const baselineRevision='ff6ee704866eafdfa730b072e2d3ce4aec038ab1';
  const baselineNames=execFileSync('git',['ls-tree','-d','--name-only',`${baselineRevision}:prisma/migrations`],{encoding:'utf8'}).trim().split(/\r?\n/).sort();
  const targetChain=optionalShiftMigrationChain(names,baselineNames);
  const targetSchema=execFileSync('git',['show',`${defaultOffRevision}:prisma/schema.prisma`],{encoding:'utf8',maxBuffer:4_000_000});
  for(const migration of [foundationMigration,defaultOffMigration]) {
    const file=`prisma/migrations/${migration}/migration.sql`;
    assert.deepEqual(await readFile(file),execFileSync('git',['show',`${defaultOffRevision}:${file}`]),`Historical Shift SQL changed: ${migration}`);
  }
  const temp=await mkdtemp(join(tmpdir(),'tetamu-optional-shifts-'));
  const baseline=execFileSync('git',['show',`${baselineRevision}:prisma/schema.prisma`],{encoding:'utf8',maxBuffer:4_000_000});
  // A 226 schema must be seeded with its pinned posting contract, not the new
  // Phase2 service which correctly requires the 227 setting column. This test
  // proves migration/trigger integrity; Phase2 action tests cover new execution.
  const postingSource=execFileSync('git',['show',`${baselineRevision}:src/lib/wallet/top-up.ts`],{encoding:'utf8'});
  const bundled=await build({stdin:{contents:postingSource,resolveDir:resolve('src/lib/wallet'),loader:'ts'},bundle:true,write:false,platform:'node',format:'cjs',packages:'external'});
  const baselineModule={exports:{}};
  new Function('require','module','exports',bundled.outputFiles[0].text)(createRequire(import.meta.url),baselineModule,baselineModule.exports);
  const {postWalletTopUp}=baselineModule.exports as typeof import('../../src/lib/wallet/top-up');
  assert.doesNotMatch(baseline,/cashierShiftsEnabled/);
  const name=`tetamu_optional_shifts_disposable_${process.pid}_${Date.now()}`;
  assert.match(name,/^tetamu_optional_shifts_disposable_\d+_\d+$/);
  const url=`postgresql://postgres:postgres@127.0.0.1:5432/${name}?schema=public`;
  const pg=createEmbeddedPostgres();
  await mkdir(join(temp,'migrations'));
  await writeFile(join(temp,'schema.prisma'),baseline);
  await cp('prisma/migrations/migration_lock.toml',join(temp,'migrations/migration_lock.toml'));
  for(const n of baselineNames){
    const file=`prisma/migrations/${n}/migration.sql`;
    assert.deepEqual(await readFile(file),execFileSync('git',['show',`${baselineRevision}:${file}`]),`Historical SQL changed: ${n}`);
    await cp(join(root,'prisma/migrations',n),join(temp,'migrations',n),{recursive:true});
  }
  let created=false;let client: ReturnType<typeof pg.getPgClient>;let db:PrismaClient|undefined;
  const prisma=(args:string[])=>new Promise<void>((ok,fail)=>{
    const child=spawn(process.execPath,[resolve('node_modules/prisma/build/index.js'),...args],{env:{...process.env,DATABASE_URL:url},stdio:'inherit'});
    child.on('error',fail);child.on('exit',code=>code===0?ok():fail(Error(`Prisma command failed ${code}`)));
  });
  try{
    await ensureDatabaseExists(pg,name);created=true;
    await prisma(['migrate','deploy','--schema',join(temp,'schema.prisma')]);
    client=pg.getPgClient(name,'127.0.0.1');await client.connect();
    assert.equal(Number((await client.query('SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL')).rows[0].count),baselineNames.length);
    db=new PrismaClient({datasources:{db:{url}}});
    // Seed only the pre-227 Business columns: the new Prisma Client sends its
    // new default even with select:{id:true}. Old-schema fixture must not use it.
    const b={id:randomUUID()};
    await db.$executeRaw`INSERT INTO businesses(id,name,slug,industry_type,updated_at) VALUES(${b.id}::uuid,'Upgrade fixture',${`optional-${randomUUID()}`},'SALON_BEAUTY',now())`;
    for(const moduleKey of ['POS','WALLET'] as const) await db.businessModuleEntitlement.create({data:{businessId:b.id,moduleKey,status:'ENABLED',source:'MANUAL',enabledFrom:new Date(0)}});
    const branch=await db.branch.create({data:{businessId:b.id,name:'Main'}});
    const user=await db.user.create({data:{businessId:b.id,branchId:branch.id,name:'Migration owner',role:'BUSINESS_OWNER'}});
    const shift=await db.cashierShift.create({data:{businessId:b.id,branchId:branch.id,cashierId:user.id}});
    const customer=await db.customer.create({data:{businessId:b.id,name:'Migration customer',phone:randomUUID()}});
    const offer=await db.walletTopUpOffer.create({data:{businessId:b.id,name:'Upgrade offer',paidAmount:1000,bonusAmount:100}});
    const result=await postWalletTopUp({businessId:b.id,branchId:branch.id,shiftId:shift.id,user:{userId:user.id}},{customerId:customer.id,offerId:offer.id,expectedOfferVersion:0,paymentMethodCode:'BUILTIN_CASH',operationKey:randomUUID()},db);
    const beforeTopUp=await db.walletTopUp.findUniqueOrThrow({where:{id:result.topUpId}});
    // Run the complete real posting service (operation, account, paid/bonus
    // ledger and audit), injecting only the proposed nullable schema fields.
    // Never UPDATE history or disable any database guard.
    const insertTopUp = async (shiftId:string|null, overrides:Partial<Record<'payment'|'walletTopUp'|'walletTransaction',Record<string,unknown>|((data:Record<string,unknown>)=>Record<string,unknown>)>>={})=>{
      const operationKey=randomUUID();
      const fixtureDb=new Proxy(db!,{get(target,key){if(key==='$transaction')return (cb:Function,options:unknown)=>target.$transaction(async tx=>{
        const wrapped=new Proxy(tx,{get(t,k){if(k==='payment'||k==='walletTopUp'||k==='walletTransaction'){const delegate=t[k];return new Proxy(delegate,{get(d,method){if(method==='create')return (args:{data:Record<string,unknown>})=>{const changes=overrides[k];const mutation=typeof changes==='function'?changes(args.data):changes;return (d.create as Function)({...args,data:{...args.data,...(k==='walletTransaction'?{}:{shiftId}),...mutation}});};return Reflect.get(d,method);}});}return Reflect.get(t,k);}});
        const value=await cb(wrapped);
        const rows=await tx.$queryRaw<Array<{top_up_shift:string|null;payment_shift:string|null;paid_ledger:bigint;bonus_ledger:bigint;has_shift:boolean}>>`SELECT t.shift_id AS top_up_shift,p.shift_id AS payment_shift,(SELECT count(*) FROM wallet_transactions WHERE top_up_id=t.id AND type='TOP_UP_PAID') AS paid_ledger,(SELECT count(*) FROM wallet_transactions WHERE top_up_id=t.id AND type='TOP_UP_BONUS') AS bonus_ledger,EXISTS(SELECT 1 FROM cashier_shifts WHERE id=t.shift_id AND branch_id=t.branch_id) AS has_shift FROM wallet_top_ups t JOIN payments p ON p.id=t.external_payment_id JOIN financial_operations o ON o.id=t.financial_operation_id WHERE o.operation_key=${operationKey}`;
        if(rows.length) console.log('NULL_SHIFT_COMPLETE_CHAIN_DIAGNOSTIC',JSON.stringify(rows,(_,v)=>typeof v==='bigint'?String(v):v));
        return value;
      },options as never);return Reflect.get(target,key);}}) as PrismaClient;
      return (await postWalletTopUp({businessId:b.id,branchId:branch.id,shiftId:shift.id,user:{userId:user.id}},{customerId:customer.id,offerId:offer.id,expectedOfferVersion:0,paymentMethodCode:'BUILTIN_CASH',operationKey},fixtureDb)).topUpId;
    };
    await assert.rejects(insertTopUp(null),/null|23502/i,'226 rejects null shift');
    const tables=(await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename")).rows.map((r:{tablename:string})=>r.tablename);
    async function facts(upgraded:boolean){const out:Record<string,unknown>={};for(const table of tables){const projection=upgraded && table==='businesses'?"to_jsonb(t)-'cashier_shifts_enabled'":'to_jsonb(t)';const rows=(await client.query(`SELECT (${projection})::text AS value FROM ${client.escapeIdentifier(table)} t ORDER BY value`)).rows;out[table]={count:rows.length,sha256:createHash('sha256').update(JSON.stringify(rows)).digest('hex')};}return out;}
    const before=await facts(false);
    // PostgreSQL 18 also represents NOT NULL in pg_constraint. Only the
    // expressly approved shift_id NOT NULL removal is excluded from equality.
    const fk=()=>client.query("SELECT oid,conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='wallet_top_ups'::regclass AND conname<>'wallet_top_ups_shift_id_not_null' ORDER BY oid").then((r:{rows:unknown[]})=>r.rows);
    const indexes=()=>client.query("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='wallet_top_ups' ORDER BY indexname").then((r:{rows:unknown[]})=>r.rows);
    const oldFK=await fk(),oldIndexes=await indexes();
    await cp(join(root,'prisma/migrations',foundationMigration),join(temp,'migrations',foundationMigration),{recursive:true});
    await prisma(['migrate','deploy','--schema',join(temp,'schema.prisma')]);
    assert.deepEqual(await facts(true),before,'Every old column of every old row remains unchanged');
    assert.deepEqual(await fk(),oldFK);assert.deepEqual(await indexes(),oldIndexes);
    assert.deepEqual(await db.walletTopUp.findUniqueOrThrow({where:{id:result.topUpId}}),beforeTopUp);
    assert.equal((await db.business.findUniqueOrThrow({where:{id:b.id}})).cashierShiftsEnabled,true);
    const offId=randomUUID();
    await db.$executeRaw`INSERT INTO businesses(id,name,slug,industry_type,updated_at,cashier_shifts_enabled) VALUES(${offId}::uuid,'Existing OFF',${randomUUID()},'SALON_BEAUTY',now(),false)`;
    const businesses227=await client.query('SELECT to_jsonb(t)::text AS value FROM businesses t ORDER BY value');
    const facts227=await facts(true);
    await cp(join(root,'prisma/migrations',defaultOffMigration),join(temp,'migrations',defaultOffMigration),{recursive:true});
    await writeFile(join(temp,'schema.prisma'),targetSchema);
    await prisma(['migrate','deploy','--schema',join(temp,'schema.prisma')]);
    assert.deepEqual(await client.query('SELECT to_jsonb(t)::text AS value FROM businesses t ORDER BY value').then((r:{rows:unknown[]})=>r.rows),businesses227.rows,'228 must not change any existing Business column');
    assert.deepEqual(await facts(true),facts227,'228 must not change any historical table facts');
    assert.equal((await db.business.findUniqueOrThrow({where:{id:b.id}})).cashierShiftsEnabled,true);
    assert.equal((await db.business.findUniqueOrThrow({where:{id:offId}})).cashierShiftsEnabled,false);
    assert.equal((await db.business.create({data:{name:'New defaults',slug:randomUUID()}})).cashierShiftsEnabled,false);
    const nullId=await insertTopUp(null);
    assert.equal((await db.walletTopUp.findUniqueOrThrow({where:{id:nullId}})).shiftId,null);
    const nullPayment=await db.payment.findUniqueOrThrow({where:{id:(await db.walletTopUp.findUniqueOrThrow({where:{id:nullId}})).externalPaymentId}});
    assert.equal(nullPayment.shiftId,null,'both nullable legs actually committed');
    // Compare complete committed database facts before/after each rejected graph;
    // a diagnostic inside the transaction alone is not commit/rollback evidence.
    async function rejected(label:string, shiftId:string|null, overrides:Parameters<typeof insertTopUp>[1], expected:RegExp) {
      const checkpoint=await facts(true);
      await assert.rejects(insertTopUp(shiftId,overrides),expected,label);
      assert.deepEqual(await facts(true),checkpoint,`${label}: transaction fully rolled back`);
      console.log(`COMMIT_REJECTED_AND_ROLLED_BACK ${label}`);
    }
    await rejected('TopUp NULL / Payment shifted',null,{payment:{shiftId:shift.id}},/WALLET_TOP_UP_GRAPH_MISMATCH/);
    await rejected('TopUp shifted / Payment NULL',shift.id,{payment:{shiftId:null}},/WALLET_TOP_UP_GRAPH_MISMATCH/);
    const secondShift=await db.cashierShift.create({data:{businessId:b.id,branchId:branch.id,cashierId:user.id,status:'CLOSED',endedAt:new Date()}});
    await rejected('different valid shifts',shift.id,{payment:{shiftId:secondShift.id}},/WALLET_TOP_UP_GRAPH_MISMATCH/);
    await rejected('dangling Shift',randomUUID(),{},/foreign key|23503/i);
    const other=await db.business.create({data:{name:'Foreign',slug:randomUUID()}});
    const otherActor=await db.user.create({data:{businessId:other.id,name:'Foreign',role:'BUSINESS_OWNER'}});
    const otherShift=await db.cashierShift.create({data:{businessId:other.id,cashierId:otherActor.id}});
    await rejected('foreign Shift',otherShift.id,{},/foreign key|23503/i);
    const otherBranch=await db.branch.create({data:{businessId:b.id,name:'Other branch'}});
    const wrongBranchShift=await db.cashierShift.create({data:{businessId:b.id,branchId:otherBranch.id,cashierId:user.id,status:'CLOSED',endedAt:new Date()}});
    await rejected('wrong Branch',wrongBranchShift.id,{},/WALLET_TOP_UP_GRAPH_MISMATCH/);
    await rejected('wrong Business',null,{walletTopUp:{businessId:other.id}},/foreign key|23503/i);
    await rejected('payment amount mismatch',null,{payment:{amount:999,tenderAmount:999}},/WALLET_TOP_UP_GRAPH_MISMATCH/);
    await rejected('ledger amount mismatch',null,{walletTransaction:data=>data.type==='TOP_UP_PAID'?{paidDelta:999}:{}},/WALLET_/);
    await rejected('bonus mismatch',null,{walletTopUp:{bonusAmount:101,totalCredited:1101}},/WALLET_TOP_UP_SOURCE_MISMATCH/);
    const mismatchEntryPrefix=randomUUID();
    await rejected('operation mismatch',null,{walletTransaction:data=>({financialOperationId:beforeTopUp.financialOperationId,entryKey:`${mismatchEntryPrefix}-${data.entryKey}`})},/WALLET_TOP_UP_SOURCE_MISMATCH/);
    const sameId=await insertTopUp(shift.id);
    assert.equal((await db.walletTopUp.findUniqueOrThrow({where:{id:sameId}})).shiftId,shift.id);
    assert.deepEqual(await db.walletTopUp.findUniqueOrThrow({where:{id:result.topUpId}}),beforeTopUp);
    const history=()=>client.query('SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations ORDER BY migration_name').then((r:{rows:unknown[]})=>r.rows);
    const expectedHistory=async (chain:string[])=>Promise.all(chain.map(async migration=>({name:migration,checksum:createHash('sha256').update(await readFile(`prisma/migrations/${migration}/migration.sql`)).digest('hex')})));
    assertMigrationHistory(await expectedHistory(targetChain),await history());
    await prisma(['validate','--schema',join(temp,'schema.prisma')]);
    await prisma(['migrate','diff','--from-url',url,'--to-schema-datamodel',join(temp,'schema.prisma'),'--exit-code']);
    // Only after the historical Shift contract passes, verify today's complete
    // append-only chain. Later additive migrations never enter the 228 assertions.
    await prisma(['migrate','deploy']);
    assertMigrationHistory(await expectedHistory(names),await history());
    await prisma(['validate']);
    await prisma(['migrate','diff','--from-url',url,'--to-schema-datamodel','prisma/schema.prisma','--exit-code']);
    console.log(`PASS historical Optional Shift chain through ${defaultOffMigration}, existing ON/OFF preserved, ${tables.length} table hashes preserved, real TopUp chain unchanged, null allowed, foreign/dangling rejected, FK/index identities unchanged, drift CLEAN, ${names.length} checksums MATCH`);
  }finally{
    await db?.$disconnect();await client?.end();
    if(created){const cleanup=pg.getPgClient('postgres','127.0.0.1');try{await cleanup.connect();await cleanup.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[name]);await cleanup.query(`DROP DATABASE ${cleanup.escapeIdentifier(name)}`);}finally{await cleanup.end();}}
    assert.ok(temp.startsWith(join(tmpdir(),'tetamu-optional-shifts-')));await rm(temp,{recursive:true,force:true});
  }
}
