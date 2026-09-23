import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { middleware } from "../../src/middleware";
test("disabled Staff detail returns private 404 before streaming; enabled route leaves genuine Staff authentication to page",async()=>{
  const previous=process.env.TETAMU_STAFF_PERFORMANCE;
  try{
    process.env.TETAMU_STAFF_PERFORMANCE="false";
    const off=await middleware(new NextRequest("http://localhost:3104/staff/performance"));assert.equal(off.status,404);assert.match(off.headers.get("cache-control")!,/private.*no-store/);
    process.env.TETAMU_STAFF_PERFORMANCE="true";
    const on=await middleware(new NextRequest("http://localhost:3104/staff/performance"));assert.equal(on.headers.get("x-middleware-next"),"1");
    const backend=await middleware(new NextRequest("http://localhost:3104/team/performance"));assert.equal(backend.status,307);assert.ok(backend.headers.get("location")!.endsWith("/login"));
  }finally{if(previous===undefined)delete process.env.TETAMU_STAFF_PERFORMANCE;else process.env.TETAMU_STAFF_PERFORMANCE=previous;}
});
