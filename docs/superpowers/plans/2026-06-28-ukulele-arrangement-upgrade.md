# 우쿨렐레 코드 편성 고도화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 단순 코드 찾기 앱을 "결정론적 우쿨렐레 운지 엔진 + 자료 없는 곡 직접 편곡 + 구간별 스트로크 + 레트로 스피커/카세트 라이브러리 UX"로 고도화한다.

**Architecture:** 순수 정적(서버 0원). AI는 코드 *이름*·가사 배치·스트로크만 생성하고, **운지는 클라이언트의 `chord-engine.js`가 음악이론으로 결정론 계산**한다. 앨범 표지·아티스트 데이터는 브라우저에서 iTunes Search API 직접 호출. 저장은 localStorage.

**Tech Stack:** Vanilla JS(ESM/IIFE 겸용), SVG 다이어그램, Anthropic Messages API(브라우저 직접 호출), iTunes Search API, Node 24 내장 `node:test`(엔진 단위 테스트, API 불필요).

**참고 스펙:** `docs/superpowers/specs/2026-06-28-ukulele-arrangement-upgrade-design.md`

---

## File Structure

| 파일 | 책임 | 상태 |
|---|---|---|
| `chord-engine.js` | 코드명→구성음→GCEA 최적 운지(결정론). 파서·구성음·보이싱 탐색·오버라이드·다이어토닉 | **신규** |
| `test-engine.mjs` | `chord-engine.js` 단위 테스트(오프라인, `node:test`) | **신규** |
| `itunes.js` | iTunes Search API 래퍼(앨범 표지·아티스트 메타) + localStorage 캐시 | **신규** |
| `chords.js` | SVG 렌더러. 운지 출처를 `chord-engine.js`로 위임, 손가락 번호 표시 | 수정 |
| `app.js` | 생성 프롬프트/스키마 개편(frets 제거·strum·intro·arranged), 검색/스크랩북/프로필, 엔진·iTunes 연동 | 수정 |
| `test.mjs` | 통합 스크립트 프롬프트를 새 스키마에 맞춤 | 수정 |
| `index.html` | 새 화면(프로필) 마크업, 스크립트 로드 순서 | 수정 |
| `style.css` | 레트로 스피커/카세트 리디자인 | 수정(Design) |

**스크립트 로드 순서(index.html):** `chord-engine.js` → `itunes.js` → `chords.js` → `app.js`.

**엔진 모듈 겸용 패턴:** 파일 끝에
```js
if (typeof window !== "undefined") window.UkeEngine = UkeEngine;
if (typeof module !== "undefined" && module.exports) module.exports = UkeEngine;
```
package.json이 없어 `.js`는 Node에서 CJS로 취급 → `test-engine.mjs`에서 `import UkeEngine from "./chord-engine.js"`로 기본 import 가능. 브라우저에선 `module`이 없어 가드가 막아 `window.UkeEngine`만 설정된다.

---

## Phase A — 결정론적 운지 엔진 (핵심)

### Task A1: 엔진 스캐폴드 + 음이름 파서

**Files:**
- Create: `chord-engine.js`
- Create: `test-engine.mjs`

- [ ] **Step 1: Write the failing test**

`test-engine.mjs`:
```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test-engine.mjs`
Expected: FAIL — `Cannot find module './chord-engine.js'` 또는 `parseChord is not a function`.

- [ ] **Step 3: Write minimal implementation**

`chord-engine.js`:
```js
/* 결정론적 우쿨렐레 운지 엔진 — 코드명 → GCEA 최적 운지.
 * 네트워크/AI 의존 없음. 음악이론으로 계산한다. */
const UkeEngine = (function () {
  // 음이름 → 피치클래스(C=0)
  const NOTE_PC = { C:0, "C#":1, Db:1, D:2, "D#":3, Eb:3, E:4, F:5, "F#":6, Gb:6,
    G:7, "G#":8, Ab:8, A:9, "A#":10, Bb:10, B:11, "Cb":11, "E#":5, "B#":0 };

  // 품질 문자열 정규화: 입력 꼬리표 → 표준 quality 키
  function normQuality(s) {
    const t = (s || "").trim();
    if (t === "" || t === "maj") return "maj";
    const map = {
      "m": "m", "min": "m", "-": "m",
      "7": "7", "maj7": "maj7", "M7": "maj7", "Δ7": "maj7", "Δ": "maj7",
      "m7": "m7", "min7": "m7", "-7": "m7",
      "dim": "dim", "°": "dim", "dim7": "dim7", "°7": "dim7",
      "m7b5": "m7b5", "ø": "m7b5", "ø7": "m7b5",
      "aug": "aug", "+": "aug",
      "sus2": "sus2", "sus4": "sus4", "sus": "sus4",
      "6": "6", "m6": "m6", "min6": "m6",
      "add9": "add9", "9": "9", "m9": "m9", "maj9": "maj9", "M9": "maj9",
    };
    return map[t] || "maj"; // 미지원 꼬리표는 메이저로 안전 폴백
  }

  function parseChord(name) {
    const raw = (name || "").trim();
    let bass = null;
    let main = raw;
    const slash = raw.indexOf("/");
    if (slash !== -1) {
      const b = raw.slice(slash + 1).trim();
      const bm = b.match(/^([A-G])([#b]?)/);
      if (bm) bass = NOTE_PC[bm[1] + (bm[2] || "")];
      main = raw.slice(0, slash).trim();
    }
    const m = main.match(/^([A-G])([#b]?)(.*)$/);
    if (!m) return { root: 0, quality: "maj", bass, raw };
    const root = NOTE_PC[m[1] + (m[2] || "")];
    const quality = normQuality(m[3]);
    return { root, quality, bass, raw };
  }

  return { parseChord, NOTE_PC };
})();

if (typeof window !== "undefined") window.UkeEngine = UkeEngine;
if (typeof module !== "undefined" && module.exports) module.exports = UkeEngine;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test-engine.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add chord-engine.js test-engine.mjs
git commit -m "feat(engine): 코드명 파서 + 스캐폴드"
```

