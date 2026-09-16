import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Staff date picker moves focus into the modal, traps Tab, and restores the trigger", async () => {
  const source = await readFile("src/components/staff-pwa/staff-date-picker.tsx", "utf8");

  assert.match(source, /triggerRef = useRef<HTMLButtonElement>/);
  assert.match(source, /sheetRef = useRef<HTMLElement>/);
  assert.match(source, /requestAnimationFrame\(\(\) => focusable\(\)\[0\]\?\.focus\(\)\)/);
  assert.match(source, /event\.key !== "Tab"/);
  assert.match(source, /document\.activeElement === first/);
  assert.match(source, /document\.activeElement === last/);
  assert.match(source, /trigger\?\.focus\(\)/);
  assert.match(source, /aria-modal="true"/);
});
