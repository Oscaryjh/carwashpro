import assert from "node:assert/strict";
import test from "node:test";
import { calculateEarnedPoints } from "../../src/lib/loyalty/rules";

for (const [cents,rate,want] of [
  [10000,0.29,29],[10000,1.13,113],[5000,0.58,29],
  [9900,0.29,28],[2550,1,25],[2550,2,51],
  [0,0.29,0],[1,0.29,0],[1,100,1],[10000,0,0],
  [9999999999,100,9999999999],
] as const) test(`exact EARN: cents=${cents}, rate=${rate} => ${want}`, () => {
  assert.equal(calculateEarnedPoints(cents,rate),want);
});
test("stored decimal strings remain exact without a Number round trip", () => {
  assert.equal(calculateEarnedPoints(10000,"0.29"),29);
  assert.equal(calculateEarnedPoints(10000,"1.13"),113);
  assert.equal(calculateEarnedPoints(5000,"0.58"),29);
  assert.equal(calculateEarnedPoints(9900,"0.29"),28);
  assert.equal(calculateEarnedPoints(10000,"0.2900"),29);
});
test("safe large integer boundary and scientific Number compatibility", () => {
  assert.equal(calculateEarnedPoints(Number.MAX_SAFE_INTEGER,"100"),Number.MAX_SAFE_INTEGER);
  assert.equal(calculateEarnedPoints(1000000000,1e-7),1);
  assert.equal(calculateEarnedPoints(1,1e3),10);
  assert.equal(calculateEarnedPoints(1,5e-324),0);
});
test("invalid cents, rates and unsafe output fail closed", () => {
  for (const cents of [-1,1.1,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]) assert.throws(()=>calculateEarnedPoints(cents,"0.29"));
  for (const rate of [-1,NaN,Infinity,"-0.01","","bad","1e9999"]) assert.throws(()=>calculateEarnedPoints(100,rate));
  assert.throws(()=>calculateEarnedPoints(Number.MAX_SAFE_INTEGER,"101"));
});
