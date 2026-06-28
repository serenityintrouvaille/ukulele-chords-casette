import { test } from "node:test";
import assert from "node:assert/strict";
import UkeEngine from "./chord-engine.js";

test("parseChord: 기본 메이저", () => {
  assert.deepEqual(UkeEngine.parseChord("C"), { root: 0, quality: "maj", bass: null, raw: "C" });
});
test("parseChord: 마이너 세븐", () => {
  const p = UkeEngine.parseChord("Am7");
  assert.equal(p.root, 9); assert.equal(p.quality, "m7");
});
test("parseChord: 플랫 루트와 온코드", () => {
  const p = UkeEngine.parseChord("Bb/D");
  assert.equal(p.root, 10); assert.equal(p.quality, "maj"); assert.equal(p.bass, 2);
});
test("parseChord: 샤프 루트 m7b5", () => {
  const p = UkeEngine.parseChord("F#m7b5");
  assert.equal(p.root, 6); assert.equal(p.quality, "m7b5");
});