---

### Task A2: 구성음 계산 (chordTones)

**Files:**
- Modify: `chord-engine.js`
- Test: `test-engine.mjs`

- [ ] **Step 1: Write the failing test**

`test-engine.mjs`에 추가:
```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test-engine.mjs`
Expected: FAIL — `chordTones is not a function`.

- [ ] **Step 3: Write minimal implementation**

`chord-engine.js`의 IIFE 안, `parseChord` 위에 추가하고 return에 `chordTones, essentialTones` 노출:
```js
  // quality → 루트로부터의 반음 인터벌
  const FORMULA = {
    maj:[0,4,7], m:[0,3,7], dim:[0,3,6], aug:[0,4,8],
    sus2:[0,2,7], sus4:[0,5,7],
    "6":[0,4,7,9], m6:[0,3,7,9],
    "7":[0,4,7,10], maj7:[0,4,7,11], m7:[0,3,7,10],
    m7b5:[0,3,6,10], dim7:[0,3,6,9],
    add9:[0,4,7,2], "9":[0,4,7,10,2], m9:[0,3,7,10,2], maj9:[0,4,7,11,2],
  };
  function chordTones(parsed) {
    const f = FORMULA[parsed.quality] || FORMULA.maj;
    return [...new Set(f.map((iv) => (parsed.root + iv) % 12))];
  }
  // 보이싱이 반드시 포함해야 할 음(루트·3도/서스·필요시 7도)
  function essentialTones(parsed) {
    const r = parsed.root, q = parsed.quality;
    const out = [r];
    const third = q.startsWith("m") || q === "dim" || q === "dim7" || q === "m7b5"
      ? (r + 3) % 12
      : q === "sus2" ? (r + 2) % 12
      : q === "sus4" ? (r + 5) % 12
      : (r + 4) % 12;
    out.push(third);
    if (/7/.test(q)) {
      const sev = q === "maj7" ? 11 : (q === "dim7" ? 9 : 10);
      out.push((r + sev) % 12);
    }
    return [...new Set(out)];
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test-engine.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add chord-engine.js test-engine.mjs
git commit -m "feat(engine): 구성음·핵심음 계산"
```

---

### Task A3: 보이싱 탐색 + 점수화 (voicing)

**Files:**
- Modify: `chord-engine.js`
- Test: `test-engine.mjs`

- [ ] **Step 1: Write the failing test**

`test-engine.mjs`에 추가 (롱테일 코드는 정확한 프렛 대신 *피치클래스 유효성*을 검증):
```js
const OPEN = [7,0,4,9]; // GCEA
function pcsOf(frets) {
  return frets.filter((f)=>f>=0).map((f,i)=>frets[i]).map((_,i)=>frets[i])
    .map((f,i)=> (OPEN[i] + frets[i]) % 12);
}
function playedPcs(frets) {
  const out = [];
  frets.forEach((f,i)=>{ if (f>=0) out.push((OPEN[i]+f)%12); });
  return [...new Set(out)];
}
test("voicing: 결과 음이 구성음의 부분집합 + 핵심음 포함 (Dmaj7)", () => {
  const p = UkeEngine.parseChord("Dmaj7"); // 미오버라이드 가정 코드
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test-engine.mjs`
Expected: FAIL — `voicing is not a function`.

- [ ] **Step 3: Write minimal implementation**

