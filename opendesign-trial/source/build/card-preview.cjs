"use strict";
const juice = require("juice/client");
const serialize = require("dom-serializer").default;
const { load } = require("cheerio");
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
  wrapper.find("*").each((_, el) => {
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
    if (!last.length) break;
    last.remove();
  }
  return serialize(wrapper.toArray(), { encodeEntities: "utf8" });
};
