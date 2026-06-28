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
