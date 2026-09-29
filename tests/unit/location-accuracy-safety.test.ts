import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

// A GPS accuracy gate, invalid fix or stale callback must fail these tests.
// Only React hook storage and the browser GPS boundary are replaced; handlers are real.
test("GPS setup fills drafts independently of staff accuracy and preserves manual edits", async (t) => {
  const dir = await mkdtemp(join(process.cwd(), "node_modules/.cache/location-accuracy-"));
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const callbacks: Array<{ success: (position: any) => void; error: (error: any) => void }> = [];
  const hooks = { index: 0, values: [] as any[], effects: [] as Array<() => void> };
  (globalThis as any).__locationSafetyHooks = hooks;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { geolocation: {
    getCurrentPosition(success: any, error: any) { callbacks.push({ success, error }); },
  } } });
  try {
    await build({ entryPoints: ["src/components/attendance-location-fields.tsx"], outfile: join(dir, "component.cjs"), bundle: true, platform: "node", format: "cjs", packages: "external", logLevel: "silent", plugins: [{ name: "browser-hooks", setup(b) {
      b.onResolve({ filter: /^react$|\.css$/ }, args => ({ path: args.path, namespace: "boundary" }));
      b.onLoad({ filter: /.*/, namespace: "boundary" }, args => ({ contents: args.path === "react" ? `
        export function useState(initial){const h=globalThis.__locationSafetyHooks;const i=h.index++;if(!(i in h.values))h.values[i]=typeof initial==='function'?initial():initial;return [h.values[i],v=>h.values[i]=typeof v==='function'?v(h.values[i]):v]}
        export function useRef(initial){const [ref]=useState(()=>({current:initial}));return ref}
        export function useEffect(fn,deps){const [state]=useState(()=>({deps:undefined}));if(!state.deps||deps.some((v,i)=>!Object.is(v,state.deps[i]))){state.deps=deps;globalThis.__locationSafetyHooks.effects.push(fn)}}
      ` : "export default {}" }));
    } }] });
    const { AttendanceLocationFields } = createRequire(import.meta.url)(join(dir, "component.cjs"));
    let dirty = 0;
    let pending = false;
    let ready = false;
    let draftState: any;
    let savedValues: any;
    const onDraftChange = (value: any) => { draftState = value; };
    const onReadyChange = (value: boolean) => { ready = value; };
    const initialValues = { latitude: "", longitude: "", minimumAccuracyMeters: 80, geofenceRadiusMeters: 100, timezone: "Asia/Kuching" };
    const render = () => { hooks.index = 0; const tree = AttendanceLocationFields({ branch: { id: "synthetic", name: "Legacy internal name" }, businessName: "Synthetic outlet", initialValues, savedValues, pending, compact: true, onDirty: () => dirty++, onReadyChange, onDraftChange }); hooks.effects.splice(0).forEach(fn => fn()); return tree; };
    function nodes(node: any): any[] { return !node || typeof node !== "object" ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)]; }
    const text = (node: any): string => typeof node === "string" || typeof node === "number" ? String(node) : !node || typeof node !== "object" ? "" : [node.props?.children].flat(Infinity).map(text).join(" ");
    const button = (tree: any, pattern: RegExp) => nodes(tree).find(n => n.type === "button" && pattern.test(text(n)));
    const field = (tree: any, name: string) => nodes(tree).find(n => n.type === "input" && n.props.name === name);
    const reset = () => { hooks.values = []; callbacks.length = 0; dirty = 0; pending = false; savedValues = undefined; draftState = undefined; };
    const locate = (accuracy: number) => {
      button(render(), /Use current device location/).props.onClick();
      callbacks.at(-1)!.success({ coords: { latitude: 5.2, longitude: 116.2, accuracy } });
      return render();
    };
    await t.test("five fields compare with successful saved baseline and revert cleanly", () => {
      reset(); render();
      assert.equal(draftState?.status, "Not configured");
      locate(20);
      assert.equal(draftState.status, "Unsaved location");
      assert.equal(draftState.canSave, true);
      // No successful receipt (including an error response) leaves the draft unsaved.
      render(); assert.equal(draftState.status, "Unsaved location");
      savedValues = { latitude: "5.200000", longitude: "116.200000", geofenceRadiusMeters: "100", minimumAccuracyMeters: "80", timezone: "Asia/Kuching" };
      render(); assert.equal(draftState.status, "Configured");
      assert.equal(draftState.canSave, false);
      for (const [name, value] of [["latitude", "5.3"], ["longitude", "116.3"], ["geofenceRadiusMeters", "120"], ["minimumAccuracyMeters", "90"], ["timezone", "Asia/Kuala_Lumpur"]]) {
        const control = () => nodes(render()).find(n => n.props?.name === name);
        control().props.onChange({ target: { value } }); render();
        assert.equal(draftState.status, "Unsaved location", name);
        assert.equal(draftState.canSave, true);
        control().props.onChange({ target: { value: savedValues[name] } }); render();
        assert.equal(draftState.status, "Configured", name);
      }
      field(render(), "latitude").props.onChange({ target: { value: "" } }); render();
      assert.equal(draftState.status, "Unsaved location");
      assert.equal(draftState.canSave, false);
      assert.doesNotMatch(text(render()), /Device location accuracy/);
    });
    await t.test("an unconfigured outlet still marks changed rules as unsaved", () => {
      reset(); render();
      field(render(), "geofenceRadiusMeters").props.onChange({ target: { value: "120" } });
      render(); assert.equal(draftState.status, "Unsaved location");
      assert.equal(draftState.canSave, false, "missing coordinates still prevent save");
      field(render(), "geofenceRadiusMeters").props.onChange({ target: { value: "100" } });
      render(); assert.equal(draftState.status, "Not configured");
    });
    for (const accuracy of [20, 80, 108, 200000]) await t.test(`accuracy ${accuracy} fills draft without blocking save readiness`, () => {
      reset();
      const tree = locate(accuracy);
      assert.equal(field(tree, "latitude").props.value, "5.200000");
      assert.equal(field(tree, "longitude").props.value, "116.200000");
      assert.equal(dirty, 1);
      assert.equal(ready, true);
      assert.equal(draftState.canSave, true);
      assert.equal(draftState.status, "Unsaved location");
      assert.equal(nodes(tree).some(n => n.type === "dialog" || n.props?.type === "submit"), false);
      assert.ok(nodes(tree).some(n => n.type === "iframe" && n.props.src.includes("q=5.2,116.2")));
      if (accuracy === 20) assert.match(text(tree), /Device location accuracy: ~ 20 m/);
      if (accuracy === 108) assert.match(text(tree), /Approximate device location/);
      if (accuracy === 200000) {
        assert.match(text(tree), /Low-confidence device location/);
        assert.match(text(tree), /200 km/);
      }
    });
    await t.test("staff maximum error does not gate setup", () => {
      reset();
      field(render(), "minimumAccuracyMeters").props.onChange({ target: { value: "10" } });
      assert.equal(field(locate(108), "latitude").props.value, "5.200000");
      assert.equal(field(render(), "minimumAccuracyMeters").props.value, "10");
    });
    await t.test("failed GPS offers retry while manual input remains usable", () => {
      reset();
      button(render(), /Use current device location/).props.onClick();
      callbacks[0].error({ code: 1, PERMISSION_DENIED: 1, TIMEOUT: 3 });
      assert.match(text(render()), /Unable to get your device location/);
      assert.ok(button(render(), /Try again/));
      field(render(), "latitude").props.onChange({ target: { value: "0" } });
      field(render(), "longitude").props.onChange({ target: { value: "0" } });
      render(); assert.equal(draftState.canSave, true);
    });
    await t.test("manual coordinates clear the previous device accuracy", () => {
      reset(); locate(200000);
      field(render(), "longitude").props.onChange({ target: { value: "116.3" } });
      assert.doesNotMatch(text(render()), /Device location accuracy|Low-confidence/);
      assert.equal(draftState.canSave, true);
    });
    await t.test("manual editing invalidates pending GPS and updates preview including zero", () => {
      reset();
      button(render(), /Use current device location/).props.onClick();
      field(render(), "latitude").props.onChange({ target: { value: "0" } });
      field(render(), "longitude").props.onChange({ target: { value: "0" } });
      callbacks[0].success({ coords: { latitude: 9, longitude: 9, accuracy: 1 } });
      const tree = render();
      assert.equal(field(tree, "latitude").props.value, "0");
      assert.ok(nodes(tree).some(n => n.type === "iframe" && n.props.src.includes("q=0,0")));
      for (const value of ["", "91", "NaN"]) {
        field(render(), "latitude").props.onChange({ target: { value } });
        assert.equal(nodes(render()).some(n => n.type === "iframe"), false);
      }
    });
    await t.test("retry ignores stale callbacks", () => {
      reset();
      locate(20);
      button(render(), /Use current device location/).props.onClick();
      callbacks[0].success({ coords: { latitude: 9, longitude: 9, accuracy: 1 } });
      assert.equal(field(render(), "latitude").props.value, "5.200000");
      callbacks[1].success({ coords: { latitude: 5.3, longitude: 116.3, accuracy: 108 } });
      assert.equal(field(render(), "latitude").props.value, "5.300000");
    });
    await t.test("GPS callback cannot change coordinates during a pending save", () => {
      reset();
      locate(20);
      button(render(), /Use current device location/).props.onClick();
      pending = true;
      render();
      assert.equal(draftState.canSave, false);
      callbacks[1].success({ coords: { latitude: 9, longitude: 9, accuracy: 20 } });
      assert.equal(field(render(), "latitude").props.value, "5.200000");
      assert.equal(dirty, 1);
      pending = false;
      render();
      callbacks[1].success({ coords: { latitude: 9, longitude: 9, accuracy: 20 } });
      assert.equal(field(render(), "latitude").props.value, "5.200000");
    });
    for (const [latitude, longitude] of [[NaN, 116], [91, 116], [5, 181], [Infinity, 116]]) await t.test(`invalid device coordinates ${latitude},${longitude} rejected`, () => {
      reset();
      button(render(), /Use current device location/).props.onClick();
      callbacks[0].success({ coords: { latitude, longitude, accuracy: 20 } });
      assert.equal(field(render(), "latitude").props.value, "");
      assert.equal(dirty, 0);
    });
  } finally {
    if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor); else delete (globalThis as any).navigator;
    delete (globalThis as any).__locationSafetyHooks;
    await rm(dir, { recursive: true, force: true });
  }
});
