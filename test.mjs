/* 터미널에서 실제 AI 동작 확인용 스크립트
 *
 * 사용법:
 *   1) .env.local 에 키 넣기:   ANTHROPIC_API_KEY=sk-ant-...
 *   2) node test.mjs                      → 기본 곡(아이유 - 밤편지)
 *      node test.mjs "아이유" "밤편지"     → 가수/곡명 직접 지정
 *
 * 브라우저 앱(app.js)과 동일한 프롬프트를 사용한다.
 */
import { readFileSync } from "node:fs";

// ---------- .env.local 로드 (의존성 없이 직접 파싱) ----------
function loadEnvLocal() {
  try {
    const raw = readFileSync(new URL("./.env.local", import.meta.url), "utf8");
    for (const line of raw.split("\n")) {
      const s = line.trim();
      if (!s || s.startsWith("#")) continue;
      const eq = s.indexOf("=");
      if (eq === -1) continue;
      const key = s.slice(0, eq).trim();
      let val = s.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch (_) {
    /* .env.local 없으면 환경변수만 사용 */
  }
}
loadEnvLocal();

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.MODEL || "claude-opus-4-6";

if (!API_KEY || API_KEY.includes("여기에")) {
  console.error("\n❌ API 키가 없습니다.");
  console.error("   .env.local 파일에 다음을 넣어주세요:");
  console.error("   ANTHROPIC_API_KEY=sk-ant-...\n");
  console.error("   (예시:  cp .env.local.example .env.local  후 키 입력)\n");
  process.exit(1);
}

// ---------- API 호출 (앱과 동일 로직: 웹검색 도구 사용) ----------
async function callClaude(system, user, opts = {}) {
  const tools = opts.useSearch
    ? [
        { type: "web_search_20260209", name: "web_search", max_uses: opts.maxUses || 2, allowed_callers: ["direct"] },
        { type: "web_fetch_20260209", name: "web_fetch", max_uses: opts.maxUses || 2, allowed_callers: ["direct"] },
      ]
    : undefined;
  let messages = [{ role: "user", content: user }];
  let last = null;

  for (let step = 0; step < 6; step++) {
    const body = { model: MODEL, max_tokens: opts.maxTokens || 8000, system, messages };
    if (tools) body.tools = tools;
    if (opts.effort && !/haiku/i.test(MODEL)) body.output_config = { effort: opts.effort };
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let detail = "";
      try { const j = await res.json(); detail = j.error?.message || ""; } catch (_) {}
      throw new Error(`HTTP ${res.status} ${detail}`);
    }
    last = await res.json();
    // 검색 도중 멈추면(pause_turn) 이어서 재요청
    if (last.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: last.content });
      process.stdout.write("  …검색 중…\n");
      continue;
    }
    break;
  }
  const texts = (last?.content || []).filter((b) => b.type === "text").map((b) => b.text);
  return texts.length ? texts[texts.length - 1] : "";
}

