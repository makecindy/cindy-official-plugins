HTML parser bundle

Pinned parse5 7.3.0 + entities 6.0.1, built with esbuild 0.25.12.
Upstream: https://github.com/inikulin/parse5 and https://github.com/fb55/entities
Licenses and npm archive integrity: ../THIRD-PARTY-LICENSES.txt.
Entry: export { parse } from "parse5";
Build: esbuild entry.mjs --bundle --platform=browser --format=iife --global-name=PodcastHtmlParser --target=es2020 --minify --legal-comments=inline
Append: if(typeof module!=="undefined")module.exports=PodcastHtmlParser;
SHA-256: b818f5fb62c9bd6bf7d22f5c4dd280c1c8b5937365aa1b2215ccf85225fa9f11
This is a parser bundle, not an executable service; it does not fetch URLs or execute HTML scripts.
