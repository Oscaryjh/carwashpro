"use client";
export default function ErrorPage({reset}:{reset:()=>void}){return <section role="alert" style={{padding:24}}><h2>业绩数据读取失败</h2><p>未完成来源核查，不能将本次读取视为零业绩或已达标。请重试，或联系管理员检查权限与迁移状态。</p><button onClick={reset}>重新读取</button></section>;}