function parseJson(text) {
  let t = (text || "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  try { return JSON.parse(t); } catch (_) {}
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a !== -1 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error("JSON 파싱 실패:\n" + text.slice(0, 300));
}

// ---------- 프롬프트 (app.js와 동일) ----------
async function identifySong(artist, title) {
  const system =
    "너는 음악 검색 도우미다. 사용자가 입력한 가수/곡명(오타·약칭·한글영어 혼용 가능)으로 실제 곡을 특정한다. " +
    "반드시 web_search 도구로 실제 존재 여부를 확인하라. 인디·마이너 곡일수록 검색으로 확인하는 것이 중요하다. " +
    "검색으로 곡을 확인하면 found=true 와 함께 검색으로 확인된 정확한 표기를 채운다. " +
    "검색해도 곡을 특정할 수 없으면 found=false. 절대 없는 곡을 지어내지 마라. " +
    '최종 출력은 JSON 한 개뿐(설명·코드펜스 금지): {"found": boolean, "title": "정확한 곡명", "artist": "정확한 가수명", "year": "발매연도 또는 빈 문자열", "note": "앨범 등 짧은 참고(선택)"}';
  const user = `가수: ${artist || "(미입력)"}\n곡명: ${title || "(미입력)"}\n이 곡을 빠르게 특정해줘.`;
  return parseJson(await callClaude(system, user, { maxTokens: 700, useSearch: true, effort: "low", maxUses: 1 }));
}

async function generateChords(artist, title) {
  const system =
    "너는 숙련된 우쿨렐레 연주자이자 편곡자다. 가수·곡명은 확정된 곡이다. 목표는 실제 코드 악보를 찾아 전사하는 것이며, 못 찾으면 정직하게 추정으로 표시한다.\n" +
    "[알고리즘]\n" +
    "STEP 1 (검색) web_search로 '[가수] [곡명] 코드'/'chords'/'기타 코드 가사' — 코드가 가사와 함께 실린 페이지 URL을 찾는다(스니펫만으로 단정 금지).\n" +
    "STEP 2 (열람) 후보 URL을 web_fetch로 직접 열어 본문에서 코드가 가사에 정렬된 실제 차트를 확인한다(코드사이트·tistory/naver 블로그·Ultimate Guitar 등).\n" +
    "STEP 3 (전사) 실제 차트의 코드 진행·정렬을 그대로 옮긴다. 각 코드를 해당 음절 '앞'에 [코드]로(단어 중간 가능, 줄 맨 앞에 몰지 말 것). 모든 변화 보존.\n" +
    "STEP 4 (출처 3단계, 정직): transcribed=가사정렬된 실제 차트의 코드+배치 그대로 / chords_verified=실제 코드는 확인했으나(예: Chordify 코드나열) 가사 배치는 추정 / derived=코드까지 이론 추정. 등급 부풀리기 금지.\n" +
    "[화성 리듬·배치추정] 코드는 한 마디(4박)마다 바뀜. 한 줄 3~5개 일반적. 반복 루프를 마디 단위로 가사에 얹는다.\n" +
    "[규칙] 코드명 기타=우쿨렐레 동일(운지만 GCEA)·key/capo 원본대로.\n" +
    "[형식] 구간 분할, 각 줄 인라인 대괄호. 코드 운지 frets [G,C,E,A] 0=개방 -1=뮤트. source 정직, sourceUrl 포함.\n" +
    "특정 못 하면 {\"notFound\": true}. [엄수] 설명·머리말·펜스 금지. 첫 문자 '{' 마지막 '}'. JSON 객체 하나만. 형식:\n" +
    '{"title":"","artist":"","key":"조","capo":0,"source":"transcribed|chords_verified|derived","sourceUrl":"",' +
    '"chords":[{"name":"C","frets":[0,0,0,3]}],' +
    '"sections":[{"label":"Verse 1","lines":["[C]가사 한 줄","..."]}]}\n' +
    "가사가 비는 줄은 빈 문자열.";
  const user = `확정된 곡 — 가수: ${artist} / 곡명: ${title}\nweb_search로 코드 페이지를 찾고 web_fetch로 직접 열어 실제 코드 확인. 가사정렬 차트면 transcribed, 코드만 있으면 chords_verified, 못 찾으면 derived. 설명 없이 JSON만.`;
  return parseJson(await callClaude(system, user, { maxTokens: 8000, useSearch: true, effort: "high", maxUses: 4 }));
}

// ---------- 콘솔 렌더링 ----------
function renderLineToConsole(line) {
  // "[C]사랑[G]했던" → 코드줄 / 가사줄 2줄
  const re = /\[([^\]]+)\]/g;
  let chordLine = "", lyricLine = "", last = 0, m, pending = "";
  function push(text) {
    if (pending) {
      // 코드를 현재 가사 위치에 정렬
      while (chordLine.length < lyricLine.length) chordLine += " ";
      chordLine += pending + " ";
      pending = "";
    }
    lyricLine += text;
  }
  while ((m = re.exec(line)) !== null) {
    push(line.slice(last, m.index));
    pending = m[1];
    last = re.lastIndex;
  }
  push(line.slice(last));
  return (chordLine.trimEnd() ? chordLine.trimEnd() + "\n" : "") + lyricLine;
}

function chordShape(frets) {
  if (!Array.isArray(frets)) return "";
  return "G C E A = " + frets.map((f) => (f === -1 ? "x" : f)).join(" ");
}

// ---------- 실행 ----------
const artist = process.argv[2] || "아이유";
const title = process.argv[3] || "밤편지";

console.log(`\n🎸 모델: ${MODEL}`);
console.log(`🔎 검색: ${artist} - ${title}\n`);

try {
  console.log("① 곡 식별 중…");
  const id = await identifySong(artist, title);
  if (!id.found) {
    console.log("   ⚠️  곡을 찾지 못했습니다. 표기를 바꿔보세요.");
    process.exit(0);
  }
  console.log(`   ✅ ${id.title} — ${id.artist}${id.year ? " (" + id.year + ")" : ""}`);
  if (id.note) console.log("      " + id.note);

  console.log("\n② 코드 악보 생성 중…");
  const data = await generateChords(id.artist, id.title);

  console.log("\n" + "═".repeat(48));
  console.log(`  ${data.title}  —  ${data.artist}`);
  const keybits = [];
  if (data.key) keybits.push(data.key);
  if (data.capo > 0) keybits.push("카포 " + data.capo);
  if (keybits.length) console.log("  " + keybits.join(" · "));
  const srcLabel = data.source === "transcribed" ? "✅ 실제 악보 전사(코드·배치)"
    : data.source === "chords_verified" ? "🟡 코드는 실제 확인 · 배치는 추정"
    : "⚠️ AI 추정 (코드·배치 모두)";
  console.log("  출처: " + srcLabel + (data.sourceUrl ? " " + data.sourceUrl : ""));
  console.log("═".repeat(48));

  if (Array.isArray(data.chords) && data.chords.length) {
    console.log("\n[ 사용된 코드 ]");
    data.chords.forEach((c) => console.log(`  ${(c.name || "").padEnd(6)} ${chordShape(c.frets)}`));
  }

  (data.sections || []).forEach((sec) => {
    console.log("\n— " + (sec.label || "") + " —");
    (sec.lines || []).forEach((l) => {
      if (!l || !l.trim()) { console.log(""); return; }
      console.log(renderLineToConsole(l));
    });
  });

  console.log("\n" + "═".repeat(48));
  console.log("✅ 성공! 브라우저 앱도 동일하게 동작합니다.\n");
} catch (e) {
  console.error("\n❌ 오류:", e.message);
  if (String(e.message).includes("401")) console.error("   → API 키가 올바른지 확인하세요.");
  if (String(e.message).includes("404")) console.error("   → 모델 ID를 확인하세요(.env.local의 MODEL).");
  process.exit(1);
}