`chord-engine.js` IIFE 안에 추가하고 return에 `voicing` 노출:
```js
  const STRINGS_PC = [7, 0, 4, 9]; // G C E A
  const MAX_FRET = 12;

  function scoreVoicing(frets, parsed, toneSet) {
    const played = [];
    frets.forEach((f, i) => { if (f >= 0) played.push((STRINGS_PC[i] + f) % 12); });
    const fretted = frets.filter((f) => f > 0);
    const muted = frets.filter((f) => f === -1).length;
    const open = frets.filter((f) => f === 0).length;
    const covered = new Set(played).size;
    const span = fretted.length ? Math.max(...fretted) - Math.min(...fretted) : 0;
    const high = fretted.length ? Math.max(...fretted) : 0;
    let s = 0;
    s += fretted.length * 1.0;     // 손가락 적을수록 좋음
    s += span * 1.5;               // 손 벌림 작을수록 좋음
    s += high * 0.6;               // 낮은 포지션 선호
    s += muted * 3.0;              // 뮤트현 페널티(우쿨렐레는 4현 울림 선호)
    s -= open * 0.7;               // 개방현 보너스
    s -= covered * 1.2;            // 코드음 많이 담을수록 보너스
    if (!played.includes(parsed.root)) s += 2.0; // 루트 포함 선호
    return s;
  }

  function voicing(name) {
    const parsed = parseChord(name);
    if (OVERRIDE[name]) {
      return finalize(OVERRIDE[name], parsed, name);
    }
    const toneSet = new Set(chordTones(parsed));
    const essential = essentialTones(parsed);
    let best = null, bestScore = Infinity;
    // 0..MAX_FRET 전수 탐색(13^4). 모든 울린 음이 구성음, 핵심음 전부 포함인 것만.
    for (let g = -1; g <= MAX_FRET; g++)
    for (let c = -1; c <= MAX_FRET; c++)
    for (let e = -1; e <= MAX_FRET; e++)
    for (let a = -1; a <= MAX_FRET; a++) {
      const frets = [g, c, e, a];
      const played = [];
      let ok = true;
      frets.forEach((f, i) => {
        if (f >= 0) {
          const pc = (STRINGS_PC[i] + f) % 12;
          if (!toneSet.has(pc)) ok = false;
          played.push(pc);
        }
      });
      if (!ok || played.length < 3) continue;            // 최소 3음
      for (const ess of essential) if (!played.includes(ess)) { ok = false; break; }
      if (!ok) continue;
      const sc = scoreVoicing(frets, parsed, toneSet);
      if (sc < bestScore) { bestScore = sc; best = frets; }
    }
    if (!best) best = [0, 0, 0, 0]; // 이론상 불가 시 폴백
    return finalize(best, parsed, name);
  }

  function difficultyOf(frets) {
    const fretted = frets.filter((f) => f > 0);
    const span = fretted.length ? Math.max(...fretted) - Math.min(...fretted) : 0;
    const high = fretted.length ? Math.max(...fretted) : 0;
    if (high >= 5 || span >= 4 || fretted.length >= 4) return "hard";
    if (high >= 3 || fretted.length === 3) return "mid";
    return "easy";
  }

  function finalize(frets, parsed, name) {
    return { name, frets: frets.slice(), difficulty: difficultyOf(frets) };
  }

  const OVERRIDE = {}; // Task A4에서 채움
```
> 주의: `OVERRIDE`는 `voicing`보다 위에서 참조되므로 같은 스코프 상단에 `const OVERRIDE = {}`를 선언해 두고 A4에서 항목을 채운다. (호이스팅 회피를 위해 A4에서 객체 리터럴로 교체.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test-engine.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add chord-engine.js test-engine.mjs
git commit -m "feat(engine): 보이싱 전수탐색 + 난이도 점수화"
```

---

### Task A4: 오버라이드 표준형 + 다이어토닉

**Files:**
- Modify: `chord-engine.js`
- Test: `test-engine.mjs`

- [ ] **Step 1: Write the failing test**

`test-engine.mjs`에 추가:
```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test-engine.mjs`
Expected: FAIL — override 빈 객체라 `C`가 전수탐색 결과(예: `[0,0,0,3]`이 아닐 수 있음) / `diatonicChords is not a function`.

- [ ] **Step 3: Write minimal implementation**

`chord-engine.js`에서 `const OVERRIDE = {};`를 아래로 교체(기존 `chords.js`의 검증된 STANDARD 재사용):
```js
  const OVERRIDE = {
    "C":[0,0,0,3], "C7":[0,0,0,1], "Cmaj7":[0,0,0,2], "Cm":[0,3,3,3], "Cm7":[3,3,3,3],
    "D":[2,2,2,0], "D7":[2,2,2,3], "Dm":[2,2,1,0], "Dm7":[2,2,1,3],
    "E":[4,4,4,2], "E7":[1,2,0,2], "Em":[0,4,3,2], "Em7":[0,2,0,2],
    "F":[2,0,1,0], "F7":[2,3,1,3], "Fm":[1,0,1,3], "Fm7":[1,3,1,3], "Fmaj7":[2,4,1,3],
    "G":[0,2,3,2], "G7":[0,2,1,2], "Gm":[0,2,3,1], "Gmaj7":[0,2,2,2],
    "A":[2,1,0,0], "A7":[0,1,0,0], "Am":[2,0,0,0], "Am7":[0,0,0,0], "Amaj7":[1,1,0,0],
    "B":[4,3,2,2], "B7":[2,3,2,2], "Bm":[4,2,2,2], "Bm7":[2,2,2,2],
    "Bb":[3,2,1,1], "Bbm":[3,1,1,1], "Bb7":[1,2,1,1],
    "Eb":[0,3,3,1], "Ab":[5,3,4,3],
  };

  // 키의 다이어토닉 7개 코드(메이저 스케일). key는 "C" 또는 "C major" 형태.
  const SCALE_STEPS = [2,2,1,2,2,2,1];
  const PC_NAME = ["C","Db","D","Eb","E","F","Gb","G","Ab","A","Bb","B"];
  const TRIAD_SUFFIX = ["", "m", "m", "", "", "m", "dim"];
  function diatonicChords(key) {
    const root = (key || "C").trim().match(/^([A-G][#b]?)/);
    let pc = root ? NOTE_PC[root[1]] : 0;
    const out = [];
    for (let i = 0; i < 7; i++) {
      out.push(PC_NAME[pc % 12] + TRIAD_SUFFIX[i]);
      pc += SCALE_STEPS[i];
    }
    return out;
  }
```
return 객체에 `diatonicChords` 추가.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test-engine.mjs`
Expected: PASS (전체 스위트).

- [ ] **Step 5: Commit**

```bash
git add chord-engine.js test-engine.mjs
git commit -m "feat(engine): 관습 표준형 오버라이드 + 다이어토닉"
```

---

### Task A5: 렌더러를 엔진에 위임 (chords.js)

**Files:**
- Modify: `chords.js`
- Modify: `index.html` (스크립트 로드 순서)

- [ ] **Step 1: index.html 로드 순서 수정**

`index.html`에서 `chords.js`/`app.js` `<script>` 앞에 추가, 순서를 보장:
```html
<script src="chord-engine.js"></script>
<script src="itunes.js"></script>
<script src="chords.js"></script>
<script src="app.js"></script>
```
(itunes.js는 Phase B에서 생성하되, 빈 파일이라도 미리 만들어 404 방지: `touch itunes.js`)

- [ ] **Step 2: chords.js가 엔진 운지를 사용하도록 수정**

`chords.js` 상단 `STANDARD` 블록(라인 9~19)을 삭제하고, `render` 초입의 운지 결정 로직(라인 34~41)을 교체:
```js
  function render(name, frets) {
    const key = name ? name.trim() : "";
    // 엔진이 있으면 엔진 운지를 최우선 사용(결정론·정확)
    if (window.UkeEngine && key) {
      try { frets = window.UkeEngine.voicing(key).frets; } catch (_) {}
    }
    if (!validFrets(frets)) frets = [0, 0, 0, 0];
```
나머지 SVG 그리기 코드는 그대로 둔다.

- [ ] **Step 3: 수동 검증**

Run: `python3 -m http.server 8000` 후 브라우저에서 앱을 열어 임의 결과 화면의 코드 스트립이 정상 렌더되는지 확인(콘솔 에러 0). 엔진 단위 테스트는 이미 통과.

- [ ] **Step 4: Commit**

```bash
git add chords.js index.html itunes.js
git commit -m "refactor(render): 운지 출처를 chord-engine으로 위임"
```

---

## Phase B — 편곡 생성 개편 + iTunes 연동

### Task B1: iTunes 래퍼 (itunes.js)

**Files:**
- Modify: `itunes.js` (A5에서 만든 빈 파일)

- [ ] **Step 1: 구현**

`itunes.js`:
```js
/* iTunes Search API 래퍼 — 앨범 표지/아티스트 메타. 서버 0원, 키 불필요. */
window.UkeITunes = (function () {
  const CACHE = "uke_itunes_cache";
  function getCache() { try { return JSON.parse(localStorage.getItem(CACHE) || "{}"); } catch (_) { return {}; } }
  function setCache(o) { try { localStorage.setItem(CACHE, JSON.stringify(o)); } catch (_) {} }

  // 곡 → {artworkUrl, album, year, artist}. 실패 시 null.
  async function lookupSong(artist, title) {
    const term = encodeURIComponent(`${artist} ${title}`.trim());
    const cache = getCache();
    if (cache[term]) return cache[term];
    try {
      const res = await fetch(`https://itunes.apple.com/search?term=${term}&entity=song&limit=1`);
      if (!res.ok) return null;
      const j = await res.json();
      const r = j.results && j.results[0];
      if (!r) return null;
      const out = {
        artist: r.artistName || artist,
        album: r.collectionName || "",
        year: (r.releaseDate || "").slice(0, 4),
        // 100x100 기본 → 600x600으로 치환
        artworkUrl: (r.artworkUrl100 || "").replace("100x100", "600x600"),
      };
      cache[term] = out; setCache(cache);
      return out;
    } catch (_) { return null; }
  }

  // 아티스트 최신 앨범 N개(스토리용). 실패 시 [].
  async function artistAlbums(artist, n) {
    const term = encodeURIComponent(artist);
    try {
      const res = await fetch(`https://itunes.apple.com/search?term=${term}&entity=album&limit=${n || 5}`);
      if (!res.ok) return [];
      const j = await res.json();
      return (j.results || []).map((r) => ({
        album: r.collectionName || "",
        year: (r.releaseDate || "").slice(0, 4),
        artworkUrl: (r.artworkUrl100 || "").replace("100x100", "600x600"),
      }));
    } catch (_) { return []; }
  }

  return { lookupSong, artistAlbums };
})();
```

- [ ] **Step 2: 수동 검증**

브라우저 콘솔에서:
```js
await UkeITunes.lookupSong("아이유", "밤편지")
```
Expected: `{artist, album, year, artworkUrl}` 객체(artworkUrl이 https 이미지 URL). 네트워크 차단 시 `null`이어도 앱은 폴백으로 동작.

- [ ] **Step 3: Commit**

```bash
git add itunes.js
git commit -m "feat(itunes): 앨범 표지/아티스트 메타 래퍼 + 캐시"
```

---

### Task B2: 생성 프롬프트/스키마 개편 (app.js)

**Files:**
- Modify: `app.js:245-277` (`generateChords`)

- [ ] **Step 1: generateChords 교체**

`app.js`의 `generateChords` 전체를 아래로 교체(운지 제거·strum·intro·relativeKey·bpm·arranged):
```js
  async function generateChords(artist, title) {
    const q = getQuality();
    const system =
      "너는 숙련된 우쿨렐레 편곡자다. 코드 '이름'과 가사 배치, 구간별 스트로크만 만든다. 운지(프렛)는 절대 만들지 마라(앱이 계산).\n" +
      "코드는 악기 무관이다 — 우쿨렐레 악보가 없어도 기타/피아노 코드 자료를 그대로 쓴다.\n" +
      "[알고리즘]\n" +
      "STEP 1 web_search로 '[가수] [곡명] 코드/chords' 검색 → 코드가 가사와 실린 페이지 URL을 찾는다.\n" +
      "STEP 2 web_fetch로 후보 페이지를 직접 열어 실제 코드 진행·정렬을 확인한다.\n" +
      "STEP 3 자료가 있으면 전사한다. 자료가 전혀 없으면(인디·신곡 등) 원키 기준으로 직접 편곡한다.\n" +
      "STEP 4 (출처, 정직): transcribed=실제 차트의 코드+가사정렬 전사 / chords_verified=코드는 실제 확인, 가사배치는 추정 / arranged=자료 없어 원키로 직접 편곡. 등급 부풀리기 금지.\n" +
      "[우쿨렐레 적합] 원키 유지. 흔한 키(C·G·F·D·A) 코드 선호. 코드명만 적고 운지는 적지 마라.\n" +
      "[스트로크] 각 구간에 대표 스트럼 1개. 4/4면 8분음표 8칸을 D(다운)/U(업)/-(쉼)/x(뮤트)로. 예: 'D - D U - U D U'. Verse는 단순, Chorus는 리듬감 있게.\n" +
      "[배치] 코드는 한 마디(4박)마다 바뀜이 일반적. 가사 음절 '앞'에 [코드](줄 맨 앞에 몰지 말 것). 인트로는 코드 진행만.\n" +
      "[출력 규칙] 설명·펜스 금지. 첫 문자 '{' 마지막 '}'. JSON 하나만:\n" +
      '{"title":"","artist":"","album":"","key":"C major","relativeKey":"A minor","capo":0,"bpm":0,"timeSignature":"4/4",' +
      '"source":"transcribed|chords_verified|arranged","sourceUrl":"","intro":["C","G","Am","F"],"chordsUsed":["C","G","Am","F"],' +
      '"sections":[{"label":"Verse 1","strum":"D - D U - U D U","lines":["[C]가사 한 줄","..."]}]}\n' +
      "곡을 특정 못 하면 {\"notFound\":true} 만.";
    const user = `확정된 곡 — 가수: ${artist} / 곡명: ${title}\n자료가 있으면 전사(transcribed/chords_verified), 없으면 원키로 직접 편곡(arranged). 운지는 만들지 말고 코드 이름만. 설명 없이 JSON만.`;
    const text = await callClaude(system, user, { maxTokens: 8000, timeoutMs: 240000, useSearch: true, effort: q.effort, maxUses: q.maxUses });
    return parseJson(text);
  }
