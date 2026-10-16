// SPDX-License-Identifier: MIT
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const s = require('../lib/private-build');
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'synthetic-private-build-')));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('external storage accepts local output and rejects escape', () => {
  assert.equal(s.externalRoot(root), fs.realpathSync(root));
  assert.equal(s.privatePath(root, path.join(root, 'out/book.pdf')), path.join(root, 'out/book.pdf'));
  assert.throws(() => s.privatePath(root, path.join(root, '../escape.pdf')));
});
test('repository and symlink destinations fail closed', () => {
  const repo = path.join(root, 'repo'); fs.mkdirSync(repo); fs.mkdirSync(path.join(repo, '.git'));
  assert.throws(() => s.externalRoot(repo));
  const link = path.join(root, 'link'); fs.symlinkSync(repo, link);
  assert.throws(() => s.privatePath(root, path.join(link, 'book.pdf')));
});
test('remote images and executable raw markup are rejected', () => {
  const image = url => ({ t: 'Image', c: [[], [], [url, '']] });
  for (const url of ['https://example.invalid/a.jpg', '//example.invalid/a.jpg', 'file:///tmp/a.jpg', 'https%3A//example.invalid/a.jpg']) {
    assert.throws(() => s.checkAst(image(url), root, root));
  }
  assert.throws(() => s.checkAst({ t: 'RawBlock', c: ['latex', 'synthetic'] }, root, root));
  assert.throws(() => s.checkAst({ meta: { 'cover-image': {t: 'MetaString', c: 'https://example.invalid/image.png'} } }, root, root));
});
test('ordinary link data is accepted without opening a connection', () => {
  assert.doesNotThrow(() => s.checkAst({ t: 'Link', c: [[], [], ['https://example.invalid', '']] }, root, root));
});
test('long unbreakable tokens are rejected, ordinary prose survives', () => {
  assert.throws(() => s.checkAst({ t: 'Str', c: 'N'.repeat(65) }, root, root));
  assert.doesNotThrow(() => s.checkAst({ t: 'Str', c: 'Synthetic harbour.' }, root, root));
});
test('synthetic label cannot exempt arbitrary bytes', () => {
  const fake = path.join(root, 'fake.md'); fs.writeFileSync(fake, '# Synthetic only\n');
  assert.throws(() => s.syntheticInput(path.resolve(__dirname, '..'), fake));
});
test('gutter boundaries follow actual final page count', () => {
  for (const [pages, expected] of [[150,.375],[151,.5],[300,.5],[301,.625],[500,.625],[501,.75],[700,.75],[701,.875],[828,.875]]) assert.equal(s.gutterForPages(pages), expected);
  for (const invalid of [0,-1,829,5.5,NaN]) assert.throws(() => s.gutterForPages(invalid));
});


test('companions reject symlinks, dangling links and existing files without modifying targets', () => {
  for (const suffix of ['.build.log', '.build.json']) {
    for (const dangling of [false, true]) {
      const folder = fs.mkdtempSync(path.join(root, 'companions-'));
      const outside = path.join(root, 'outside-' + path.basename(folder));
      if (!dangling) fs.writeFileSync(outside, 'SYNTHETIC SENTINEL');
      const output = path.join(folder, 'book.epub');
      fs.symlinkSync(outside, output + suffix);
      assert.throws(() => s.reserveArtifacts(folder, output));
      assert.equal(fs.existsSync(output), false);
      if (dangling) assert.equal(fs.existsSync(outside), false);
      else assert.equal(fs.readFileSync(outside, 'utf8'), 'SYNTHETIC SENTINEL');
      assert.equal(fs.lstatSync(output + suffix).isSymbolicLink(), true);
    }
  }
  const folder = fs.mkdtempSync(path.join(root, 'existing-'));
  const output = path.join(folder, 'book.epub');
  fs.writeFileSync(output + '.build.json', 'SYNTHETIC EXISTING RECORD');
  assert.throws(() => s.reserveArtifacts(folder, output));
  assert.equal(fs.readFileSync(output + '.build.json', 'utf8'), 'SYNTHETIC EXISTING RECORD');
  assert.equal(fs.existsSync(output + '.build.log'), false);
});
test('reserved artifact descriptors preserve exclusive ownership and private modes', () => {
  const output = path.join(root, 'exclusive.epub');
  const artifacts = s.reserveArtifacts(root, output);
  s.writeArtifact(artifacts.output, 'SYNTHETIC EPUB');
  s.writeArtifact(artifacts.log, 'a longer old log');
  s.writeArtifact(artifacts.log, 'short');
  s.writeArtifact(artifacts.record, '{}');
  s.closeArtifacts(artifacts, true);
  assert.equal(fs.readFileSync(output, 'utf8'), 'SYNTHETIC EPUB');
  assert.equal(fs.readFileSync(output + '.build.log', 'utf8'), 'short');
  for (const file of [output, output + '.build.log', output + '.build.json']) assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});
