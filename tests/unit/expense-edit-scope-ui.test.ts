import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ExpenseEditScopeField } from "../../src/components/expense-edit-scope-field";
const branch={id:"A",name:"Current"};
test("single edit preserves Business-wide selection rather than selecting current outlet",()=>{
  const html=renderToStaticMarkup(createElement(ExpenseEditScopeField,{mode:"single_outlet",branches:[branch],branchId:null,includeBusinessWide:true}));
  assert.match(html,/Expense scope/);assert.match(html,/<option value="" selected="">Business-wide/);assert.doesNotMatch(html,/>Branch</);
});
test("single current edit retains its branch and staff never receives Business-wide choice",()=>{
  const html=renderToStaticMarkup(createElement(ExpenseEditScopeField,{mode:"single_outlet",branches:[branch],branchId:"A",includeBusinessWide:false}));
  assert.match(html,/<option value="A" selected="">This outlet/);assert.doesNotMatch(html,/Business-wide/);
});
test("zero or historical attribution is read-only and does not submit a replacement branch",()=>{
  const html=renderToStaticMarkup(createElement(ExpenseEditScopeField,{mode:"no_location",branches:[],branchId:"B",branchName:"Historical",includeBusinessWide:true}));
  assert.match(html,/Historical/);assert.doesNotMatch(html,/name="branchId"/);
});
test("legacy editing keeps the existing Branch and Business-wide choices",()=>{
  const html=renderToStaticMarkup(createElement(ExpenseEditScopeField,{mode:"legacy_multi_branch",branches:[branch,{id:"B",name:"Second"}],branchId:"B",includeBusinessWide:true}));
  assert.match(html,/>Branch</);assert.match(html,/<option value="B" selected="">Second/);assert.match(html,/Business-wide/);
});
