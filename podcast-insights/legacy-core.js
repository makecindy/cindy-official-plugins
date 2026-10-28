(function (root) {
  "use strict";
  const fail = (code) => {
    throw Object.assign(new Error(code), { code });
  };
  const string = (v, max = 2000000) => {
    if (typeof v !== "string" || !v.trim() || v.length > max)
      fail("INVALID_INPUT");
    return v.trim();
  };
  function url(v, base) {
    let u;
    try {
      u = new URL(string(v, 4000), base);
    } catch {
      fail("INVALID_URL");
    }
    if (u.protocol !== "https:" || u.username || u.password)
      fail("INVALID_URL");
    return u.href;
  }
  const escape = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  function time(v) {
    if (v == null) return "—";
    const s = Math.floor(v);
    return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60]
      .map((x) => String(x).padStart(2, "0"))
      .join(":");
  }
  const htmlParser = typeof module !== 'undefined' ? require('./vendor/html-parser.js') : root.PodcastHtmlParser;
  const decodeVtt = value => value.replace(/&(amp|lt|gt|nbsp|lrm|rlm);/g, (_, name) =>
    ({amp:'&',lt:'<',gt:'>',nbsp:'\u00a0',lrm:'\u200e',rlm:'\u200f'})[name]);
  function decode(v) {
    return v
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) => {
        const c = n[0].toLowerCase() === "x" ? parseInt(n.slice(1), 16) : +n;
        return c > 0 && c <= 0x10ffff ? String.fromCodePoint(c) : "";
      })
      .replace(
        /&(amp|lt|gt|quot|apos);/g,
        (_, n) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[n],
      );
  }
  function feed(xml, source) {
    string(xml, 20000000);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) fail("UNSAFE_XML");
    if (
      typeof DOMParser !== "undefined" &&
      new DOMParser()
        .parseFromString(xml, "application/xml")
        .querySelector("parsererror")
    )
      fail("INVALID_FEED");
    const tag = (s, n) =>
      decode(
        (s.match(
          new RegExp("<" + n + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + n + ">", "i"),
        ) || [, ""])[1],
      ).trim();
    const attrs = (s) =>
      Object.fromEntries(
        Array.from(s.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g), (m) => [
          m[1],
          decode(m[2]),
        ]),
      );
    const items = Array.from(
      xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi),
      (m) => m[2],
    );
    if (!/<(?:rss|feed)(?:\s|>)/i.test(xml)) fail("INVALID_FEED");
    const safe = (v) => {
      try {
        return v ? url(v, source) : "";
      } catch {
        return "";
      }
    };
    return {
      title: tag(xml.split(/<(?:item|entry)(?:\s|>)/i)[0], "title") || source,
      truncated: items.length > 100,
      episodes: items
        .slice(0, 100)
        .map((s) => {
          const en = attrs(
              (s.match(/<enclosure\b[^>]*>/i) ||
                s.match(/<link\b[^>]*rel=["']enclosure["'][^>]*>/i) || [""])[0],
            ),
            tr = attrs((s.match(/<podcast:transcript\b[^>]*>/i) || [""])[0]);
          const link =
            tag(s, "link") ||
            attrs((s.match(/<link\b[^>]*>/i) || [""])[0]).href;
          return {
            title: tag(s, "title") || "Untitled",
            guid: tag(s, "guid") || tag(s, "id") || en.url || en.href || link,
            audio_url: safe(en.url || en.href),
            source_url: safe(link),
            transcript_url: safe(tr.url),
            transcript_type: tr.type || "",
          };
        })
        .filter((e) => e.guid),
    };
  }
  function normalize(rows, identity = "provided") {
    if (Array.isArray(rows) && rows.length > 20000) fail("TRANSCRIPT_SEGMENT_LIMIT");
    if (!Array.isArray(rows) || !rows.length)
      fail("INVALID_TRANSCRIPT");
    // Split long source text before per-row validation. Keep its supplied
    // interval for each chunk; never invent timing within an utterance.
    rows = rows.flatMap(r => {
      const text = string(r.text, 5 * 1024 * 1024), chunks = [];
      for (let i = 0; i < text.length;) {
        let end = Math.min(text.length, i + 12000);
        if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) end--;
        chunks.push({...r, text:text.slice(i, end)});i = end;
      }
      return chunks;
    });
    return rows.map((r, index) => {
      const text = r.text,
        start = r.start == null ? null : +r.start,
        end = r.end == null ? null : +r.end;
      if (
        (start == null && end != null) ||
        (start != null &&
          (!Number.isFinite(start) ||
            (end != null && !Number.isFinite(end)) ||
            start < 0 ||
            (end != null && end < start)))
      )
        fail("INVALID_TIME");
      return {
        index,
        text,
        start,
        end,
        speaker: typeof r.speaker === "string" ? r.speaker.slice(0, 100) : null,
        speaker_status: r.speaker ? identity : "unknown",
        time_status:
          start == null ? "untimed" : end == null ? "start_only" : "interval",
      };
    });
  }
  function htmlTranscript(content) {
    // Parse a detached HTML tree: no DOM insertion, resource loading or script execution.
    // The standard tokenizer handles plaintext and script escaped states, not tag regexes.
    const doc = htmlParser.parse(content, {scriptingEnabled:true});
    const excluded = new Set(['template','script','style','textarea','title','xmp','iframe','noembed','noframes','noscript','plaintext']);
    const hidden = node => excluded.has(node.tagName) || (node.namespaceURI && node.namespaceURI !== 'http://www.w3.org/1999/xhtml');
    const pushChildren=(stack,node)=>{const children=node.childNodes || [];for(let i=children.length-1;i>=0;i--)stack.push(children[i]);};
    const plainText = parent => {
      const parts=[], stack=[];pushChildren(stack,parent);
      while(stack.length){const node=stack.pop();if(hidden(node))continue;
        if(node.nodeName==='#text')parts.push(node.value);
        else if(node.tagName==='br')parts.push('\n');
        else pushChildren(stack,node);
      }
      return parts.join('').trim();
    };
    let speaker=null, hasCite=false, hasParagraph=false;
    const rows=[], stack=[doc];
    while(stack.length){const node=stack.pop();if(hidden(node))continue;
      if(node.tagName==='cite'){hasCite=true;speaker=plainText(node).replace(/:\s*$/, '');}
      else if(node.tagName==='p'){
        hasParagraph=true;
        const plain=plainText(node),stamp=plain.match(/^\\?\[((?:\d+:)?\d{2}:\d{2})\\?\]\s*/);
        const text=stamp?plain.slice(stamp[0].length):plain;
        if(text)rows.push({text,speaker,start:stamp?stamp[1].split(':').map(Number).reduce((a,n)=>a*60+n,0):null,end:null});
      }
      pushChildren(stack,node);
    }
    if(!hasCite || !hasParagraph)fail('UNSUPPORTED_HTML_TRANSCRIPT');
    return normalize(rows);
  }
  function transcript(content, format) {
    string(content, 5 * 1024 * 1024);
    if (format === "json") {
      let j;
      try {
        j = JSON.parse(content);
      } catch {
        fail("INVALID_TRANSCRIPT");
      }
      return normalize(Array.isArray(j) ? j : j.segments);
    }
    if (format === "txt")
      return normalize(
        content
          .split(/\n\s*\n/)
          .filter(Boolean)
          .map((text) => ({ text })),
      );
    if (format === "html") return htmlTranscript(content);
    if (!["srt", "vtt"].includes(format)) fail("INVALID_TRANSCRIPT");
    const stamp = (s) =>
        s
          .replace(",", ".")
          .split(":")
          .map(Number)
          .reduce((a, x) => a * 60 + x, 0),
      lines = content.replace(/\r/g, "").split("\n"),
      rows = [];
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(
        /^\s*((?:\d+:)?\d{2}:\d{2}[.,]\d{3})\s*-->\s*((?:\d+:)?\d{2}:\d{2}[.,]\d{3})(?:\s.*)?$/,
      );
      if (!m) continue;
      const text = [];
      while (++i < lines.length && lines[i].trim()) text.push(lines[i]);
      const joined = text.join("\n"),
        voice = joined.match(/<v(?:\.[^ >]+)?\s+([^>]+)>/);
      rows.push({
        start: stamp(m[1]),
        end: stamp(m[2]),
        text: (format === "vtt" ? decodeVtt : decode)(joined.replace(/<[^>]*>/g, "")),
        speaker: voice ? (format === "vtt" ? decodeVtt : decode)(voice[1]) : null,
      });
    }
    return normalize(rows);
  }
  function cloud(result) {
    const utterances = result.utterances?.length
        ? result.utterances
        : [{ words: result.words, speaker: null }],
      rows = [];
    for (const u of utterances) {
      if (
        u.text &&
        u.text.length <= 600 &&
        Number.isFinite(u.start) &&
        Number.isFinite(u.end) &&
        u.end - u.start <= 60000
      ) {
        rows.push({
          text: u.text,
          start: u.start / 1000,
          end: u.end / 1000,
          speaker: u.speaker == null ? null : String(u.speaker),
        });
        continue;
      }
      if (!u.words?.length) {
        if (u.text)
          rows.push({
            text: u.text,
            start: u.start / 1000,
            end: u.end / 1000,
            speaker: u.speaker == null ? null : String(u.speaker),
          });
        continue;
      }
      let part = [];
      const flush = () => {
        if (part.length)
          rows.push({
            text: part
              .map((w) => w.text)
              .join(result.language_code === "zh" ? "" : " "),
            start: part[0].start / 1000,
            end: part.at(-1).end / 1000,
            speaker: u.speaker == null ? null : String(u.speaker),
          });
        part = [];
      };
      for (const w of u.words) {
        if (
          part.length &&
          (w.end - part[0].start > 60000 ||
            part.map((x) => x.text).join(" ").length + w.text.length > 600)
        )
          flush();
        part.push(w);
      }
      flush();
    }
    if (!rows.length && result.text)
      return normalize([{ text: result.text }], "anonymous");
    return normalize(rows, "anonymous");
  }
  function tokens(q) {
    const s = q.toLowerCase();
    return Array.from(
      new Set([
        ...(s.match(/[a-z0-9]+/g) || []),
        ...Array.from(s.matchAll(/[\u3400-\u9fff]+/g)).flatMap((m) =>
          m[0].length === 1
            ? [m[0]]
            : Array.from({ length: m[0].length - 1 }, (_, i) =>
                m[0].slice(i, i + 2),
              ),
        ),
      ]),
    );
  }
  function rank(rows, queries) {
    const terms = Array.from(new Set(queries.flatMap(tokens)));
    if (!terms.length) fail("INVALID_QUERY");
    return rows
      .map((r) => ({
        ...r,
        score: terms.reduce(
          (n, t) => n + (r.text.toLowerCase().includes(t) ? 1 : 0),
          0,
        ),
      }))
      .filter((r) => r.score)
      .sort((a, b) => b.score - a.score || a.index - b.index);
  }
  function validateBrief(claims, evidence) {
    if (!Array.isArray(claims) || !claims.length || claims.length > 50)
      fail("INVALID_BRIEF");
    return claims.map((c) => {
      const statement = string(c.statement, 2000);
      if (
        ![
          "summary",
          "agreement",
          "disagreement",
          "single",
          "uncertain",
        ].includes(c.kind)
      )
        fail("INVALID_BRIEF");
      if (
        !Array.isArray(c.references) ||
        !c.references.length ||
        c.references.length > 12
      )
        fail("MISSING_EVIDENCE");
      const refs = c.references.map((ref) => {
        const e = evidence.get(ref.evidence_id);
        if (
          !e ||
          typeof ref.quote !== "string" ||
          !ref.quote.trim() ||
          !e.text.includes(ref.quote)
        )
          fail("QUOTE_MISMATCH");
        return { ...e, quote: ref.quote };
      });
      if (
        ["agreement", "disagreement"].includes(c.kind) &&
        new Set(refs.map((r) => r.show_id)).size < 2
      )
        fail("NEED_TWO_SHOWS");
      return {
        statement,
        kind: c.kind,
        references: refs,
        validation: "exact_quote_only; interpretation_requires_review",
      };
    });
  }
  const api = {
    fail,
    string,
    url,
    escape,
    time,
    feed,
    normalize,
    transcript,
    cloud,
    tokens,
    rank,
    validateBrief,
  };
  if (typeof module !== "undefined") module.exports = api;
  else root.PodcastCore = api;
})(globalThis);
