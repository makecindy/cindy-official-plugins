import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => fs.readFile(path.join(root, name));
const manifest = JSON.parse(await read("asset-manifest.json"));
const submission = JSON.parse(await read("submission.json"));
const expectedUploads = [
  "assets/store-icon-128.png",
  ...Array.from({ length: 5 }, (_, i) => `screenshots/en-${i + 1}.png`),
  "assets/promo-small.png",
  "assets/promo-marquee.png",
];
assert.deepEqual(submission.assets, expectedUploads);
assert.deepEqual(manifest.uploadedAssets, expectedUploads);
for (const asset of manifest.assets) {
  const bytes = await read(asset.file);
  assert.equal(
    bytes.subarray(0, 8).toString("hex"),
    "89504e470d0a1a0a",
    asset.file,
  );
  assert.equal(bytes.readUInt32BE(16), asset.width, asset.file);
  assert.equal(bytes.readUInt32BE(20), asset.height, asset.file);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    asset.sha256,
    asset.file,
  );
  if (asset.file.startsWith("screenshots/")) {
    assert.deepEqual([asset.width, asset.height], [1280, 800], asset.file);
  }
  if (
    asset.file.startsWith("screenshots/") ||
    asset.file.startsWith("assets/promo-")
  ) {
    assert.equal(bytes[24], 8, asset.file);
    assert.equal(
      bytes[25],
      2,
      `${asset.file}: upload PNG must be RGB, without alpha`,
    );
  }
}
for (const file of expectedUploads) {
  assert(
    manifest.assets.some((asset) => asset.file === file),
    `Missing manifest entry: ${file}`,
  );
}
const description = (await read(submission.descriptionFile))
  .toString()
  .trimEnd();
const english = (await read("copy/en-description.txt")).toString().trim();
const chinese = (await read("copy/zh-CN-description.txt")).toString().trim();
assert.equal(description, `${english}\n\n—— 简体中文 ——\n\n${chinese}`);
assert(description.length <= 16000);
for (const locale of ["en", "zh-CN"]) {
  assert(
    (await read(`copy/${locale}-summary.txt`)).toString().trim().length <= 132,
  );
}
const gallery = (await read("index.html")).toString();
for (const [, link] of gallery.matchAll(/(?:src|href)="([^"]+)"/g)) {
  if (!link.startsWith("#") && !/^[a-z]+:/i.test(link))
    await fs.access(path.join(root, link));
}
console.log(
  `Verified ${manifest.assets.length} PNGs, uploaded set, bilingual copy and gallery links.`,
);
