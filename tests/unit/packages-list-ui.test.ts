import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

async function fixture(total = 1, params: Record<string, string> = {}, actor: { role: string; branchId: string | null; source: string } = { role: 'BUSINESS_OWNER', branchId: '22222222-2222-4222-8222-222222222222', source: 'DIRECT_BUSINESS' }) {
  const bundle = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import Page from './src/app/(business)/packages/page';
    window.fixtureTotal=${total};window.actor=${JSON.stringify(actor)};Page({searchParams:Promise.resolve(${JSON.stringify(params)})}).then(page=>createRoot(document.getElementById('root')).render(page)).catch(error=>window.pageError=error.message);`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, platform: 'browser', jsx: 'automatic', plugins: [{ name: 'isolated-list', setup(b) {
      b.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'link-fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'link-fixture' }, () => ({ contents: `import{createElement}from'react';export default function Link(props){return createElement('a',props)}`, resolveDir: process.cwd() }));
      b.onResolve({ filter: /^@\/lib\/(auth\/business-user|auth\/staff-permissions|prisma)$|^(\.\/actions|\.\/categories\/actions|@\/app\/\(business\)\/packages\/actions)$|^@\/components\/(catalog-categories-modal|package-create-modal)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
        export const requireBusinessUser=async()=>({access:{granted:true,source:window.actor.source,actorRole:'GROUP_MANAGER',businessId:'business'},user:window.actor,businessId:'business',industryType:'SALON_BEAUTY'});
        export const assertStaffPermission=()=>{};export const getActiveBranches=async()=>[{id:'b',name:'Local'}];
        export const createPackageAction=async()=>{throw Error('No create')};
        export const deletePackageAction=async(_,data)=>{window.deletedId=data.get('packageId');return{status:'success',message:'Deleted fixture'}};
        export const createPackageCategoryAction=()=>{};export const deletePackageCategoryAction=()=>{};export const updatePackageCategoryAction=()=>{};
        export const CatalogCategoriesModal=()=>null;export const PackageCreateModal=()=>null;
        const branches=[{id:'22222222-2222-4222-8222-222222222222',businessId:'business',status:'ACTIVE',name:'Internal A'},{id:'33333333-3333-4333-8333-333333333333',businessId:'business',status:'ACTIVE',name:'Internal B'},{id:'44444444-4444-4444-8444-444444444444',businessId:'foreign',status:'ACTIVE',name:'Foreign'}];
        export const prisma={branch:{findMany:async({where})=>branches.filter(b=>b.businessId===where.businessId),findFirst:async({where})=>branches.find(b=>b.id===where.id&&b.businessId===where.businessId&&(!where.status||b.status===where.status))??null},package:{findMany:async(args)=>{window.packageQuery=args;return window.fixtureTotal?[{id:'p1',name:'Facial bundle',price:'200.00',totalUses:5,status:'ACTIVE',packageCategory:{name:'Facial'},serviceBenefits:['First','Second','Third','Fourth'].map(name=>({service:{name},totalUses:1})),_count:{customerPackages:3}}]:[]},count:async(args)=>{window.countQuery=args;return window.fixtureTotal}},packageCategory:{findMany:async()=>[{id:'11111111-1111-4111-8111-111111111111',name:'Facial',status:'ACTIVE'}]},service:{findMany:async()=>[]}};` }));
    } }] });
  const { JSDOM } = createRequire(import.meta.url)('jsdom');
  const dom = new JSDOM(`<div id="root"></div><script>${bundle.outputFiles[0].text}</script>`, { runScripts: 'dangerously', url: 'http://fixture.test/packages' });
  const doc = dom.window.document;
  const wait = async (fn: () => boolean) => { const end = Date.now() + 4000; while (!fn()) { assert.ok(Date.now() < end, 'UI did not settle'); await new Promise(r => setTimeout(r, 10)); } };
  await wait(() => !!doc.querySelector('h1') || !!dom.window.pageError);
  return { dom, doc, wait, close: () => dom.window.close() };
}

