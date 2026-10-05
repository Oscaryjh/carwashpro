import assert from 'node:assert/strict';
import test, { before, after, beforeEach } from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom') as { JSDOM: new(html: string) => { window: Window & typeof globalThis } };
const category = { id: 'cat-1', businessId: 'business', code: 'RENTAL_INTERNAL', name: 'Rental', group: 'RENTAL', description: 'Monthly rent', active: true, requiresReceipt: false, sortOrder: 10, _count: { expenses: 0 } };
const state = { categories: [category], allowed: true, reads: [] as unknown[] };
const globals = globalThis as typeof globalThis & { __categoryUI?: typeof state; IS_REACT_ACT_ENVIRONMENT?: boolean };
let directory: string;
let Page: (props: { searchParams: Promise<Record<string, string>> }) => Promise<ReactElement>;
before(async () => {
  globals.__categoryUI = state;
  directory = await mkdtemp(join(process.cwd(), 'node_modules/.cache/category-ui-'));
  const stubs: Record<string, string> = {
    'next/link': `import {createElement} from 'react';export default function Link({children,...props}){return createElement('a',props,children)}`,
    '@/lib/auth/business-user': `export const requireBusinessUserForModule=async(m,c)=>{if(m!=='EXPENSE'||c!=='MANAGE_EXPENSE_CATEGORY'||!globalThis.__categoryUI.allowed)throw Error('denied');return {businessId:'business'}};`,
    '@/lib/expense/service': `export const ensureStarterExpenseCategories=async()=>{};`,
    '@/lib/prisma': `export const prisma={expenseCategory:{findMany:async(q)=>{globalThis.__categoryUI.reads.push(q);return globalThis.__categoryUI.categories;}}};`,
  };
  await build({ entryPoints: ['src/app/(business)/expenses/categories/page.tsx'], outfile: join(directory, 'page.cjs'), bundle: true, platform: 'node', packages: 'external', format: 'cjs', jsx: 'automatic', plugins: [{ name: 'io', setup(b) {
    b.onResolve({ filter: /.*/ }, a => stubs[a.path] ? { path: a.path, namespace: 'stub' } : /(?:\/|^)actions$/.test(a.path) ? { path: 'actions', namespace: 'actions' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'stub' }, a => ({ contents: stubs[a.path], resolveDir: process.cwd() }));
    b.onLoad({ filter: /.*/, namespace: 'actions' }, () => ({ contents: `export async function createExpenseCategoryAction(){}; export async function updateExpenseCategoryAction(){}; export async function reorderExpenseCategoriesAction(){};` }));
    b.onLoad({ filter: /\.css$/ }, () => ({ contents: `export default new Proxy({},{get:(_,k)=>k})`, loader: 'js' }));
  } }] });
  Page = require(join(directory, 'page.cjs')).default;
});
after(async () => { delete globals.__categoryUI; await rm(directory, { recursive: true, force: true, maxRetries: 3 }); });
beforeEach(() => { state.categories = [category]; state.allowed = true; state.reads = []; });
async function document(query: Record<string, string> = {}) { return new JSDOM(renderToStaticMarkup(await Page({ searchParams: Promise.resolve(query) }))).window.document; }

