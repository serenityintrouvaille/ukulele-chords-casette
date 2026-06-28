/* 우쿨렐레 코드 찾기 — 메인 로직
 * 순수 정적 + 브라우저에서 Anthropic API 직접 호출.
 */
(function () {
  "use strict";

  // ---------- 저장소 키 ----------
  const LS = {
    apiKey: "uke_api_key",
    model: "uke_model",
    history: "uke_history",
    favorites: "uke_favorites",
    fontSize: "uke_fontsize",
    playlists: "uke_playlists",
    quality: "uke_quality",
  };
  const DEFAULT_MODEL = "claude-sonnet-4-6";
  const DEFAULT_QUALITY = "balanced";
  // 편곡 정확도 ↔ 속도 트레이드오프
  const QUALITY = {
    accuracy: { effort: "high", maxUses: 4 },
    balanced: { effort: "medium", maxUses: 2 },
    speed: { effort: "low", maxUses: 2 },
  };
  const MAX_HISTORY = 20;

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const screens = {
    search: $("screen-search"),
    confirm: $("screen-confirm"),
    result: $("screen-result"),
    scrapbook: $("screen-scrapbook"),
    playlist: $("screen-playlist"),
    settings: $("screen-settings"),
  };
  const navBack = $("navBack");
  const navSettings = $("navSettings");
  const topTitle = $("topTitle");
  const overlay = $("overlay");
  const overlayText = $("overlayText");
  const toastEl = $("toast");

  let currentScreen = "search";
  let prevScreen = "search";

  // ---------- 유틸 ----------
  function store(key, val) {
    if (val === undefined || val === null) localStorage.removeItem(key);
    else localStorage.setItem(key, typeof val === "string" ? val : JSON.stringify(val));
  }
  function load(key, fallback) {
    const v = localStorage.getItem(key);
    if (v === null) return fallback;
    try { return JSON.parse(v); } catch (_) { return v; }
  }
  function toast(msg, ms) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (toastEl.hidden = true), ms || 2600);
  }
  function showOverlay(text) { overlayText.textContent = text || "불러오는 중…"; overlay.hidden = false; }
  function hideOverlay() { overlay.hidden = true; }

  // 진행 중인 API 요청 (취소 버튼이 중단할 수 있게 보관)
  let activeController = null;
  $("overlayCancel").addEventListener("click", () => {
    if (activeController) { try { activeController.abort(); } catch (_) {} }
    hideOverlay();
    toast("취소했어요");
  });

  function showScreen(name) {
    prevScreen = currentScreen;
    currentScreen = name;
    Object.values(screens).forEach((s) => s.classList.remove("active"));
    screens[name].classList.add("active");
    navBack.hidden = name === "search";
    navSettings.hidden = name === "settings";
    const titles = {
      search: "우쿨렐레 코드 🎵",
      confirm: "곡 확인",
      result: "코드 악보",
      scrapbook: "스크랩북 📔",
      playlist: "플레이리스트",
      settings: "설정",
    };
    topTitle.textContent = titles[name] || "우쿨렐레 코드 🎵";
    window.scrollTo(0, 0);
  }

  // ---------- 설정 ----------
  function getApiKey() { return load(LS.apiKey, ""); }
  function getModel() { return load(LS.model, DEFAULT_MODEL); }
  function getQuality() { return QUALITY[load(LS.quality, DEFAULT_QUALITY)] || QUALITY[DEFAULT_QUALITY]; }

  function initSettingsScreen() {
    $("apiKeyInput").value = getApiKey() || "";
    $("modelSelect").value = getModel();
    $("qualitySelect").value = load(LS.quality, DEFAULT_QUALITY);
  }
  $("saveSettings").addEventListener("click", () => {
    const key = $("apiKeyInput").value.trim();
    store(LS.apiKey, key);
    store(LS.model, $("modelSelect").value);
    store(LS.quality, $("qualitySelect").value);
    toast("저장됐어요 ✅");
    showScreen("search");
  });

  // ---------- Anthropic API 호출 ----------
  // opts: { maxTokens, timeoutMs, useSearch }
  async function callClaude(systemPrompt, userPrompt, opts) {
    opts = opts || {};
    const maxTokens = opts.maxTokens || 8000;
    const timeoutMs = opts.timeoutMs || 120000;
    const apiKey = getApiKey();
    if (!apiKey || !apiKey.trim()) {
      const err = new Error("NO_KEY");
      err.code = "NO_KEY";
      throw err;
    }

    // 무한 대기 방지: 전체 호출(검색 루프 포함)에 하나의 타임아웃
    const ctrl = new AbortController();
    activeController = ctrl; // 취소 버튼에서 중단할 수 있게 보관
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    const model = getModel();
    const tools = opts.useSearch
      ? [
          { type: "web_search_20260209", name: "web_search", max_uses: opts.maxUses || 2, allowed_callers: ["direct"] },
          { type: "web_fetch_20260209", name: "web_fetch", max_uses: opts.maxUses || 2, allowed_callers: ["direct"] },
        ]
      : undefined;

    let messages = [{ role: "user", content: userPrompt }];
    let lastData = null;

    try {
      // 서버사이드 웹검색은 pause_turn 으로 끊길 수 있어 이어서 재요청
      for (let step = 0; step < 6; step++) {
        const body = {
          model,
          max_tokens: maxTokens,
          system: systemPrompt,
          messages,
        };
        if (tools) body.tools = tools;
        // 사고 깊이를 낮춰 속도 향상 (Haiku는 effort 미지원이라 제외)
        if (opts.effort && !/haiku/i.test(model)) {
          body.output_config = { effort: opts.effort };
        }

        let res;
        try {
          res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-api-key": apiKey.trim(),
              "anthropic-version": "2023-06-01",
              "anthropic-dangerous-direct-browser-access": "true",
            },
            body: JSON.stringify(body),
            signal: ctrl.signal,
          });
        } catch (e) {
          if (e.name === "AbortError") { const err = new Error("TIMEOUT"); err.code = "TIMEOUT"; throw err; }
          const err = new Error("NETWORK"); err.code = "NETWORK"; err.original = e.message; throw err;
        }

        if (!res.ok) {
          let detail = "";
          try { const j = await res.json(); detail = j.error && j.error.message ? j.error.message : ""; } catch (_) {}
          const err = new Error(detail || ("HTTP " + res.status));
          err.status = res.status;
          throw err;
        }

        lastData = await res.json();
        if (lastData.stop_reason === "pause_turn") {
          // 모델이 검색 도중 멈춤 → 지금까지 내용을 다시 보내 이어가기
          messages.push({ role: "assistant", content: lastData.content });
          continue;
        }
        break;
      }
    } finally {
      clearTimeout(timer);
      activeController = null;
    }

    // 마지막 text 블록(최종 답변)을 사용. 검색 중간 텍스트는 건너뜀.
    const texts = (lastData && lastData.content || []).filter((b) => b.type === "text").map((b) => b.text);
    return texts.length ? texts[texts.length - 1] : "";
  }

  // 모델이 코드펜스/잡텍스트를 섞어도 JSON만 안전하게 추출
  function parseJson(text) {
    if (!text) throw new Error("빈 응답");
    let t = text.trim();
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) t = fence[1].trim();
    try { return JSON.parse(t); } catch (_) {}
    const first = t.indexOf("{");
    const last = t.lastIndexOf("}");
    if (first !== -1 && last !== -1 && last > first) {
      return JSON.parse(t.slice(first, last + 1));
    }
    throw new Error("응답을 해석하지 못했어요");
  }

  function handleApiError(e) {
    console.error("[코드찾기 오류]", e, e && e.original ? "(" + e.original + ")" : "");
    if (e.code === "NO_KEY") {
      toast("먼저 설정에서 API 키를 입력해 주세요");
      showScreen("settings");
      initSettingsScreen();
      return;
    }
    if (e.code === "TIMEOUT") { toast("응답이 너무 오래 걸려 중단했어요. 다시 시도해 주세요"); return; }
    if (e.code === "NETWORK") { toast("연결 실패 (네트워크/CORS). 콘솔을 확인해 주세요"); return; }
    if (e.status === 401) { toast("API 키가 올바르지 않아요. 설정을 확인해 주세요"); return; }
    if (e.status === 429) { toast("요청이 많아요. 잠시 후 다시 시도해 주세요"); return; }
    if (e.status === 400) { toast("요청 오류: " + (e.message || "") + " (모델/설정 확인)"); return; }
    if (/fetch|Load failed|NetworkError/i.test(e.message || "")) { toast("네트워크 오류예요. 연결을 확인해 주세요"); return; }
    toast("오류: " + (e.message || "알 수 없는 오류"));
  }

  // ---------- 1단계: 곡 식별 (빠르게, 메타데이터만) ----------
  async function identifySong(artist, title) {
    const system =
      "너는 음악 검색 도우미다. 입력한 가수/곡명(오타·약칭·한영혼용 가능)으로 실제 곡 1개를 특정한다. " +
      "web_search를 1회만 사용해 빠르게 확인한다(가사·코드까지 찾지 말고 곡 존재·정확한 표기만). " +
      "확인되면 found=true. 특정 불가면 found=false. 없는 곡을 지어내지 마라. " +
      '출력은 JSON 1개뿐(설명·펜스 금지): {"found":boolean,"title":"정확한 곡명","artist":"정확한 가수명","year":"발매연도 또는 \\"\\"","note":"앨범 등 짧은 참고(선택)"}';
    const user = `가수: ${artist || "(미입력)"}\n곡명: ${title || "(미입력)"}\n이 곡을 빠르게 특정해줘.`;
    const text = await callClaude(system, user, { maxTokens: 700, timeoutMs: 60000, useSearch: true, effort: "low", maxUses: 1 });
    return parseJson(text);
  }

  // ---------- 2단계: 코드+가사 생성 ----------
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

  // ---------- 검색 흐름 ----------
  let pendingSong = null; // 확인 화면에서 들고 있는 곡

  $("searchForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const artist = $("artistInput").value.trim();
    const title = $("titleInput").value.trim();
    if (!artist && !title) { toast("가수 또는 곡명을 입력해 주세요"); return; }

    // 1단계: 빠른 식별(웹검색)로 정확한 곡 정보를 확보해 확인 카드에 표시
    showOverlay("곡을 찾는 중…");
    try {
      const song = await identifySong(artist, title);
      hideOverlay();
      if (!song || !song.found) {
        toast("곡을 찾지 못했어요. 가수/곡명 표기를 바꿔보세요");
        return;
      }
      pendingSong = { title: song.title, artist: song.artist, year: song.year, note: song.note };
      renderConfirm(pendingSong);
      showScreen("confirm");
    } catch (err) {
      hideOverlay();
      handleApiError(err);
    }
  });

  function renderConfirm(song) {
    const card = $("confirmCard");
    card.innerHTML = "";
    const q = document.createElement("div"); q.className = "q"; q.textContent = "이 곡이 맞나요?";
    const t = document.createElement("div"); t.className = "song-title"; t.textContent = song.title;
    const a = document.createElement("div"); a.className = "song-artist"; a.textContent = song.artist;
    card.append(q, t, a);
    const extraText = [song.year, song.note].filter(Boolean).join(" · ");
    if (extraText) {
      const ex = document.createElement("div"); ex.className = "song-extra"; ex.textContent = extraText;
      card.appendChild(ex);
    }
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
    const actions = document.createElement("div"); actions.className = "confirm-actions";
    const back = document.createElement("button"); back.className = "btn-secondary"; back.textContent = "다시 검색";
    back.onclick = () => showScreen("search");
    const go = document.createElement("button"); go.className = "btn-primary"; go.textContent = "코드 보기";
    go.onclick = () => loadChords(song);
    actions.append(back, go);
    card.appendChild(actions);
  }

  async function loadChords(song) {
    showOverlay("검색해서 코드를 만드는 중…");
    try {
      const data = await generateChords(song.artist, song.title);
      hideOverlay();
      if (data.notFound || !data.sections || !data.sections.length) {
        toast("곡을 찾지 못했어요. 가수/곡명 표기를 바꿔보세요");
        showScreen("search");
        return;
      }
      addHistory({ title: data.title || song.title, artist: data.artist || song.artist,
                   album: data.album || song.album, artworkUrl: song.artworkUrl });
      renderResult(data);
      showScreen("result");
    } catch (err) {
      hideOverlay();
      handleApiError(err);
    }
  }

  // ---------- 결과 렌더링 ----------
  function getFontSize() { return load(LS.fontSize, 16); }
  function setFontSize(px) { store(LS.fontSize, px); applyFontSize(px); }
  function applyFontSize(px) {
    const sheet = document.querySelector("#resultContent .sheet");
    if (sheet) sheet.style.fontSize = px + "px";
  }

  function renderResult(data) {
    const root = $("resultContent");
    root.innerHTML = "";

    // 헤더 + 즐겨찾기 토글
    const head = document.createElement("div"); head.className = "result-head";
    const meta = document.createElement("div"); meta.className = "meta";
    const rt = document.createElement("div"); rt.className = "r-title"; rt.textContent = data.title || "";
    const ra = document.createElement("div"); ra.className = "r-artist"; ra.textContent = data.artist || "";
    meta.append(rt, ra);
    const keybits = [];
    if (data.key) keybits.push(data.key);
    if (data.relativeKey) keybits.push(data.relativeKey);
    if (data.capo && Number(data.capo) > 0) keybits.push("카포 " + data.capo);
    if (data.bpm && Number(data.bpm) > 0) keybits.push(data.bpm + " BPM");
    if (data.timeSignature) keybits.push(data.timeSignature);
    if (keybits.length) {
      const rk = document.createElement("div"); rk.className = "r-key"; rk.textContent = keybits.join(" · ");
      meta.appendChild(rk);
    }
    head.appendChild(meta);
    const songKey = { title: data.title, artist: data.artist };
    const actions = document.createElement("div");
    actions.style.display = "flex"; actions.style.flexDirection = "column"; actions.style.gap = "6px"; actions.style.alignItems = "center";
    const fav = document.createElement("button"); fav.className = "star-btn";
    const refreshStar = () => { fav.textContent = isFavorite(songKey) ? "⭐" : "☆"; };
    refreshStar();
    fav.onclick = () => { toggleFavorite(songKey); refreshStar(); };
    const saveBtn = document.createElement("button"); saveBtn.className = "star-btn"; saveBtn.textContent = "📔";
    saveBtn.title = "스크랩북에 담기";
    saveBtn.onclick = () => openSaveSheet(songKey);
    actions.append(fav, saveBtn);
    head.appendChild(actions);
    root.appendChild(head);

    // 출처 배지 — 코드/배치가 실제인지 추정인지 3단계로 정직하게 표시
    const badge = document.createElement("div");
    badge.className = "source-badge ";
    if (data.source === "transcribed") {
      badge.className += "src-real";
      badge.textContent = "✅ 실제 코드 악보 전사 (코드·배치 모두 실제)";
    } else if (data.source === "chords_verified") {
      badge.className += "src-partial";
      badge.textContent = "🟡 코드는 실제 확인 · 가사 배치는 추정 — 코드 자체는 맞지만 어느 가사에 얹히는지는 추정이라 어긋날 수 있어요";
    } else { // arranged
      badge.className += "src-derived";
      badge.textContent = "🎨 직접 편곡 — 웹에 악보가 없어 원키 기준으로 우쿨렐레용으로 편곡했어요. 참고용이에요";
    }
    if (data.sourceUrl && data.source !== "arranged") {
      const a = document.createElement("a"); a.href = data.sourceUrl; a.target = "_blank"; a.rel = "noopener";
      a.textContent = " (출처)"; badge.appendChild(a);
    }
    root.appendChild(badge);

    // 코드 운지표 스트립 — chordsUsed(이름 배열) → 엔진이 운지 계산
    if (Array.isArray(data.chordsUsed) && data.chordsUsed.length) {
      const strip = document.createElement("div"); strip.className = "chord-strip";
      data.chordsUsed.forEach((name) => {
        if (name) strip.appendChild(window.UkeChord.render(name));
      });
      root.appendChild(strip);
    }

    // 글씨 크기 조절
    const fbar = document.createElement("div"); fbar.className = "fontsize-bar";
    const minus = document.createElement("button"); minus.textContent = "A−";
    const plus = document.createElement("button"); plus.textContent = "A+";
    minus.onclick = () => setFontSize(Math.max(12, getFontSize() - 1));
    plus.onclick = () => setFontSize(Math.min(28, getFontSize() + 1));
    fbar.append(minus, plus);
    root.appendChild(fbar);

    // 악보 본문
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
    applyFontSize(getFontSize());
  }

  // "[C]사랑[G]했던" → 코드가 글자 위에 얹힌 줄
  function renderLyricLine(line) {
    const el = document.createElement("div"); el.className = "lyric-line";
    if (!line || !line.trim()) { el.classList.add("empty"); return el; }

    const re = /\[([^\]]+)\]/g;
    let lastIndex = 0;
    let m;
    const parts = []; // {chord, text}
    let pendingChord = "";
    while ((m = re.exec(line)) !== null) {
      const textBefore = line.slice(lastIndex, m.index);
      if (textBefore || pendingChord) parts.push({ chord: pendingChord, text: textBefore });
      pendingChord = m[1];
      lastIndex = re.lastIndex;
    }
    const tail = line.slice(lastIndex);
    if (tail || pendingChord) parts.push({ chord: pendingChord, text: tail });

    if (parts.length === 0) parts.push({ chord: "", text: line });

    parts.forEach((p) => {
      const chunk = document.createElement("span"); chunk.className = "chunk";
      const c = document.createElement("span"); c.className = "c"; c.textContent = p.chord || "";
      const w = document.createElement("span"); w.className = "w"; w.textContent = p.text || "";
      chunk.append(c, w);
      el.appendChild(chunk);
    });
    return el;
  }

  // "D - D U" → "↓ · ↓ ↑" (x=뮤트 ✕). 토큰은 공백 구분.
  function strumToArrows(s) {
    const map = { D: "↓", U: "↑", "-": "·", X: "✕", x: "✕" };
    return String(s).trim().split(/\s+/).map((t) => map[t] || t).join(" ");
  }

  // ---------- 기록 / 즐겨찾기 ----------
  function sameSong(a, b) {
    return (a.title || "").trim() === (b.title || "").trim() &&
           (a.artist || "").trim() === (b.artist || "").trim();
  }

  function addHistory(song) {
    let h = load(LS.history, []);
    h = h.filter((s) => !sameSong(s, song));
    h.unshift({ title: song.title, artist: song.artist, album: song.album || "", artworkUrl: song.artworkUrl || "" });
    if (h.length > MAX_HISTORY) h = h.slice(0, MAX_HISTORY);
    store(LS.history, h);
  }
  function isFavorite(song) {
    return load(LS.favorites, []).some((s) => sameSong(s, song));
  }
  function toggleFavorite(song) {
    let f = load(LS.favorites, []);
    if (f.some((s) => sameSong(s, song))) {
      f = f.filter((s) => !sameSong(s, song));
      toast("즐겨찾기에서 뺐어요");
    } else {
      f.unshift({ title: song.title, artist: song.artist });
      toast("즐겨찾기에 추가했어요 ⭐");
    }
    store(LS.favorites, f);
    renderLists();
  }

  function renderLists() {
    const favs = load(LS.favorites, []);
    const hist = load(LS.history, []);

    // 즐겨찾기
    const favSection = $("favSection");
    const favList = $("favList");
    favList.innerHTML = "";
    if (favs.length) {
      favSection.hidden = false;
      favs.forEach((s) => favList.appendChild(makeSongItem(s, { fav: true })));
    } else {
      favSection.hidden = true;
    }

    // 기록
    const histSection = $("historySection");
    const histList = $("historyList");
    histList.innerHTML = "";
    if (hist.length) {
      histSection.hidden = false;
      hist.forEach((s) => histList.appendChild(makeSongItem(s, { history: true })));
    } else {
      histSection.hidden = true;
    }
  }

  function makeSongItem(song, opts) {
    const li = document.createElement("li"); li.className = "song-item";
    const meta = document.createElement("div"); meta.className = "meta";
    const t = document.createElement("div"); t.className = "t"; t.textContent = song.title;
    const a = document.createElement("div"); a.className = "a"; a.textContent = song.artist;
    meta.append(t, a);
    meta.onclick = () => loadChords(song);
    li.appendChild(meta);

    // 별 토글
    const star = document.createElement("button"); star.className = "star-btn";
    star.textContent = isFavorite(song) ? "⭐" : "☆";
    star.onclick = (e) => { e.stopPropagation(); toggleFavorite(song); };
    li.appendChild(star);

    // 기록 항목엔 삭제 버튼
    if (opts && opts.history) {
      const del = document.createElement("button"); del.className = "del-btn"; del.textContent = "✕";
      del.onclick = (e) => {
        e.stopPropagation();
        let h = load(LS.history, []).filter((s) => !sameSong(s, song));
        store(LS.history, h);
        renderLists();
      };
      li.appendChild(del);
    }
    return li;
  }

  $("clearHistory").addEventListener("click", () => {
    store(LS.history, []);
    renderLists();
    toast("기록을 지웠어요");
  });

  // ---------- 스크랩북 (플레이리스트) ----------
  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return "";
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
  }
  function nowIso() { return new Date().toISOString(); }
  function genId() { return "pl_" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }

  function loadPlaylists() { return load(LS.playlists, []); }
  function savePlaylists(arr) { store(LS.playlists, arr); }
  function createPlaylist(name) {
    const pls = loadPlaylists();
    const pl = { id: genId(), name: name.trim() || "새 플레이리스트", createdAt: nowIso(), songs: [] };
    pls.unshift(pl);
    savePlaylists(pls);
    return pl;
  }
  function addSongToPlaylist(playlistId, song) {
    const pls = loadPlaylists();
    const pl = pls.find((p) => p.id === playlistId);
    if (!pl) return false;
    if (pl.songs.some((s) => sameSong(s, song))) return "dup";
    pl.songs.unshift({ title: song.title, artist: song.artist, savedAt: nowIso() });
    savePlaylists(pls);
    return true;
  }

  let pendingSaveSong = null; // 담기 시트에서 저장할 곡
  let currentPlaylistId = null;

  // 스크랩북 목록 화면
  function renderScrapbook() {
    const list = $("playlistList");
    list.innerHTML = "";
    const pls = loadPlaylists();
    if (!pls.length) {
      const note = document.createElement("li"); note.className = "empty-note";
      note.textContent = "아직 플레이리스트가 없어요. 위에서 만들어보세요!";
      list.appendChild(note);
      return;
    }
    pls.forEach((pl) => {
      const li = document.createElement("li"); li.className = "song-item";
      const meta = document.createElement("div"); meta.className = "meta";
      const t = document.createElement("div"); t.className = "t"; t.textContent = pl.name;
      const sub = document.createElement("div"); sub.className = "sub";
      sub.textContent = `곡 ${pl.songs.length}개 · ${fmtDate(pl.createdAt)} 생성`;
      meta.append(t, sub);
      meta.onclick = () => { currentPlaylistId = pl.id; renderPlaylist(pl.id); showScreen("playlist"); };
      li.appendChild(meta);
      const del = document.createElement("button"); del.className = "del-btn"; del.textContent = "🗑";
      del.onclick = (e) => {
        e.stopPropagation();
        if (!confirm(`'${pl.name}' 플레이리스트를 삭제할까요?`)) return;
        savePlaylists(loadPlaylists().filter((p) => p.id !== pl.id));
        renderScrapbook();
        toast("삭제했어요");
      };
      li.appendChild(del);
      list.appendChild(li);
    });
  }

  // 플레이리스트 내부 화면
  function renderPlaylist(id) {
    const root = $("playlistContent");
    root.innerHTML = "";
    const pl = loadPlaylists().find((p) => p.id === id);
    if (!pl) { showScreen("scrapbook"); return; }

    const head = document.createElement("div"); head.className = "playlist-head";
    const name = document.createElement("div"); name.className = "p-name"; name.textContent = pl.name;
    const m = document.createElement("div"); m.className = "p-meta";
    m.textContent = `곡 ${pl.songs.length}개 · ${fmtDate(pl.createdAt)} 생성`;
    head.append(name, m);
    root.appendChild(head);

    const list = document.createElement("ul"); list.className = "song-list";
    if (!pl.songs.length) {
      const note = document.createElement("li"); note.className = "empty-note";
      note.textContent = "담긴 곡이 없어요. 곡 화면에서 📔 버튼으로 담아보세요.";
      list.appendChild(note);
    } else {
      pl.songs.forEach((song) => {
        const li = document.createElement("li"); li.className = "song-item";
        const meta = document.createElement("div"); meta.className = "meta";
        const t = document.createElement("div"); t.className = "t"; t.textContent = song.title;
        const a = document.createElement("div"); a.className = "a"; a.textContent = song.artist;
        const sub = document.createElement("div"); sub.className = "sub"; sub.textContent = `${fmtDate(song.savedAt)} 저장`;
        meta.append(t, a, sub);
        meta.onclick = () => loadChords(song);
        li.appendChild(meta);
        const del = document.createElement("button"); del.className = "del-btn"; del.textContent = "✕";
        del.onclick = (e) => {
          e.stopPropagation();
          const pls = loadPlaylists();
          const p = pls.find((x) => x.id === id);
          if (p) { p.songs = p.songs.filter((s) => !sameSong(s, song)); savePlaylists(pls); }
          renderPlaylist(id);
        };
        li.appendChild(del);
        list.appendChild(li);
      });
    }
    root.appendChild(list);
  }

  // 담기 시트
  function openSaveSheet(song) {
    pendingSaveSong = song;
    $("saveSheetSong").textContent = `${song.title} — ${song.artist}`;
    const list = $("savePickList");
    list.innerHTML = "";
    const pls = loadPlaylists();
    if (!pls.length) {
      const note = document.createElement("li"); note.className = "empty-note";
      note.textContent = "아래에서 새 플레이리스트를 만들어 담아보세요.";
      list.appendChild(note);
    } else {
      pls.forEach((pl) => {
        const li = document.createElement("li"); li.className = "song-item";
        const meta = document.createElement("div"); meta.className = "meta";
        const t = document.createElement("div"); t.className = "t"; t.textContent = pl.name;
        const sub = document.createElement("div"); sub.className = "sub"; sub.textContent = `곡 ${pl.songs.length}개`;
        meta.append(t, sub);
        li.appendChild(meta);
        const already = pl.songs.some((s) => sameSong(s, pendingSaveSong));
        const mark = document.createElement("span"); mark.className = "pick-check"; mark.textContent = already ? "✓" : "+";
        li.appendChild(mark);
        li.onclick = () => {
          const r = addSongToPlaylist(pl.id, pendingSaveSong);
          if (r === "dup") toast("이미 담겨 있어요");
          else toast(`'${pl.name}'에 담았어요 📔`);
          closeSaveSheet();
        };
        list.appendChild(li);
      });
    }
    $("saveSheet").hidden = false;
  }
  function closeSaveSheet() { $("saveSheet").hidden = true; pendingSaveSong = null; }

  $("saveSheetClose").addEventListener("click", closeSaveSheet);
  $("saveSheet").addEventListener("click", (e) => { if (e.target === $("saveSheet")) closeSaveSheet(); });
  $("savePickNewForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("savePickNewName").value.trim();
    if (!name) { toast("이름을 입력해 주세요"); return; }
    const pl = createPlaylist(name);
    $("savePickNewName").value = "";
    if (pendingSaveSong) {
      addSongToPlaylist(pl.id, pendingSaveSong);
      toast(`'${pl.name}'에 담았어요 📔`);
      closeSaveSheet();
    } else {
      renderScrapbook();
    }
  });

  $("openScrapbook").addEventListener("click", () => { renderScrapbook(); showScreen("scrapbook"); });
  $("newPlaylistForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("newPlaylistName").value.trim();
    if (!name) { toast("이름을 입력해 주세요"); return; }
    createPlaylist(name);
    $("newPlaylistName").value = "";
    renderScrapbook();
    toast("플레이리스트를 만들었어요");
  });

  // ---------- 네비게이션 ----------
  navBack.addEventListener("click", () => {
    if (currentScreen === "settings") { showScreen(prevScreen === "settings" ? "search" : prevScreen); return; }
    if (currentScreen === "result") { showScreen("search"); renderLists(); return; }
    if (currentScreen === "confirm") { showScreen("search"); return; }
    if (currentScreen === "scrapbook") { showScreen("search"); renderLists(); return; }
    if (currentScreen === "playlist") { renderScrapbook(); showScreen("scrapbook"); return; }
    showScreen("search");
  });
  navSettings.addEventListener("click", () => { initSettingsScreen(); showScreen("settings"); });

  // ---------- 초기화 ----------
  function init() {
    if (!load(LS.model, null)) store(LS.model, DEFAULT_MODEL);
    // 1회 마이그레이션: 느린 Opus 기본값을 Sonnet 균형으로 전환(설정에서 되돌릴 수 있음)
    if (!load("uke_migrated_v2", null)) {
      if (load(LS.model, null) === "claude-opus-4-6") {
        store(LS.model, "claude-sonnet-4-6");
        setTimeout(() => toast("속도 개선: 모델을 Sonnet 4.6으로 바꿨어요 (설정에서 변경 가능)"), 600);
      }
      store("uke_migrated_v2", "1");
    }
    renderLists();
    showScreen("search");
    if (!getApiKey()) {
      // 첫 방문 안내
      setTimeout(() => toast("설정(⚙)에서 API 키를 먼저 입력해 주세요"), 400);
    }
  }
  init();
})();
