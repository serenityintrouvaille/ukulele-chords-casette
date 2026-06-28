/* 우쿨렐레 코드 다이어그램 SVG 렌더러
 * frets: [G, C, E, A] 순서의 프렛 번호 배열.
 *   0  = 개방현, -1 = 뮤트(연주 안 함), 1+ = 해당 프렛.
 * 곡에 쓰인 코드의 운지는 AI가 생성해서 넘겨주므로
 * 여기서는 그리기만 한다(코드 DB 불필요).
 */
window.UkeChord = (function () {
  function validFrets(f) {
    return Array.isArray(f) && f.length === 4 &&
      f.every((n) => Number.isInteger(n) && n >= -1 && n <= 15);
  }

  const STRINGS = 4;          // GCEA
  const W = 64;               // 전체 폭
  const H = 84;               // 전체 높이
  const PAD_X = 10;
  const PAD_TOP = 16;
  const PAD_BOTTOM = 8;

  function render(name, frets) {
    const key = name ? name.trim() : "";
    // 엔진이 있으면 엔진 운지를 최우선 사용(결정론·정확)
    if (window.UkeEngine && key) {
      try { frets = window.UkeEngine.voicing(key).frets; } catch (_) {}
    }
    if (!validFrets(frets)) frets = [0, 0, 0, 0];
    const played = frets.filter((f) => f > 0);
    const minFret = played.length ? Math.min(...played) : 1;
    const maxFret = played.length ? Math.max(...played) : 1;
    // 보여줄 프렛 구간(기본 4칸). 하이코드면 시작 프렛을 옮긴다.
    const ROWS = 4;
    let baseFret = 1;
    if (maxFret > ROWS) baseFret = minFret;

    const gridW = W - PAD_X * 2;
    const gridH = H - PAD_TOP - PAD_BOTTOM;
    const colGap = gridW / (STRINGS - 1);
    const rowGap = gridH / ROWS;

    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("width", "64");
    svg.setAttribute("height", "84");

    function line(x1, y1, x2, y2, w) {
      const l = document.createElementNS(ns, "line");
      l.setAttribute("x1", x1); l.setAttribute("y1", y1);
      l.setAttribute("x2", x2); l.setAttribute("y2", y2);
      l.setAttribute("stroke", "#3b2f2f");
      l.setAttribute("stroke-width", w || 1);
      svg.appendChild(l);
    }

    // 너트(0프렛) 또는 시작 프렛 표시
    const topY = PAD_TOP;
    if (baseFret === 1) {
      line(PAD_X, topY, PAD_X + gridW, topY, 3); // 두꺼운 너트
    } else {
      line(PAD_X, topY, PAD_X + gridW, topY, 1);
      const t = document.createElementNS(ns, "text");
      t.setAttribute("x", PAD_X - 4);
      t.setAttribute("y", topY + rowGap * 0.7);
      t.setAttribute("font-size", "8");
      t.setAttribute("text-anchor", "end");
      t.setAttribute("fill", "#8a7d72");
      t.textContent = baseFret + "fr";
      svg.appendChild(t);
    }

    // 프렛 가로선
    for (let r = 1; r <= ROWS; r++) {
      line(PAD_X, topY + rowGap * r, PAD_X + gridW, topY + rowGap * r, 1);
    }
    // 현 세로선
    for (let s = 0; s < STRINGS; s++) {
      const x = PAD_X + colGap * s;
      line(x, topY, x, topY + gridH, 1);
    }

    // 각 현의 마커
    for (let s = 0; s < STRINGS; s++) {
      const x = PAD_X + colGap * s;
      const f = frets[s];
      if (f === -1) {
        // 뮤트 X
        const t = document.createElementNS(ns, "text");
        t.setAttribute("x", x); t.setAttribute("y", topY - 5);
        t.setAttribute("font-size", "9"); t.setAttribute("text-anchor", "middle");
        t.setAttribute("fill", "#8a7d72");
        t.textContent = "✕";
        svg.appendChild(t);
      } else if (f === 0) {
        // 개방현 O
        const c = document.createElementNS(ns, "circle");
        c.setAttribute("cx", x); c.setAttribute("cy", topY - 6);
        c.setAttribute("r", 3);
        c.setAttribute("fill", "none"); c.setAttribute("stroke", "#3b2f2f");
        svg.appendChild(c);
      } else {
        const rel = f - baseFret + 1; // 화면상 몇 번째 칸
        if (rel < 1 || rel > ROWS) continue;
        const cy = topY + rowGap * (rel - 0.5);
        const c = document.createElementNS(ns, "circle");
        c.setAttribute("cx", x); c.setAttribute("cy", cy);
        c.setAttribute("r", 5.5);
        c.setAttribute("fill", "#c8643c");
        svg.appendChild(c);
      }
    }

    const wrap = document.createElement("div");
    wrap.className = "chord-diagram";
    const label = document.createElement("div");
    label.className = "cname";
    label.textContent = name || "";
    wrap.appendChild(label);
    wrap.appendChild(svg);
    return wrap;
  }

  return { render };
})();
