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

  return { parseChord, NOTE_PC, chordTones, essentialTones };
})();

if (typeof window !== "undefined") window.UkeEngine = UkeEngine;
if (typeof module !== "undefined" && module.exports) module.exports = UkeEngine;
