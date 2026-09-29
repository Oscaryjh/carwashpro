import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

test("device GPS invokes the draft guard immediately without saving", async () => {
  const dir = await mkdtemp(join(process.cwd(), "node_modules/.cache/location-gps-"));
  let changes = 0;
  const harness = { index: 0, values: ["5.1", "116.1", false, "", null] as any[] };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { geolocation: { getCurrentPosition(callback: any) { callback({ coords: { latitude: 5.2, longitude: 116.2, accuracy: 108 } }); } } } });
  (globalThis as any).__gpsDraft = harness;
  try {
    await build({ entryPoints: ["src/components/attendance-location-fields.tsx"], outfile: join(dir, "component.cjs"), bundle: true, platform: "node", format: "cjs", packages: "external", logLevel: "silent", plugins: [{ name: "hooks", setup(b) {
      b.onResolve({ filter: /^react$|\.css$/ }, args => ({ path: args.path, namespace: "stub" }));
      b.onLoad({ filter: /.*/, namespace: "stub" }, args => ({ contents: args.path === "react" ? "export function useState(initial){const h=globalThis.__gpsDraft;const i=h.index++;if(!(i in h.values))h.values[i]=typeof initial==='function'?initial():initial;return [h.values[i],v=>h.values[i]=v]} export function useRef(initial){return {current:initial}} export function useEffect(){}" : "export default {}" }));
    } }] });
    const { AttendanceLocationFields } = createRequire(import.meta.url)(join(dir, "component.cjs"));
    const tree = AttendanceLocationFields({ branch: { name: "Synthetic outlet" }, initialValues: { latitude: "5.1", longitude: "116.1", geofenceRadiusMeters: 100, timezone: "Asia/Kuching", minimumAccuracyMeters: 80 }, onDirty: () => changes++ });
    function find(node: any): any {
      if (!node || typeof node !== "object") return undefined;
      if (node.type === "button" && node.props.children === "Use current device location") return node;
      return [node.props?.children].flat(Infinity).map(find).find(Boolean);
    }
    const confirm = find(tree);
    assert.ok(confirm);
    confirm.props.onClick();
    assert.equal(harness.values[0], "5.200000");
    assert.equal(harness.values[1], "116.200000");
    assert.equal(changes, 1);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor); else delete (globalThis as any).navigator;
    delete (globalThis as any).__gpsDraft; await rm(dir, { recursive: true, force: true });
  }
});
