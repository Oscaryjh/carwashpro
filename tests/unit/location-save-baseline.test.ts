import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

test("save provider advances the baseline only for the successfully submitted values", async () => {
  const dir = await mkdtemp(join(process.cwd(), "node_modules/.cache/location-save-"));
  const hooks = { index: 0, values: [] as any[], action: undefined as any };
  (globalThis as any).__locationSave = hooks;
  try {
    await build({ entryPoints: ["src/components/company-clock-in-location.tsx"], outfile: join(dir, "component.cjs"), bundle: true, platform: "node", format: "cjs", packages: "external", logLevel: "silent", plugins: [{ name: "react-boundary", setup(b) {
      b.onResolve({ filter: /^react$|\.css$/ }, args => ({ path: args.path, namespace: "boundary" }));
      b.onLoad({ filter: /.*/, namespace: "boundary" }, args => ({ contents: args.path === "react" ? `
        export function useState(initial){const h=globalThis.__locationSave;const i=h.index++;if(!(i in h.values))h.values[i]=typeof initial==='function'?initial():initial;return [h.values[i],v=>h.values[i]=typeof v==='function'?v(h.values[i]):v]}
        export function useRef(initial){const [ref]=useState(()=>({current:initial}));return ref}
        export function useCallback(fn){return fn}
        export function useEffect(){}
        export function createContext(value){return {value,Provider:'provider'}}
        export function useContext(context){return context.value}
        export function useActionState(action,initial){globalThis.__locationSave.action=action;return [initial,action,false]}
      ` : "export default {}" }));
    } }] });
    const { CompanyLocationSaveProvider } = createRequire(import.meta.url)(join(dir, "component.cjs"));
    let result = { status: "error", message: "Save failed" };
    let received: FormData | undefined;
    const render = () => { hooks.index = 0; return CompanyLocationSaveProvider({ children: null, action: async (_: any, form: FormData) => { received = form; return result; } }); };
    const form = new FormData();
    for (const [key, value] of Object.entries({ latitude: "0", longitude: "0", geofenceRadiusMeters: "100", minimumAccuracyMeters: "80", timezone: "Asia/Kuching" })) form.set(key, value);
    render();
    await hooks.action({ status: "idle", message: "" }, form);
    assert.equal(render().props.value.savedValues, undefined);
    assert.equal(received, form, "original action receives the original form contract");
    form.set("minimumAccuracyMeters", "90");
    result = { status: "success", message: "Saved" };
    const saving = hooks.action({ status: "idle", message: "" }, form);
    form.set("latitude", "5");
    await saving;
    assert.equal(received?.get("minimumAccuracyMeters"), "90", "advanced GPS value reaches the original save action");
    assert.deepEqual(render().props.value.savedValues, { latitude: "0", longitude: "0", geofenceRadiusMeters: "100", minimumAccuracyMeters: "90", timezone: "Asia/Kuching" });
    result = { status: "error", message: "Save failed" };
    await hooks.action({ status: "success", message: "Saved" }, form);
    assert.equal(render().props.value.savedValues.latitude, "0", "a failed subsequent save cannot advance the baseline");
  } finally {
    delete (globalThis as any).__locationSave;
    await rm(dir, { recursive: true, force: true });
  }
});