```

- [ ] **Step 2: 수동 검증(통합)**

`.env.local`에 키가 있으면 Task B5에서 `test.mjs`로 확인. 여기선 코드 변경만 커밋.

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "feat(generate): frets 제거·strum/intro/arranged 스키마 개편"
```

---

### Task B3: 결과 렌더링 — 스트로크·인트로·출처 (app.js)

**Files:**
- Modify: `app.js` (`renderResult` 라인 354~436, `renderLyricLine` 유지)

- [ ] **Step 1: 출처 배지에 arranged 추가**

`renderResult`의 배지 블록(라인 387~398)에서 `else` 분기를 `arranged` 문구로 교체:
```js
    } else { // arranged
      badge.className += "src-derived";
      badge.textContent = "🎨 직접 편곡 — 웹에 악보가 없어 원키 기준으로 우쿨렐레용으로 편곡했어요. 참고용이에요";
    }
```
그리고 출처 링크 조건 `data.source !== "derived"`를 `data.source !== "arranged"`로 변경(라인 399).

- [ ] **Step 2: 인트로 진행 줄 + 구간 스트로크 렌더**

`renderResult`에서 악보 본문 루프(라인 424~434)를 교체:
```js
    const sheet = document.createElement("div"); sheet.className = "sheet";

    // 인트로 코드 진행(한 줄)
    if (Array.isArray(data.intro) && data.intro.length) {
      const intro = document.createElement("div"); intro.className = "intro-line";
      intro.textContent = "Intro  " + data.intro.join("  ");
      sheet.appendChild(intro);
    }

    (data.sections || []).forEach((sec) => {
      const block = document.createElement("div"); block.className = "section-block";
      if (sec.label) {
        const lab = document.createElement("div"); lab.className = "section-label"; lab.textContent = sec.label;
        block.appendChild(lab);
      }
      if (sec.strum) {
        const st = document.createElement("div"); st.className = "strum-line";
        st.textContent = strumToArrows(sec.strum);
        block.appendChild(st);
      }
      (sec.lines || []).forEach((line) => block.appendChild(renderLyricLine(line)));
      sheet.appendChild(block);
    });
    root.appendChild(sheet);
```

