import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

test('edit page renders five saved summary facts and retains separate save/delete form targets', async () => {
  const result = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import Page from './src/app/(business)/packages/[packageId]/page';
    Page({params:Promise.resolve({packageId:'p'})}).then(page=>createRoot(document.getElementById('root')).render(page));`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, platform: 'browser', jsx: 'automatic', plugins: [{ name: 'read-only-fixture', setup(b) {
      b.onResolve({ filter: /^(next\/navigation|@\/lib\/(auth\/business-user|auth\/staff-permissions|branches|prisma))$|^(\.\.\/actions|@\/app\/\(business\)\/packages\/actions)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
        export const notFound=()=>{throw Error('not found')};export const useRouter=()=>({back(){},push(){}});
        export const requireBusinessUserForModule=async()=>({user:{},businessId:'business',industryType:'SALON_BEAUTY'});
        export const assertStaffPermission=()=>{};export const getActiveBranches=async()=>[{id:'b',name:'Local'}];
        export const updatePackageAction=async()=>{throw Error('No submit')};export const deletePackageAction=async()=>{throw Error('No delete')};
        export const prisma={package:{findFirst:async()=>({id:'p',name:'Saved',price:'280.00',totalUses:4,status:'ACTIVE',description:'',branchId:'b',categoryId:'c',packageCategory:{name:'Facial'},serviceBenefits:[{serviceId:'s',totalUses:4,service:{name:'Facial'}}],_count:{customerPackages:3}})},service:{findMany:async()=>[{id:'s',name:'Facial',price:'100.00',category:'Facial'}]},packageCategory:{findMany:async()=>[{id:'c',name:'Facial',status:'ACTIVE'}]}};` }));
    } }] });
  const { JSDOM } = createRequire(import.meta.url)('jsdom');
  const dom = new JSDOM(`<div id="root"></div><script>${result.outputFiles[0].text}</script>`, { runScripts: 'dangerously', url: 'http://fixture.test' });
  try {
    const doc = dom.window.document;
    for (let i = 0; i < 100 && !doc.querySelector('textarea'); i++) await new Promise(r => setTimeout(r, 20));
    assert.deepEqual([...doc.querySelectorAll('.package-edit-summary .metric > span')].map((n: any) => n.textContent), ['Category', 'Status', 'Package price', 'Total Uses', 'Sold']);
    assert.deepEqual([...doc.querySelectorAll('.package-edit-summary .metric > strong')].map((n: any) => n.textContent.replace(/\u00a0/g, ' ')), ['Facial', 'ACTIVE', 'RM 280.00', '4', '3']);
    const footer = doc.querySelector('.package-edit-actions');
    assert.equal(footer.firstElementChild.tagName, 'FORM');
    assert.equal(footer.querySelector('.danger-button').textContent, 'Delete package');
    assert.equal(footer.querySelector('button[form]').textContent, 'Save changes');
    assert.equal(footer.querySelector('button[form]').form.id, 'package-form-p');
    assert.equal(footer.querySelector('[name="packageId"]').value, 'p');
    assert.equal(doc.querySelectorAll('form').length, 2);
  } finally { dom.window.close(); }
});
