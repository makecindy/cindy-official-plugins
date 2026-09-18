"use strict";
const juice = require("juice/client");
const serialize = require("dom-serializer").default;
const { load } = require("cheerio");
// Card previews have no network authority. Preserve layout/colors but reject
// resource-bearing CSS (including escaped spellings), and only embed raster data.
function safeStyle(style = "") {
  const functions = new Set(["rgb", "rgba", "hsl", "hsla", "hwb", "lab", "lch", "oklab", "oklch", "calc", "min", "max", "clamp", "linear-gradient", "radial-gradient", "conic-gradient", "repeating-linear-gradient", "repeating-radial-gradient", "cubic-bezier", "steps", "translate", "translatex", "translatey", "scale", "rotate"]);
  return style.split(";").filter((declaration) => {
    const match = /^\s*([a-z-]+)\s*:\s*(.+)$/i.exec(declaration);
    if (!match || match[1].startsWith("--")) return false;
    const value = match[2];
    return /^[a-z0-9\s#%.,()+*/!'"-]+$/i.test(value) &&
      !value.includes("/*") &&
      [...value.matchAll(/([a-z-]+)\s*\(/gi)].every((m) => functions.has(m[1].toLowerCase()));
  }).join(";");
}
// Inline selectors before Cindy removes classes/ids. No scripts or remote fetches.
module.exports = function preview(html) {
  const $ = load(html);
  $("script,iframe,object,embed,link").remove();
  $("*").each((_, el) => {
    for (const name of Object.keys(el.attribs || {}))
      if (/^on|^data-ghost-/i.test(name)) $(el).removeAttr(name);
  });
  const styled = load(
    juice($.html(), {
      removeStyleTags: true,
      preserveMediaQueries: false,
      preserveFontFaces: false,
      preserveKeyFrames: false,
      resolveCSSVariables: true,
      applyWidthAttributes: false,
      applyHeightAttributes: false,
    }),
  );
  styled("style,script").remove();
  // Preserve inherited body/root styling without affecting the card controls.
  const body = styled("body"),
    root = styled("html");
  const content = body.length ? body.html() : styled.root().html();
  const wrapper = styled("<div></div>")
    .attr(
      "style",
      (root.attr("style") || "") +
        ";" +
        (body.attr("style") || "") +
        ";margin:0;min-height:460px;overflow:hidden",
    )
    .html(content || "");
  // Unsupported semantic shells would lose their inline style in card sanitization.
  wrapper.find("nav,main,article,aside,label").each((_, el) => {
    el.name = "div";
    el.tagName = "div";
  });
  wrapper.find("*").addBack().each((_, el) => {
    const element = styled(el);
    if (element.attr("style")) element.attr("style", safeStyle(element.attr("style")));
    const src = element.attr("src");
    if (src && (el.name !== "img" || !/^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(src)))
      element.removeAttr("src");
    for (const name of Object.keys(el.attribs || {}))
      if (
        ![
          "style",
          "src",
          "alt",
          "width",
          "height",
          "colspan",
          "rowspan",
        ].includes(name)
      )
        styled(el).removeAttr(name);
  });
  // Keep a complete DOM under the 32KB card budget, never truncate HTML/CSS text.
  while (
    Buffer.byteLength(
      serialize(wrapper.toArray(), { encodeEntities: "utf8" }),
      "utf8",
    ) > 26000
  ) {
    const last = wrapper.find("*").last();
    if (!last.length) {
      // Root attributes or direct text may themselves exceed the byte budget.
      // A fixed valid preview also handles entity expansion and multibyte text.
      return '<div style="padding:24px">…</div>';
    }
    last.remove();
  }
  return serialize(wrapper.toArray(), { encodeEntities: "utf8" });
};
