/* 결정론적 우쿨렐레 운지 엔진 — 코드명 → GCEA 최적 운지.
 * 네트워크/AI 의존 없음. 음악이론으로 계산한다. */
const UkeEngine = (function () {
  // 음이름 → 피치클래스(C=0)
  const NOTE_PC = { C:0, "C#":1, Db:1, D:2, "D#":3, Eb:3, E:4, F:5, "F#":6, Gb:6,
    G:7, "G#":8, Ab:8, A:9, "A#":10, Bb:10, B:11, "Cb":11, "E#":5, "B#":0 };

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
    const isMinorThird =
      (q[0] === "m" && q[1] !== "a") || q === "dim" || q === "dim7"; // m, m6, m7, m9, m7b5, dim(7) — NOT maj*
    const third = isMinorThird
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

  const STRINGS_PC = [7, 0, 4, 9]; // G C E A
  const MAX_FRET = 12;

  function scoreVoicing(frets, parsed) {
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
      if (!ok || played.length < 3) continue;
      for (const ess of essential) if (!played.includes(ess)) { ok = false; break; }
      if (!ok) continue;
      const sc = scoreVoicing(frets, parsed);
      if (sc < bestScore) { bestScore = sc; best = frets; }
    }
    if (!best) best = [0, 0, 0, 0];
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

  return { parseChord, NOTE_PC, chordTones, essentialTones, voicing };
})();

if (typeof window !== "undefined") window.UkeEngine = UkeEngine;
if (typeof module !== "undefined" && module.exports) module.exports = UkeEngine;
