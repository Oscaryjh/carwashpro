// P1A-only migration evidence. Never accepts an external database URL.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createEmbeddedPostgres, ensurePostgresReady, ensureDatabaseExists, stopOwnedPostgres, DATABASE_PORT } from './embedded-postgres-utils.mjs';

const baseline = '007bbf397185915f66c1477cf4a498f618298799';
const root = resolve('.');
const temp = await mkdtemp(join(tmpdir(), 'tetamu-wallet-upgrade-'));
const schema = execFileSync('git', ['show', `${baseline}:prisma/schema.prisma`], { encoding: 'utf8', maxBuffer: 4_000_000 });
await mkdir(join(temp, 'migrations'));
await writeFile(join(temp, 'schema.prisma'), schema);
const migrations = (await readdir('prisma/migrations', { withFileTypes: true })).filter(x => x.isDirectory()).map(x => x.name).sort();
assert.ok(migrations.length >= 224);
const historical = migrations.slice(0, 222);
for (const migration of historical) {
  const file = `prisma/migrations/${migration}/migration.sql`;
  assert.deepEqual(await readFile(file), execFileSync('git', ['show', `${baseline}:${file}`]), `Historical migration changed: ${migration}`);
}
await cp('prisma/migrations/migration_lock.toml', join(temp, 'migrations/migration_lock.toml'));
for (const name of historical) await cp(join(root, 'prisma/migrations', name), join(temp, 'migrations', name), { recursive: true });
const pg = createEmbeddedPostgres();
const name = `tetamu_wallet_disposable_${process.pid}_${Date.now()}`;
const url = `postgresql://postgres:postgres@localhost:${DATABASE_PORT}/${name}?schema=public`;
let owns = false;
let client;
try {
  owns = await ensurePostgresReady(pg);
  await ensureDatabaseExists(pg, name);
  await prisma(['migrate', 'deploy', '--schema', join(temp, 'schema.prisma')]);
  client = pg.getPgClient(name, '127.0.0.1');
  await client.connect();
  assert.equal(Number((await client.query('SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL')).rows[0].count), 222);
  const historicalFk = (await client.query("SELECT conname FROM pg_constraint WHERE conrelid='attendance_timesheet_p2_segment_snapshots'::regclass AND confrelid='attendance_timesheet_p2_day_snapshots'::regclass AND contype='f'")).rows;
  assert.deepEqual(historicalFk, [{ conname: 'attendance_timesheet_p2_segment_snapshots_source_day_snapshot_i' }]);
  console.log('Clean 222 actual FK:', historicalFk[0].conname);
  await prisma(['migrate', 'diff', '--from-url', url, '--to-schema-datamodel', join(temp, 'schema.prisma'), '--exit-code'], 2);
  const fkBefore = await foreignKey();
  assert.equal(fkBefore.definition, 'FOREIGN KEY (source_day_snapshot_id) REFERENCES attendance_timesheet_p2_day_snapshots(id) ON UPDATE CASCADE ON DELETE RESTRICT');
  const indexesBefore = await indexes();
  assert.equal(Number((await client.query("SELECT count(*) FROM pg_constraint WHERE conrelid='attendance_timesheet_p2_segment_snapshots'::regclass AND conname='att_ts_p2_segment_source_day_snapshot_fkey_probe'")).rows[0].count), 0);
  console.log('PASS: historical 222 drift reproduced; FK definition verified; destination name free.');
  const businessId = randomUUID();
  const customerId = randomUUID();
  await client.query('INSERT INTO businesses(id,name,slug,updated_at) VALUES($1,$2,$3,now())', [businessId, 'WALLET_UPGRADE_SYNTHETIC', `wallet-${randomUUID()}`]);
  await client.query('INSERT INTO customers(id,business_id,name,phone,updated_at) VALUES($1,$2,$3,$4,now())', [customerId, businessId, 'Synthetic migration customer', randomUUID()]);
  await client.query("INSERT INTO payments(id,business_id,amount,method,updated_at) VALUES($1,$2,12.34,'CARD',now())", [randomUUID(), businessId]);
  const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations' ORDER BY tablename")).rows.map(x => x.tablename);
  const before = await snapshots(tables, false);
  const checksums = (await client.query('SELECT migration_name,checksum FROM _prisma_migrations ORDER BY migration_name')).rows;
  await prisma(['migrate', 'deploy']);
  const fkAfter = await foreignKey();
  assert.equal(fkAfter.conname, 'att_ts_p2_segment_source_day_snapshot_fkey_probe');
  assert.deepEqual({ ...fkAfter, conname: fkBefore.conname }, fkBefore, 'FK identity and entire definition must remain unchanged');
  assert.deepEqual(await indexes(), indexesBefore, 'All target Attendance table indexes must remain unchanged');
  assert.deepEqual(await snapshots(tables, true), before, 'Existing table contents must not change');
  const after = (await client.query('SELECT migration_name,checksum FROM _prisma_migrations ORDER BY migration_name')).rows;
  assert.equal(after.length, 225);
  assert.deepEqual(after.slice(0, 222), checksums);
  for (const row of after) {
    const contents = await readFile(join(root, 'prisma/migrations', row.migration_name, 'migration.sql'));
    assert.equal(createHash('sha256').update(contents).digest('hex'), row.checksum);
  }
  for (const table of ['wallet_accounts','wallet_top_up_offers','wallet_top_ups','wallet_top_up_reversals','wallet_transactions']) {
    assert.equal(Number((await client.query(`SELECT count(*) FROM ${client.escapeIdentifier(table)}`)).rows[0].count), 0);
  }
  assert.equal(Number((await client.query("SELECT count(*) FROM payments WHERE purpose <> 'LEGACY'")).rows[0].count), 0);
  console.log(`PASS: 222 -> 225; ${tables.length} old table row counts and contents unchanged; all checksums match; wallet tables empty; payments LEGACY; FK definition and all target Attendance table indexes unchanged.`);
  await prisma(['migrate', 'diff', '--from-url', url, '--to-schema-datamodel', 'prisma/schema.prisma', '--exit-code']);
  console.log('PASS: schema drift absent.');
} finally {
  await client?.end();
  assert.match(name, /^tetamu_wallet_disposable_\d+_\d+$/);
  const cleanup = pg.getPgClient('postgres', '127.0.0.1');
  try {
    await cleanup.connect();
    await cleanup.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [name]);
    await cleanup.query(`DROP DATABASE IF EXISTS ${cleanup.escapeIdentifier(name)}`);
  } finally { await cleanup.end(); await stopOwnedPostgres(pg, owns); }
}
async function snapshots(tables, upgraded) {
  const output = {};
  for (const table of tables) {
    const projection = upgraded && table === 'payments' ? "to_jsonb(t)-'purpose'" : 'to_jsonb(t)';
    const rows = (await client.query(`SELECT (${projection})::text AS value FROM ${client.escapeIdentifier(table)} t ORDER BY value`)).rows;
    output[table] = { count: rows.length, sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex') };
  }
  return output;
}
async function foreignKey() {
  const rows = (await client.query("SELECT oid, conname, pg_get_constraintdef(oid) AS definition, conkey, confkey, confrelid, confupdtype, confdeltype, confmatchtype, condeferrable, condeferred, convalidated FROM pg_constraint WHERE conrelid='attendance_timesheet_p2_segment_snapshots'::regclass AND confrelid='attendance_timesheet_p2_day_snapshots'::regclass AND contype='f'")).rows;
  assert.equal(rows.length, 1);
  return rows[0];
}
async function indexes() {
  return (await client.query("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='attendance_timesheet_p2_segment_snapshots' ORDER BY indexname")).rows;
}
function prisma(args, expectedCode = 0) {
  return new Promise((ok, fail) => {
    const child = spawn(process.execPath, [resolve('node_modules/prisma/build/index.js'), ...args], { stdio: 'inherit', env: { ...process.env, DATABASE_URL: url } });
    child.on('error', fail);
    child.on('exit', code => code === expectedCode ? ok() : fail(new Error(`prisma exit ${code}; expected ${expectedCode}`)));
  });
}