test('package list presents linked names, numeric columns, two services and compact single-page footer', async () => {
  const f = await fixture(); try {
    assert.ok(f.doc.querySelector('.packages-list-page'));
    const row = f.doc.querySelector('tbody tr');
    assert.equal(row.querySelector('td:nth-child(3) a').getAttribute('href'), '/packages/p1');
    assert.equal(row.querySelector('td:nth-child(3) a').textContent, 'Facial bundle');
    assert.deepEqual([...f.doc.querySelectorAll('thead .packages-numeric')].map((n: any) => n.textContent), ['Price', 'Total Uses', 'Sold']);
    assert.deepEqual([...row.querySelectorAll('.packages-numeric')].map((n: any) => n.textContent), ['RM200.00', '5', '3']);
    assert.equal(row.querySelector('.packages-services-text').textContent, 'First × 1, Second × 1');
    assert.equal(row.querySelector('.packages-services-more').textContent, '+2 more');
    assert.equal(row.querySelector('.status').textContent, 'ACTIVE');
    assert.match(f.doc.querySelector('.packages-list-footer').textContent, /1 result/);
    assert.equal(f.doc.querySelector('.catalog-pagination'), null);
  } finally { f.close(); }
});

const ownBranch = '22222222-2222-4222-8222-222222222222';
const staff = { role: 'STAFF', branchId: ownBranch, source: 'DIRECT_BUSINESS' };
test('ordinary Packages UI hides internal branch choices and reads shared plus authorised packages', async () => {
  const f = await fixture(1, {}, staff); try {
    assert.ok(f.doc.querySelector('select[name="branchId"]') === null, 'Branch selector must not render');
    assert.doesNotMatch(f.doc.querySelector('.search-form').textContent, /All branches|Internal A|Internal B/);
    assert.ok(f.doc.querySelector('[name="q"]')); assert.ok(f.doc.querySelector('[name="categoryId"]')); assert.ok(f.doc.querySelector('[name="status"]'));
    const where = JSON.parse(JSON.stringify(f.dom.window.packageQuery.where));
    assert.deepEqual(where, { businessId: 'business', OR: [{ branchId: null }, { branchId: ownBranch }] });
    assert.deepEqual(JSON.parse(JSON.stringify(f.dom.window.countQuery.where)), where);
  } finally { f.close(); }
});
for (const branchId of ['bad-id', '44444444-4444-4444-8444-444444444444', '33333333-3333-4333-8333-333333333333', '55555555-5555-4555-8555-555555555555']) {
  test(`server refuses malformed/foreign/unauthorised/missing branch ${branchId} before package reads`, async () => {
    const f = await fixture(1, { branchId }, staff); try {
      assert.match(f.dom.window.pageError ?? '', /Package branch access denied/);
      assert.equal(f.dom.window.packageQuery, undefined);
      assert.equal(f.dom.window.countQuery, undefined);
    } finally { f.close(); }
  });
}
test('authorised legacy branch is preserved as hidden filter payload and revalidated on tampering', async () => {
  const f = await fixture(24, { branchId: ownBranch }, staff); try {
    assert.equal(f.dom.window.pageError, undefined);
    const input = f.doc.querySelector('.search-form input[name="branchId"]');
    assert.equal(input.type, 'hidden'); assert.equal(input.value, ownBranch);
    assert.equal(new f.dom.window.FormData(f.doc.querySelector('.search-form')).get('branchId'), ownBranch);
    assert.deepEqual(JSON.parse(JSON.stringify(f.dom.window.packageQuery.where.AND)), [{ branchId: ownBranch }]);
    assert.match(f.doc.querySelector('.catalog-pagination a:last-child').getAttribute('href'), new RegExp(`branchId=${ownBranch}`));
    input.value = '33333333-3333-4333-8333-333333333333';
    const tamperedParams = Object.fromEntries(new f.dom.window.FormData(f.doc.querySelector('.search-form'))) as Record<string, string>;
    const rejected = await fixture(1, tamperedParams, staff);
    try {
      assert.equal(rejected.dom.window.pageError, 'Package branch access denied.');
      assert.equal(rejected.dom.window.packageQuery, undefined);
    } finally { rejected.close(); }
  } finally { f.close(); }
});
test('unassigned branch-scoped actor retains shared access without gaining other branch packages', async () => {
  const f = await fixture(1, {}, { ...staff, branchId: null }); try {
    const where = JSON.parse(JSON.stringify(f.dom.window.packageQuery.where));
    assert.equal(where.businessId, 'business');
    assert.deepEqual(where.OR, [{ branchId: null }, { branchId: '00000000-0000-0000-0000-000000000000' }]);
  } finally { f.close(); }
});
for (const actor of [{ role: 'BUSINESS_OWNER', branchId: ownBranch, source: 'DIRECT_BUSINESS' }, { role: 'STAFF', branchId: '', source: 'GROUP_ACCESS' }]) {
  test(`whole-Business authorised ${actor.source} retains Business-wide visibility`, async () => {
    const f = await fixture(1, {}, actor); try {
      assert.deepEqual(JSON.parse(JSON.stringify(f.dom.window.packageQuery.where)), { businessId: 'business' });
    } finally { f.close(); }
  });
}

