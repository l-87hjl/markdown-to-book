// SPDX-License-Identifier: MIT
// Local path/resource checks. This is not an OS/network security boundary.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

function resolved(candidate) {
  let parent = path.resolve(candidate);
  const tail = [];
  while (!fs.existsSync(parent)) {
    const next = path.dirname(parent);
    if (next === parent) throw new Error('Cannot resolve the selected storage path.');
    tail.unshift(path.basename(parent)); parent = next;
  }
  return path.join(fs.realpathSync(parent), ...tail);
}
function within(root, candidate) {
  const rel = path.relative(resolved(root), resolved(candidate));
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}
function outsideGit(candidate) {
  let current = resolved(candidate);
  if (fs.existsSync(current) && !fs.statSync(current).isDirectory()) current = path.dirname(current);
  for (;;) {
    if (fs.existsSync(path.join(current, '.git'))) throw new Error('Private inputs/outputs must stay outside Git worktrees.');
    const parent = path.dirname(current); if (parent === current) return; current = parent;
  }
}
function externalRoot(candidate) {
  if (!candidate) throw new Error('Set --private-root (or BOOK_PRIVATE_ROOT) to local storage outside Git.');
  const root = resolved(candidate); outsideGit(root);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  return root;
}
function privatePath(root, candidate) {
  const value = resolved(candidate);
  if (!within(root, value)) throw new Error('Selected input/output is outside the private root.');
  outsideGit(value); return value;
}
function syntheticInput(repo, input) {
  const fixtures = JSON.parse(fs.readFileSync(path.join(repo, 'tests/fixtures/manifest.json'), 'utf8'));
  const rel = path.relative(repo, resolved(input)).split(path.sep).join('/');
  const expected = fixtures.files[rel];
  if (!expected || crypto.createHash('sha256').update(fs.readFileSync(input)).digest('hex') !== expected) {
    throw new Error('Synthetic mode accepts only exact reviewed fixture bytes.');
  }
}
function checkAst(ast, root, sourceDir) {
  const controls = ['header-includes', 'include-before', 'include-after', 'cover-image', 'epub-cover-image', 'css', 'bibliography', 'csl', 'reference-doc'];
  if (ast.meta && controls.some(key => Object.hasOwn(ast.meta, key))) throw new Error('Resource/executable metadata controls are disabled; use reviewed local CLI settings.');
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (value.t === 'Image') {
      const target = decodeURIComponent(value.c[2][0]);
      if (/^[a-z][a-z0-9+.-]*:|^[/\\]{2}/i.test(target)) throw new Error('Network/protocol image resources are disabled.');
      const image = privatePath(root, path.resolve(sourceDir, target));
      if (!/\.(png|jpe?g|pdf)$/i.test(image)) throw new Error('Only local PNG/JPEG/PDF image resources are supported.');
      try {
        if (!fs.statSync(image).isFile()) throw new Error();
      } catch { throw new Error('Image resource must be an existing local file (details withheld).'); }
      value.c[2][0] = image; // Renderer uses this exact canonical resource, even after cwd changes.
    }
    if (value.t === 'RawBlock' || value.t === 'RawInline') throw new Error('Raw executable markup is disabled.');
    if (value.t === 'Str' && /[\p{L}\p{N}]{65,}/u.test(value.c)) {
      throw new Error('An unbreakable text token exceeds 64 characters; add explicit break opportunities.');
    }
    if (Array.isArray(value)) value.forEach(visit); else Object.values(value).forEach(visit);
  }
  visit(ast);
}
function checkInputs(files, root, repo, synthetic) {
  for (const file of files) {
    if (!/\.md$/i.test(file)) throw new Error('Manuscript input must be Markdown.');
    if (synthetic) syntheticInput(repo, file); else privatePath(root, file);
  }
  let ast;
  try {
    // The native reader retains shared definitions/metadata and the authored file of each image.
    ast = JSON.parse(execFileSync('pandoc', [...files, '--from', 'markdown+rebase_relative_paths-raw_tex-raw_html-raw_attribute', '--to', 'json'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024,
    }));
  } catch { throw new Error('Cannot parse input with the required local path-rebasing reader (details withheld).'); }
  checkAst(ast, root, process.cwd());
  return ast;
}

function reserveArtifacts(root, output) {
  const artifacts = {};
  try {
    for (const [name, candidate] of Object.entries({ output, log: output + '.build.log', record: output + '.build.json' })) {
      const file = privatePath(root, candidate);
      // O_EXCL rejects existing and dangling symlinks; held descriptors avoid later path following.
      const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
      artifacts[name] = { file, fd, stat: fs.fstatSync(fd) };
    }
    return artifacts;
  } catch {
    closeArtifacts(artifacts, false, false);
    throw new Error('Output or companion already exists or is outside private storage.');
  }
}
function writeArtifact(artifact, content) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  fs.ftruncateSync(artifact.fd, 0);
  for (let offset = 0; offset < bytes.length;) {
    offset += fs.writeSync(artifact.fd, bytes, offset, bytes.length - offset, offset);
  }
}
function closeArtifacts(artifacts, success, keepLog = true) {
  for (const [name, artifact] of Object.entries(artifacts)) {
    fs.closeSync(artifact.fd);
    if (!success && !(keepLog && name === 'log')) {
      try {
        const current = fs.lstatSync(artifact.file);
        if (current.dev === artifact.stat.dev && current.ino === artifact.stat.ino) fs.unlinkSync(artifact.file);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
}

function gutterForPages(count) {
  if (!Number.isInteger(count) || count < 1 || count > 828) throw new Error('PDF page count is outside the supported paperback range.');
  if (count <= 150) return 0.375;
  if (count <= 300) return 0.5;
  if (count <= 500) return 0.625;
  if (count <= 700) return 0.75;
  return 0.875;
}
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
module.exports = { resolved, within, outsideGit, externalRoot, privatePath, syntheticInput, checkAst, checkInputs, gutterForPages, sha256, reserveArtifacts, writeArtifact, closeArtifacts };
