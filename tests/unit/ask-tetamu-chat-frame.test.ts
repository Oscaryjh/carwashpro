import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { act, createElement } from "react";
const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");

test("panel toggles, closes on conversation navigation/Escape, and fits below context toolbar", async () => {
  const bundle = await build({entryPoints:["src/components/ask-tetamu-chat-frame.tsx"],bundle:true,write:false,platform:"node",format:"cjs",packages:"external",jsx:"automatic",plugins:[{name:"css",setup(b){b.onLoad({filter:/\.css$/},()=>({contents:"export default {};",loader:"js"}));}}]});
  const compiled = {exports:{} as {AskTetamuChatFrame: React.ComponentType<{sidebar:React.ReactNode;header:React.ReactNode;children?:React.ReactNode}>}};
  new Function("require","module","exports",bundle.outputFiles[0].text)(require,compiled,compiled.exports);
  const dom = new JSDOM('<main><div id="root"></div></main>',{url:"http://localhost/ai"});
  const saved = Object.getOwnPropertyDescriptors(globalThis);
  const values={window:dom.window,document:dom.window.document,navigator:dom.window.navigator,IS_REACT_ACT_ENVIRONMENT:true,ResizeObserver:class{observe(){} disconnect(){}}};
  for(const [key,value] of Object.entries(values)) Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  dom.window.HTMLElement.prototype.getBoundingClientRect=()=>({top:80} as DOMRect);
  const {createRoot}=await import("react-dom/client");
  const root=createRoot(dom.window.document.getElementById("root")!);
  try {
    await act(async()=>root.render(createElement(compiled.exports.AskTetamuChatFrame,{sidebar:createElement("a",{href:"#chat"},"Saved chat"),header:createElement("h1",null,"Ask Tetamu")},createElement("p",null,"Messages"))));
    const button=dom.window.document.querySelector("button")!;
    const section=dom.window.document.querySelector("section")!;
    assert.equal(section.style.height,`${dom.window.innerHeight-96}px`);
    assert.equal(button.getAttribute("aria-expanded"),"false");
    await act(async()=>button.click());
    assert.equal(button.getAttribute("aria-expanded"),"true");
    await act(async()=>dom.window.document.querySelector("a")!.click());
    assert.equal(button.getAttribute("aria-expanded"),"false");
    await act(async()=>button.click());
    await act(async()=>button.dispatchEvent(new dom.window.KeyboardEvent("keydown",{key:"Escape",bubbles:true})));
    assert.equal(button.getAttribute("aria-expanded"),"false");
    assert.equal(dom.window.document.activeElement === button,true);
  } finally {
    await act(async()=>root.unmount());dom.window.close();
    for(const key of Object.keys(values)){if(saved[key])Object.defineProperty(globalThis,key,saved[key]);else Reflect.deleteProperty(globalThis,key);}
  }
});
