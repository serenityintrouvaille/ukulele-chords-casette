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
test("chordTones: C major = C E G", () => {
  assert.deepEqual(UkeEngine.chordTones(UkeEngine.parseChord("C")).sort((a,b)=>a-b), [0,4,7]);
});
test("chordTones: Am7 = A C E G", () => {
  assert.deepEqual(UkeEngine.chordTones(UkeEngine.parseChord("Am7")).sort((a,b)=>a-b), [0,4,7,9]);
});
test("chordTones: Cmaj7 = C E G B", () => {
  assert.deepEqual(UkeEngine.chordTones(UkeEngine.parseChord("Cmaj7")).sort((a,b)=>a-b), [0,4,7,11]);
});
test("chordTones: G7 = G B D F", () => {
  assert.deepEqual(UkeEngine.chordTones(UkeEngine.parseChord("G7")).sort((a,b)=>a-b), [2,5,7,11]);
});
test("essentialTones: 7화음은 루트·3도·7도", () => {
  const p = UkeEngine.parseChord("G7");
  assert.deepEqual(UkeEngine.essentialTones(p).sort((a,b)=>a-b), [5,7,11]); // G, B, F
});
test("essentialTones: 메이저는 장3도 (C)", () => {
  assert.deepEqual(UkeEngine.essentialTones(UkeEngine.parseChord("C")).sort((a,b)=>a-b), [0,4]);
});
test("essentialTones: maj7은 장3도 + 장7도 (Cmaj7)", () => {
  assert.deepEqual(UkeEngine.essentialTones(UkeEngine.parseChord("Cmaj7")).sort((a,b)=>a-b), [0,4,11]);
});
test("essentialTones: 마이너는 단3도 (Am)", () => {
  assert.deepEqual(UkeEngine.essentialTones(UkeEngine.parseChord("Am")).sort((a,b)=>a-b), [0,9]); // A=9, C=0
});
test("essentialTones: m7b5는 단3도 (Bm7b5)", () => {
  // B=11, D=2(단3도), A=9(단7도)
  assert.deepEqual(UkeEngine.essentialTones(UkeEngine.parseChord("Bm7b5")).sort((a,b)=>a-b), [2,9,11]);
});

const OPEN = [7,0,4,9]; // GCEA
function playedPcs(frets) {
  const out = [];
  frets.forEach((f,i)=>{ if (f>=0) out.push((OPEN[i]+f)%12); });
  return [...new Set(out)];
}
test("voicing: 결과 음이 구성음의 부분집합 + 핵심음 포함 (Dmaj7)", () => {
  const p = UkeEngine.parseChord("Dmaj7");
  const v = UkeEngine.voicing("Dmaj7");
  const tones = new Set(UkeEngine.chordTones(p));
  assert.equal(v.frets.length, 4);
  for (const pc of playedPcs(v.frets)) assert.ok(tones.has(pc), `${pc} not a chord tone`);
  for (const ess of UkeEngine.essentialTones(p)) assert.ok(playedPcs(v.frets).includes(ess), `essential ${ess} missing`);
});
test("voicing: frets는 -1..12 정수 4개", () => {
  const v = UkeEngine.voicing("F#m7b5");
  assert.equal(v.frets.length, 4);
  for (const f of v.frets) assert.ok(Number.isInteger(f) && f >= -1 && f <= 12);
});
test("voicing: difficulty 등급 존재", () => {
  assert.ok(["easy","mid","hard"].includes(UkeEngine.voicing("C").difficulty));
});
test("override: 관습적 표준형 정확", () => {
  assert.deepEqual(UkeEngine.voicing("C").frets,  [0,0,0,3]);
  assert.deepEqual(UkeEngine.voicing("Am").frets, [2,0,0,0]);
  assert.deepEqual(UkeEngine.voicing("F").frets,  [2,0,1,0]);
  assert.deepEqual(UkeEngine.voicing("G").frets,  [0,2,3,2]);
  assert.deepEqual(UkeEngine.voicing("D").frets,  [2,2,2,0]);
  assert.deepEqual(UkeEngine.voicing("Em").frets, [0,4,3,2]);
});
test("diatonicChords: C key", () => {
  assert.deepEqual(UkeEngine.diatonicChords("C"), ["C","Dm","Em","F","G","Am","Bdim"]);
});