- [ ] **Step 3: strumToArrows 헬퍼 추가**

`app.js`의 `renderLyricLine` 함수 아래에 추가:
```js
  // "D - D U" → "↓ · ↓ ↑" (x=뮤트 ✕). 토큰은 공백 구분.
  function strumToArrows(s) {
    const map = { D: "↓", U: "↑", "-": "·", X: "✕", x: "✕" };
    return String(s).trim().split(/\s+/).map((t) => map[t] || t).join(" ");
  }
```

- [ ] **Step 4: bpm/박자 메타 표시(선택)**

`renderResult`의 keybits(라인 364~370)에 추가:
```js
    if (data.relativeKey) keybits.push(data.relativeKey);
    if (data.bpm && Number(data.bpm) > 0) keybits.push(data.bpm + " BPM");
    if (data.timeSignature) keybits.push(data.timeSignature);
```

- [ ] **Step 5: 수동 검증**

브라우저에서 결과 화면에 인트로 줄·구간별 화살표 스트로크·🎨 배지(arranged 곡일 때)가 보이는지 확인. CSS 스타일은 Phase D에서.

- [ ] **Step 6: Commit**

```bash
git add app.js
git commit -m "feat(render): 인트로 진행·구간 스트로크 화살표·arranged 배지"
```

---