test('filter submission, query scope, ordering and multi-page links retain their existing contract', async () => {
  const categoryId = '11111111-1111-4111-8111-111111111111';
  const f = await fixture(24, { q: ' facial ', categoryId, status: 'ACTIVE', branchId: 'all-branches-only', page: '2' }); try {
    const query = JSON.parse(JSON.stringify(f.dom.window.packageQuery));
    assert.equal(query.where.businessId, 'business');
    assert.deepEqual(query.where.AND, [{ OR: [
      { name: { contains: 'facial', mode: 'insensitive' } },
      { packageCategory: { name: { contains: 'facial', mode: 'insensitive' } } },
      { service: { name: { contains: 'facial', mode: 'insensitive' } } },
      { serviceBenefits: { some: { service: { name: { contains: 'facial', mode: 'insensitive' } } } } },
      { branch: { name: { contains: 'facial', mode: 'insensitive' } } },
    ] }, { categoryId }, { status: 'ACTIVE' }, { branchId: null }]);
    assert.deepEqual(query.orderBy, [{ status: 'asc' }, { name: 'asc' }]);
    assert.equal(query.skip, 10); assert.equal(query.take, 10);
    assert.deepEqual(JSON.parse(JSON.stringify(f.dom.window.countQuery)), { where: query.where });
    const form = f.doc.querySelector('.search-form');
    assert.equal(form.getAttribute('action'), '/packages'); assert.equal(form.method, 'get');
    assert.deepEqual(Object.fromEntries(new f.dom.window.FormData(form)), { q: 'facial', categoryId, status: 'ACTIVE', branchId: 'all-branches-only' });
    assert.ok(form.querySelector('button').classList.contains('button-secondary'));
    const pagination = f.doc.querySelector('.catalog-pagination');
    assert.match(pagination.textContent, /11-20 of 24.*Page 2 of 3/s);
    const links = [...pagination.querySelectorAll('a')];
    assert.equal(links[0].getAttribute('href'), `/packages?q=facial&categoryId=${categoryId}&status=ACTIVE&branchId=all-branches-only`);
    assert.equal(links[1].getAttribute('href'), `/packages?q=facial&categoryId=${categoryId}&status=ACTIVE&branchId=all-branches-only&page=3`);
    assert.equal(f.doc.querySelectorAll('tbody tr').length, 1);
    assert.equal(f.doc.querySelector('tbody .table-number').textContent, '11');
  } finally { f.close(); }
});

test('list delete retains confirmation and passes the original package ID to its action', async () => {
  const f = await fixture(); try {
    let confirmation = '';
    f.dom.window.confirm = (message: string) => { confirmation = message; return false; };
    f.doc.querySelector('.catalog-delete-form button').click();
    assert.equal(confirmation, 'Are you sure you want to delete "Facial bundle"? This cannot be undone.');
    assert.equal(f.dom.window.deletedId, undefined);
    f.dom.window.confirm = () => true;
    f.doc.querySelector('.catalog-delete-form button').click();
    await f.wait(() => f.dom.window.deletedId === 'p1');
  } finally { f.close(); }
});

test('zero matching packages keeps the existing empty state without table or pagination', async () => {
  const f = await fixture(0, { q: 'missing' }); try {
    assert.equal(f.doc.querySelector('.empty-state').textContent, 'No packages yet.');
    assert.equal(f.doc.querySelector('table'), null);
    assert.equal(f.doc.querySelector('.catalog-pagination'), null);
    assert.equal(f.doc.querySelector('.packages-list-footer'), null);
    assert.match(f.doc.querySelector('.page-header p').textContent, /0 packages match this filter/);
  } finally { f.close(); }
});
