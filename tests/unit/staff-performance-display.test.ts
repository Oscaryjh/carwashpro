import assert from "node:assert/strict";
import test from "node:test";
import { formatPerformanceMoney, formatRefund, monthlyChartGeometry, shortPeriod } from "../../src/components/staff-pwa/staff-performance-display";
test("Money preserves cents, negative contributions and zero refunds without a negative zero",()=>{
  assert.equal(formatPerformanceMoney(4995000),"RM49,950.00");assert.equal(formatPerformanceMoney(-501),"−RM5.01");
  assert.equal(formatRefund(0),"RM0.00");assert.equal(formatRefund(-0),"RM0.00");assert.equal(formatRefund(501),"−RM5.01");
});
test("Monthly bars share the actual scale; unknown/future are not fabricated zero and tiny values are not inflated",()=>{
  const rows=[4900000,95000,0,-500].map((total,i)=>({month:i+1,future:false,complete:true,amount:{total}}));
  const g=monthlyChartGeometry([...rows,{month:5,future:true,complete:true,amount:{total:0}},{month:6,future:false,complete:false,amount:{total:90000000}}]);
  const [large,small,zero,negative,future,pending]=g.points;
  assert.ok(Math.abs(large.height/small.height-4900000/95000)<1e-8);assert.equal(zero.height,0);
  assert.equal(negative.y,g.zero);assert.ok(negative.height>0);assert.equal(future.value,null);assert.equal(future.status,"future");
  assert.equal(pending.value,null);assert.equal(pending.status,"pending");assert.equal(g.max,4900000);
});
test("Empty, all-zero and all-negative charts remain finite",()=>{
  for(const amounts of [[],[0,0],[-5,-100]]){
    const g=monthlyChartGeometry(amounts.map((total,i)=>({month:i+1,future:false,complete:true,amount:{total}})));
    assert.ok(Number.isFinite(g.zero));for(const p of g.points){assert.ok(Number.isFinite(p.y));assert.ok(Number.isFinite(p.height));}
  }
});
test("Compact comparison ranges keep operating dates at UTC and year boundaries",()=>{
  assert.equal(shortPeriod("2026-07-31T16:00:00Z","2026-08-05T14:20:37Z","Asia/Kuching"),"Aug 1–5");
  assert.equal(shortPeriod("2026-07-31T16:00:00Z","2026-08-31T15:59:59Z","Asia/Kuching"),"Aug 1–31");
  assert.equal(shortPeriod("2025-12-31T15:59:59Z","2025-12-31T16:00:01Z","Asia/Kuching"),"Dec 31, 2025 – Jan 1, 2026");
});