### Task B4: 검색 → 앨범 표지/앨범명 (app.js)

**Files:**
- Modify: `app.js` (`renderConfirm` 라인 306~325, `loadChords`/`addHistory`)

- [ ] **Step 1: 확인 카드에 표지/앨범 표시**

`renderConfirm`를 async로 바꾸고 표지를 붙인다. 함수 끝(actions append 전)에 추가:
```js
    // iTunes 표지/앨범 (실패해도 무시)
    if (window.UkeITunes) {
      UkeITunes.lookupSong(song.artist, song.title).then((info) => {
        if (!info) return;
        if (info.artworkUrl) {
          const img = document.createElement("img");
          img.className = "cover"; img.src = info.artworkUrl; img.alt = "album cover";
          card.insertBefore(img, card.firstChild);
        }
        if (info.album) {
          const al = document.createElement("div"); al.className = "song-extra"; al.textContent = info.album;
          card.appendChild(al);
        }
        song.album = info.album; song.artworkUrl = info.artworkUrl;
      });
    }
```

- [ ] **Step 2: 기록/저장에 표지 URL 보존**

`addHistory`(라인 475~481)에서 저장 객체에 표지·앨범 포함:
```js
    h.unshift({ title: song.title, artist: song.artist, album: song.album || "", artworkUrl: song.artworkUrl || "" });
```
`loadChords`(라인 327~344)의 `addHistory` 호출에 표지 전달:
```js
      addHistory({ title: data.title || song.title, artist: data.artist || song.artist,
                   album: data.album || song.album, artworkUrl: song.artworkUrl });
```

- [ ] **Step 3: 수동 검증**

검색→확인 카드에 앨범 표지·앨범명이 뜨는지 확인(네트워크 가능 시).

- [ ] **Step 4: Commit**

```bash
git add app.js
git commit -m "feat(search): 확인 카드 앨범 표지/앨범명(iTunes)"
```

---

### Task B5: 통합 스크립트 동기화 (test.mjs)

**Files:**
- Modify: `test.mjs` (`generateChords` 프롬프트 라인 ~140, 콘솔 렌더)

- [ ] **Step 1: test.mjs generateChords를 app.js와 동일 스키마로 교체**

`test.mjs`의 `generateChords` 함수 본문을 Task B2의 system/user 프롬프트와 동일하게 맞춘다(운지 제거·strum/intro/arranged). 콘솔 렌더의 "사용된 코드" 블록을 `data.chordsUsed`로 바꾸고 운지는 `UkeEngine`으로 표시하려면 상단에 `import UkeEngine from "./chord-engine.js";` 추가 후:
```js
  if (Array.isArray(data.chordsUsed) && data.chordsUsed.length) {
    console.log("\n[ 사용된 코드 ]");
    data.chordsUsed.forEach((name) => {
      const v = UkeEngine.voicing(name);
      console.log(`  ${name.padEnd(6)} G C E A = ${v.frets.map((f)=>f===-1?"x":f).join(" ")}`);
    });
  }
```
구간 출력에 `if (sec.strum) console.log("  스트럼: " + sec.strum);` 추가.

- [ ] **Step 2: 통합 검증(키 필요)**

