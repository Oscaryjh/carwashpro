"use client";
export default function ErrorPage({reset}:{reset:()=>void}){return <section role="alert" style={{padding:24}}><h2>Unable to load performance</h2><p>Source verification is incomplete. This does not mean performance is zero or a target has been reached. Please try again or contact your administrator.</p><button onClick={reset}>Try again</button></section>;}