test('category management defaults to compact table and hidden creation, not cards or codes', async () => {
  state.categories.push({ ...category, id: 'cat-2', name: 'Old rent', active: false, requiresReceipt: true, _count: { expenses: 24 } });
  const doc = await document();
  assert.equal(doc.querySelector('h1')?.textContent, 'Expense Categories');
  assert.match(doc.querySelector('[aria-label="Category summary"]')?.textContent ?? '', /2 categories · 1 active · 1 inactive/);
  assert.ok(!doc.querySelector('.categorySummaryGrid'));
  assert.deepEqual([...doc.querySelectorAll('thead th')].map(n => n.textContent), ['Category', 'Group', 'Receipt', 'Status', 'Action']);
  const body = doc.querySelector('tbody')!;
  assert.doesNotMatch(body.textContent ?? '', /RENTAL_INTERNAL|0 historical|Edit \+/);
  assert.match(body.textContent ?? '', /24 expenses/);
  assert.ok(body.querySelector('.inactiveBadge')); assert.ok(!body.querySelector('.activeBadge'));
  assert.ok(doc.querySelector('dialog')); assert.ok(!doc.querySelector('dialog[open]'));
  assert.ok(doc.querySelector('a[href="/expenses"]'));
});
test('category filters retain GET fields, internal-code search, group/status semantics and tenant query', async () => {
  const doc = await document({ q: 'RENTAL_INTERNAL', group: 'RENTAL', status: 'active' });
  const form = doc.querySelector('form[aria-label="Filter expense categories"]')!;
  assert.equal(form.getAttribute('method'), 'get');
  assert.deepEqual([...form.querySelectorAll('[name]')].map(n => n.getAttribute('name')), ['q', 'group', 'status']);
  assert.match(doc.querySelector('tbody')?.textContent ?? '', /Rental/);
  assert.deepEqual(state.reads[0], { where: { businessId: 'business' }, include: { _count: { select: { expenses: true } } }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  assert.ok([...doc.querySelectorAll('a')].some(a => a.textContent === 'Clear filters to reorder'));
});
test('true empty and filtered-empty offer different actions; unauthorised page fails closed', async () => {
  const filtered = await document({ q: 'missing' });
  assert.match(filtered.querySelector('.categoryEmpty')?.textContent ?? '', /No matching categories/);
  assert.ok(!filtered.querySelector('.categoryEmpty button'));
  state.categories = []; const empty = await document();
  assert.match(empty.querySelector('.categoryEmpty')?.textContent ?? '', /No expense categories yet/);
  assert.ok(empty.querySelector('.categoryEmpty button'));
  state.allowed = false; await assert.rejects(document(), /denied/);
});
test('Add/Edit dialogs preserve field payloads and cancel; reorder retains original order contract', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const old = ['window', 'document'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)] as const);
  Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true }); Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true });
  // jsdom lacks native dialog methods; only shim the browser primitive, not our handlers.
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    state.categories.push({ ...category, id: 'cat-2', name: 'Utilities', sortOrder: 20 });
    const element = await Page({ searchParams: Promise.resolve({}) }); act(() => root.render(element));
    const doc = dom.window.document;
    const button = (label: string) => [...doc.querySelectorAll('button')].find(b => b.textContent === label)!;
    assert.ok(button('+ Add Category')); act(() => button('+ Add Category').click());
    let dialog = doc.querySelector<HTMLDialogElement>('dialog[open]')!; assert.ok(dialog);
    let form = dialog.querySelector('form')!;
    let payload = new dom.window.FormData(form);
    assert.equal(payload.get('sortOrder'), '30'); assert.match(String(payload.get('operationKey')), /^CREATE_EXPENSE_CATEGORY:/);
    assert.ok(dialog.querySelector('details:not([open]) input[name="code"]'));
    assert.equal(form.querySelector<HTMLInputElement>('[name="name"]')?.required, true);
    act(() => dialog.querySelector<HTMLButtonElement>('button[data-cancel]')!.click()); assert.ok(!dialog.open);
    act(() => button('Edit').click()); dialog = doc.querySelector<HTMLDialogElement>('dialog[open]')!;
    form = dialog.querySelector('form')!; payload = new dom.window.FormData(form);
    assert.equal(payload.get('categoryId'), 'cat-1'); assert.equal(payload.get('code'), 'RENTAL_INTERNAL'); assert.equal(payload.get('active'), 'on');
    assert.equal(payload.get('sortOrder'), '10'); assert.equal(payload.get('description'), 'Monthly rent');
    act(() => dialog.querySelector<HTMLButtonElement>('button[data-cancel]')!.click());
    act(() => button('Reorder').click());
    const order = doc.querySelector<HTMLInputElement>('[name="order"]')!; assert.equal(order.value, '["cat-1","cat-2"]');
    act(() => doc.querySelector<HTMLButtonElement>('[aria-label="Move Rental down"]')!.click());
    assert.equal(order.value, '["cat-2","cat-1"]'); assert.equal(doc.querySelector<HTMLInputElement>('[name="expectedOrder"]')?.value, '["cat-1","cat-2"]');
    act(() => doc.querySelector<HTMLButtonElement>('section[aria-labelledby="reorder-categories-heading"] button')!.click()); assert.ok(doc.querySelector('table'));
  } finally { act(() => root.unmount()); dom.window.close(); for (const [k, v] of old) { if (v) Object.defineProperty(globalThis, k, v); else Reflect.deleteProperty(globalThis, k); } delete globals.IS_REACT_ACT_ENVIRONMENT; }
});