Run: `node test.mjs "최유리" "당신은 누구시길래"`
Expected: 식별 성공 → JSON 생성 → `source: arranged`(웹 자료 없을 가능성 높음) 또는 transcribed, 콘솔에 코드별 엔진 운지·구간 스트럼 출력. 오류 없이 종료.

- [ ] **Step 3: Commit**

```bash
git add test.mjs
git commit -m "test: 통합 스크립트를 새 스키마/엔진 운지에 동기화"
```

---

## Phase C — 스크랩북 대시보드 + My Profile

### Task C1: 스크랩북 앨범 표지 그리드

**Files:**
- Modify: `app.js` (`renderScrapbook` 라인 594~624, `renderPlaylist` 라인 627~668)

- [ ] **Step 1: 곡 항목/플레이리스트에 표지 썸네일**

`makeSongItem`(라인 525~552)과 `renderPlaylist`의 곡 항목에서, `song.artworkUrl`이 있으면 `meta` 앞에 썸네일을 넣는다. `makeSongItem` 초입에 추가:
```js
    if (song.artworkUrl) {
      const img = document.createElement("img"); img.className = "thumb";
      img.src = song.artworkUrl; img.alt = ""; li.appendChild(img);
    }
```
플레이리스트 카드(`renderScrapbook`)는 첫 곡 표지를 커버로:
```js
      const firstArt = (pl.songs.find((s) => s.artworkUrl) || {}).artworkUrl;
      if (firstArt) { const img = document.createElement("img"); img.className = "thumb"; img.src = firstArt; li.insertBefore(img, li.firstChild); }
```

- [ ] **Step 2: addSongToPlaylist가 표지 보존**

`addSongToPlaylist`(라인 580~588)의 push에 표지 포함:
```js
    pl.songs.unshift({ title: song.title, artist: song.artist, album: song.album || "", artworkUrl: song.artworkUrl || "", savedAt: nowIso() });
```

- [ ] **Step 3: 수동 검증**

곡을 스크랩북에 담고 스크랩북/플레이리스트에 표지 썸네일이 보이는지 확인.

- [ ] **Step 4: Commit**

```bash
git add app.js
git commit -m "feat(scrapbook): 앨범 표지 썸네일 그리드"
```

---

### Task C2: My Profile — 좋아요 플레이리스트 + 아티스트 스토리

**Files:**
- Modify: `index.html` (프로필 화면 마크업, 하단 탭/버튼)
- Modify: `app.js` (프로필 렌더, 스토리)

- [ ] **Step 1: index.html에 프로필 화면 추가**

`screen-settings` 근처에 추가:
```html
<section id="screen-profile" class="screen">
  <div id="storyStrip" class="story-strip"></div>
  <h2 class="section-h">My Playlist ❤️</h2>
  <ul id="profileLikes" class="song-list"></ul>
</section>
```
상단/하단 내비에 프로필 진입 버튼(`id="navProfile"`)을 추가하고 `screens`에 `profile: $("screen-profile")` 등록, `showScreen`의 titles에 `profile: "My Profile"` 추가.

- [ ] **Step 2: app.js에 프로필 렌더 + 스토리**

`app.js`에 추가하고 `navProfile` 클릭/`showScreen("profile")`에서 호출:
```js
  function renderProfile() {
    // 좋아요(favorites)를 My Playlist로
    const likes = load(LS.favorites, []);
    const ul = $("profileLikes"); ul.innerHTML = "";
    if (!likes.length) {
      const li = document.createElement("li"); li.className = "empty-note";
      li.textContent = "악보 화면의 ⭐를 누르면 여기에 모여요.";
      ul.appendChild(li);
    } else {
      likes.forEach((s) => ul.appendChild(makeSongItem(s, { fav: true })));
    }
    renderStories(likes);
  }

  // 좋아하는 아티스트 → 인스타 스토리식 원형 썸네일(정적 큐레이션, iTunes)
  async function renderStories(likes) {
    const strip = $("storyStrip"); strip.innerHTML = "";
    const artists = [...new Set(likes.map((s) => s.artist).filter(Boolean))].slice(0, 12);
    for (const artist of artists) {
      const bubble = document.createElement("button"); bubble.className = "story-bubble";
      const ring = document.createElement("span"); ring.className = "story-ring";
      const name = document.createElement("span"); name.className = "story-name"; name.textContent = artist;
      bubble.append(ring, name);
      bubble.onclick = () => openStory(artist);
      strip.appendChild(bubble);
      if (window.UkeITunes) {
        UkeITunes.artistAlbums(artist, 1).then((al) => {
          if (al[0] && al[0].artworkUrl) ring.style.backgroundImage = `url(${al[0].artworkUrl})`;
        });
      }
    }
  }

  async function openStory(artist) {
    const albums = window.UkeITunes ? await UkeITunes.artistAlbums(artist, 5) : [];
    if (!albums.length) { toast(artist + "의 소식을 불러오지 못했어요"); return; }
    // 간단 스토리 뷰: 최신 앨범들을 토스트/오버레이로 순차 표시
    const lines = albums.map((a) => `${a.album}${a.year ? " (" + a.year + ")" : ""}`).join("\n");
    showOverlay(`${artist} 최근 앨범\n\n${lines}`);
    setTimeout(hideOverlay, 3500);
  }
```

- [ ] **Step 3: 수동 검증**

곡을 ⭐ 후 프로필 화면에서 My Playlist에 모이고, 상단 스토리 버블(아티스트 원형 표지)이 보이며, 클릭 시 최근 앨범이 뜨는지 확인.

- [ ] **Step 4: Commit**

```bash
git add index.html app.js
git commit -m "feat(profile): 좋아요 플레이리스트 + 아티스트 스토리(정적 큐레이션)"
```

---

## Phase D — 레트로 스피커/카세트 리디자인 (Design agent)

### Task D1: 디자인 시스템 + 화면별 스타일

**Files:**
- Modify: `style.css`
- Modify: `index.html` (필요한 래퍼/클래스 마크업만, 로직 변경 금지)

**레퍼런스:** 이미지 2(Plan8 — 미니멀 화이트 배경, 레드 라운드 스피커 그릴, 모노스페이스 라벨, 노브/슬라이더, 파형 디스플레이)를 메인으로, 이미지 1(둥근 카드·단계 리스트·컬러 배지)을 참조.

- [ ] **Step 1: 디자인 토큰 정의**

`style.css` 상단 `:root`에 팔레트/타이포 토큰 추가:
```css
:root{
  --bg:#f2f1ee; --panel:#ffffff; --ink:#1b1b1b; --muted:#8a857c;
  --accent:#d9402b;        /* 스피커 레드 */
  --accent-2:#c8643c;      /* 운지 마커 */
  --radius:22px; --radius-pill:999px;
  --mono:'SF Mono',ui-monospace,Menlo,Consolas,monospace;
  --shadow:0 6px 24px rgba(0,0,0,.08);
}
```

- [ ] **Step 2: 핵심 컴포넌트 스타일**

다음 클래스에 레트로 스타일을 부여(이미 마크업에 존재): `.screen`, 검색 입력, `.confirm-card`/`.cover`, `.source-badge`(src-real/partial/derived), `.chord-strip`/`.chord-diagram`, `.section-label`, `.intro-line`(모노스페이스), `.strum-line`(큰 화살표·자간), `.thumb`/`.story-strip`/`.story-bubble`/`.story-ring`(원형 그라데이션 링). 스피커 그릴 점격자는 검색 화면 헤더 배경에 `radial-gradient` 반복으로 표현:
```css
.speaker-grille{
  background-image:radial-gradient(var(--accent) 22%, transparent 23%);
  background-size:14px 14px; background-color:var(--accent);
  border-radius:var(--radius);
}
.strum-line{ font-family:var(--mono); letter-spacing:.25em; color:var(--accent); font-size:1.1em; }
.intro-line{ font-family:var(--mono); color:var(--muted); margin-bottom:8px; }
.story-ring{ width:60px;height:60px;border-radius:50%;display:block;
  background-size:cover;background-position:center;
  box-shadow:0 0 0 3px var(--bg),0 0 0 5px var(--accent); }
.cover{ width:140px;height:140px;border-radius:16px;object-fit:cover;box-shadow:var(--shadow); }
.thumb{ width:48px;height:48px;border-radius:8px;object-fit:cover; }
```

- [ ] **Step 3: 카세트/파형 모티프(선택)**

결과 헤더에 카세트 릴 또는 VU 파형 장식을 CSS만으로(이미지 무첨부) 추가. 과해지지 않게 절제.

- [ ] **Step 4: 수동 검증(반응형)**

`python3 -m http.server 8000`로 열어 모바일 폭(375px)에서 검색→확인→결과→스크랩북→프로필 전 화면이 레트로 스피커/카세트 톤으로 깨짐 없이 보이는지 확인. 운지 다이어그램·스트로크 화살표 가독성 확인.

- [ ] **Step 5: Commit**

```bash
git add style.css index.html
git commit -m "design: 레트로 스피커/카세트 리디자인"
```

---

## 최종 통합 검증

- [ ] `node --test test-engine.mjs` → 엔진 전체 PASS.
- [ ] `node test.mjs "최유리" "당신은 누구시길래"` → arranged 편곡 생성, 엔진 운지 출력, 오류 0.
- [ ] 브라우저: 자료 있는 곡(예: 아이유 밤편지) = transcribed/chords_verified, 최유리 곡 = arranged 배지.
- [ ] 검색 표지·스크랩북 그리드·프로필 스토리 동작.
- [ ] `git push origin main`.

---

## Spec Coverage 체크
- 결정론 운지 엔진 → A1–A5 ✓
- 자료 없는 곡 직접 편곡(arranged) → B2, B5 ✓
- 구간별 스트로크(↓↑×) → B2, B3 ✓
- 검색(가수·발매·앨범) + 표지 → B1, B4 ✓
- 스크랩북 표지 그리드 → C1 ✓
- My Profile 좋아요+아티스트 스토리(정적 큐레이션) → C2 ✓
- 레트로 스피커/카세트 디자인 → D1 ✓
- 서버 0원 유지(iTunes·Anthropic 브라우저 직접) ✓
