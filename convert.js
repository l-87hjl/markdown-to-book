#!/usr/bin/env node

const { program } = require('commander');
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const safety = require('./lib/private-build');

const TRIM_SIZES = {
  '5x8':     { w: '5in',    h: '8in',    inner: '0.7in',   hcInner: '0.85in',  outer: '0.5in',  top: '0.7in',  bottom: '0.7in'  },
  '5.25x8':  { w: '5.25in', h: '8in',    inner: '0.75in',  hcInner: '0.9in',   outer: '0.5in',  top: '0.7in',  bottom: '0.7in'  },
  '5.5x8.5': { w: '5.5in',  h: '8.5in',  inner: '0.8in',   hcInner: '0.95in',  outer: '0.55in', top: '0.75in', bottom: '0.75in' },
  '6x9':     { w: '6in',    h: '9in',    inner: '0.85in',  hcInner: '1.0in',   outer: '0.6in',  top: '0.8in',  bottom: '0.8in'  },
};

const TEMPLATE_DIR = path.join(__dirname, 'templates');
const FILTER_DIR = path.join(__dirname, 'filters');

program
  .name('book-convert')
  .description('Convert markdown files to KDP-ready books (PDF/EPUB) via Pandoc + LaTeX')
  .argument('<files...>', 'One or more markdown files to convert')
  .option('-o, --output <name>',     'Output filename (extension added automatically)')
  .option('-t, --title <title>',     'Book title')
  .option('-a, --author <author>',   'Author name')
  .option('-s, --subtitle <text>',   'Book subtitle', 'Hard Science Fiction')
  .option('-f, --format <format>',   'Output format: pdf, epub, or all (paperback + hardcover + kindle)', 'all')
  .option('--trim <size>',           `Trim size: ${Object.keys(TRIM_SIZES).join(', ')}`, '5x8')
  .option('--toc',                   'Include table of contents')
  .option('--cover <path>',          'Cover image path (for EPUB)')
  .option('--font-size <pt>',        'Font size: 10pt, 11pt, 12pt', '11pt')
  .option('--private-root <path>', 'External local private input/output root', process.env.BOOK_PRIVATE_ROOT)
  .option('--synthetic-fixture', 'Accept only exact reviewed synthetic fixture inputs')
  .option('--keep-title-heading', 'Do not remove a matching first H1 title')
  .option('--paper-stock <stock>', 'Black-and-white paper stock: cream or white', 'cream')
  .option('--open-right',            'Start chapters on right-hand (odd) pages')
  .option('--year <year>',           'Copyright year', new Date().getFullYear().toString())
  .option('--isbn <isbn>',           'ISBN for copyright page')
  .option('--back-matter <path>',     'JSON file with author info and book list for EPUB back matter')
  .addHelpText('after', `
Examples:
  All 3 formats (paperback PDF + hardcover PDF + Kindle EPUB):
    $ node convert.js chapters/*.md -t "My Book" -a "Jane Smith" --toc

  Paperback PDF only:
    $ node convert.js story.md -f pdf -t "My Story" -a "Jane Smith"

  Kindle EPUB only:
    $ node convert.js story.md -f epub -t "My Story" -a "Jane Smith" --cover cover.jpg

  Multiple files into one book:
    $ node convert.js part-01.md part-02.md -t "Collected Works" -a "Jane Smith" --toc

Set BOOK_PRIVATE_ROOT to explicit local storage outside Git; all private inputs
and outputs must stay within it. See docs/MAINTENANCE.md for current requirements.
Required installed tools: Pandoc, XeLaTeX, Latin Modern OTF files, pdfinfo.
Do not install dependencies automatically.
  `)
  .parse();

const opts = program.opts();
const rawFiles = program.args;
let privateRoot;
try { privateRoot = safety.externalRoot(opts.privateRoot); } catch (error) { console.error(error.message); process.exit(1); }
if (!['10pt', '11pt', '12pt'].includes(opts.fontSize)) { console.error('Font size must be 10pt, 11pt or 12pt.'); process.exit(1); }
if (!['cream', 'white'].includes(opts.paperStock)) { console.error('Invalid paper stock.'); process.exit(1); }
const workDir = fs.mkdtempSync(path.join(privateRoot, '.book-build-'));
process.on('exit', () => fs.rmSync(workDir, { recursive: true, force: true }));

const resolvedFiles = rawFiles
  .map(f => path.resolve(f))
  .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));

for (const f of resolvedFiles) {
  if (!fs.existsSync(f)) {
    console.error('Error: input file not found (path withheld).');
    process.exit(1);
  }
  if (!f.endsWith('.md')) {
    console.error('Error: input must be Markdown (path withheld).');
    process.exit(1);
  }
}

const trim = TRIM_SIZES[opts.trim];
if (!trim) {
  console.error(`Error: invalid trim size "${opts.trim}". Options: ${Object.keys(TRIM_SIZES).join(', ')}`);
  process.exit(1);
}

const validFormats = ['pdf', 'epub', 'all'];
if (!validFormats.includes(opts.format)) {
  console.error(`Error: invalid format "${opts.format}". Options: ${validFormats.join(', ')}`);
  process.exit(1);
}

function commandExists(cmd) {
  try {
    execFileSync('which', [cmd], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

if (!commandExists('pandoc')) {
  console.error('Error: pandoc is not installed.');
  console.error('  Install: https://pandoc.org/installing.html');
  console.error('  Or:      apt install pandoc');
  process.exit(1);
}

function baseName() {
  if (opts.output) return path.resolve(privateRoot, opts.output.replace(/\.\w+$/, ''));
  if (resolvedFiles.length === 1) return path.join(privateRoot, path.basename(resolvedFiles[0], '.md'));
  return path.join(privateRoot, (opts.title || 'book')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, ''));
}

function htmlText(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
function latexText(value) {
  const escaped = { '\\':'\\textbackslash{}', '{':'\\{', '}':'\\}', '$':'\\$', '&':'\\&', '#':'\\#', '%':'\\%', '_':'\\_', '~':'\\textasciitilde{}', '^':'\\textasciicircum{}' };
  return String(value).replace(/[\\{}$&#%_~^]/g, c => escaped[c]);
}
function webLink(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') throw new Error('scheme');
    return htmlText(url.href);
  } catch { throw new Error('Back-matter links must be valid HTTPS data URLs (details withheld).'); }
}

function buildFrontMatterHtml() {
  const title = opts.title || '';
  const author = opts.author || '';
  const subtitle = opts.subtitle || '';
  const year = opts.year || new Date().getFullYear();
  const isbn = opts.isbn || '';

  let html = '';

  html += '<div class="title-page">\n';
  html += '<div class="title-page-block">\n';
  if (title) html += `<p class="tp-title">${htmlText(title.toUpperCase())}</p>\n`;
  html += '<hr class="tp-rule"/>\n';
  if (subtitle) html += `<p class="tp-subtitle">${htmlText(subtitle.toUpperCase())}</p>\n`;
  if (author) html += `<p class="tp-author">${htmlText(author.toUpperCase())}</p>\n`;
  html += '</div>\n';
  html += '</div>\n';

  html += '<div class="copyright-page">\n';
  if (title)  html += `<p><em>${htmlText(title)}</em></p>\n`;
  if (author) html += `<p>Copyright \u00A9 ${htmlText(year)} ${htmlText(author)}</p>\n`;
  html += '<p>All rights reserved.</p>\n';
  html += '<p>No part of this publication may be reproduced, distributed,<br/>\n';
  html += 'or transmitted in any form or by any means without the prior<br/>\n';
  html += 'written permission of the author.</p>\n';
  if (isbn) html += `<p class="isbn">ISBN: ${htmlText(isbn)}</p>\n`;
  html += '</div>\n';

  return html;
}

function loadAlsoBy() {
  if (!opts.backMatter) return null;
  const filePath = safety.privatePath(privateRoot, path.resolve(opts.backMatter));
  if (!fs.existsSync(filePath)) {
    console.error('Error: private back-matter file not found (path withheld).');
    process.exit(1);
  }
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!data.amazonBaseUrls || !data.amazonBaseUrls.bookUrl || !data.amazonBaseUrls.reviewUrl) {
      throw new Error('Missing amazonBaseUrls.bookUrl or amazonBaseUrls.reviewUrl');
    }
    if (!Array.isArray(data.books)) throw new Error('Missing "books" array');
    for (const b of data.books) {
      if (!b.title || !b.asin) throw new Error('Each book needs "title" and "asin"');
    }
    return data;
  } catch (err) {
    console.error('Error: invalid private back-matter data (details withheld).');
    process.exit(1);
  }
}

function buildBackMatterHtml() {
  const data = loadAlsoBy();
  if (!data) return null;

  const title = opts.title || '';
  const author = (data.author && data.author.name) || opts.author || '';
  const authorUrl = (data.author && data.author.url) || '';
  const bookUrl = data.amazonBaseUrls.bookUrl;
  const reviewBase = data.amazonBaseUrls.reviewUrl;

  const currentBook = data.books.find(b => b.title.toLowerCase() === (opts.title || '').toLowerCase());
  const reviewUrl = currentBook ? `${reviewBase}${currentBook.asin}` : '';
  const otherBooks = data.books.filter(b => b.title.toLowerCase() !== (opts.title || '').toLowerCase());

  if (!reviewUrl && otherBooks.length === 0) return null;

  let html = '<div class="back-matter">\n';

  if (title) {
    html += `<p class="bm-title">${htmlText(title.toUpperCase())}</p>\n`;
    html += '<hr class="bm-rule"/>\n';
  }

  if (reviewUrl) {
    html += '<p class="bm-heading">Did You Enjoy This Book?</p>\n';
    html += '<p class="bm-body">Thank you for reading. If you enjoyed this story, ';
    html += 'please consider leaving a ';
    html += `<a href="${webLink(reviewUrl)}">review on Amazon</a>. `;
    html += 'Reviews help other readers discover new books ';
    html += 'and mean a great deal to the author.</p>\n';
  }

  if (otherBooks.length > 0) {
    const heading = author ? `More from ${htmlText(author)}` : 'More from This Author';
    html += `<p class="bm-heading">${heading}</p>\n`;
    html += '<ul class="bm-book-list">\n';
    for (const book of otherBooks) {
      html += `<li><a href="${webLink(bookUrl + encodeURIComponent(book.asin))}">${htmlText(book.title)}</a></li>\n`;
    }
    html += '</ul>\n';
    if (authorUrl) {
      html += '<p class="bm-author-link">Visit the ';
      html += `<a href="${webLink(authorUrl)}">author's page on Amazon</a> `;
      html += 'for the complete catalogue.</p>\n';
    }
  }

  html += '</div>\n';
  return html;
}

function buildPandocArgs(target) {
  const args = [path.join(workDir, 'validated-input.json')];

  const out = safety.privatePath(privateRoot, `${baseName()}${target.suffix}.${target.ext}`);
  fs.mkdirSync(path.dirname(out), { recursive: true, mode: 0o700 });
  args.push('-o', out);
  args.push('--from', 'json');
  if (opts.keepTitleHeading) args.push('-M', 'keep-title-heading=true');
  args.push('--top-level-division=chapter');

  args.push('-M', 'lang=en');
  if (opts.title)    args.push('-M', `title=${opts.title}`);
  if (opts.author)   args.push('-M', `author=${opts.author}`);
  if (opts.subtitle) args.push('-V', `subtitle=${target.ext === 'pdf' ? latexText(opts.subtitle) : opts.subtitle}`);
  if (opts.year)     args.push('-V', `year=${target.ext === 'pdf' ? latexText(opts.year) : opts.year}`);
  if (opts.isbn)     args.push('-V', `isbn=${target.ext === 'pdf' ? latexText(opts.isbn) : opts.isbn}`);

  const sceneFilter = path.join(FILTER_DIR, 'scene-break.lua');
  if (fs.existsSync(sceneFilter)) {
    args.push('--lua-filter', sceneFilter);
  }

  const headingFilter = path.join(FILTER_DIR, 'heading-promote.lua');
  if (fs.existsSync(headingFilter)) {
    args.push('--lua-filter', headingFilter);
  }

  if (opts.toc) args.push('--toc', '--toc-depth=1');

  if (target.ext === 'pdf') {
    const template = path.join(TEMPLATE_DIR, 'kdp-print.tex');
    args.push('--template', template);
    args.push('--pdf-engine=xelatex', '--pdf-engine-opt=-no-shell-escape', '--verbose');
    args.push('-V', `fontsize=${opts.fontSize}`);
    args.push('-V', `paperwidth=${trim.w}`);
    args.push('-V', `paperheight=${trim.h}`);
    args.push('-V', `inner-margin=${target.innerMargin}`);
    args.push('-V', `outer-margin=${trim.outer}`);
    args.push('-V', `top-margin=${trim.top}`);
    args.push('-V', `bottom-margin=${trim.bottom}`);
    if (target.openRight) args.push('-V', 'open-right=true');
  }

  if (target.ext === 'epub') {
    args.push('--epub-title-page=false');
    const css = path.join(TEMPLATE_DIR, 'epub.css');
    if (fs.existsSync(css)) args.push('--css', css);

    const frontMatterHtml = buildFrontMatterHtml();
    const frontMatterFile = path.join(workDir, 'epub-front-matter.html');
    fs.writeFileSync(frontMatterFile, frontMatterHtml);
    args.push('--include-before-body', frontMatterFile);

    if (opts.cover) {
      const coverSrc = safety.privatePath(privateRoot, path.resolve(opts.cover));
      const coverExt = path.extname(coverSrc);
      const safeCover = path.join(workDir, `cover${coverExt}`);
      fs.copyFileSync(coverSrc, safeCover);
      args.push('--epub-cover-image', safeCover);
    }

    const backMatterHtml = buildBackMatterHtml();
    if (backMatterHtml) {
      const backMatterFile = path.join(workDir, 'epub-back-matter.html');
      fs.writeFileSync(backMatterFile, backMatterHtml);
      args.push('--include-after-body', backMatterFile);
    }
  }

  return { args, output: out };
}

function cleanupEpub(epubPath) {
  const frontMatter = buildFrontMatterHtml();
  const backMatter = buildBackMatterHtml();
  const tmpDir = fs.mkdtempSync(path.join(workDir, 'epub-fix-'));

  try {
    execFileSync('unzip', ['-q', '-o', epubPath, '-d', tmpDir], { stdio: 'pipe' });

    const textDir = path.join(tmpDir, 'EPUB', 'text');
    if (!fs.existsSync(textDir)) return;

    const chapterFiles = fs.readdirSync(textDir)
      .filter(f => /^ch\d+\.xhtml$/.test(f))
      .sort();
    const lastChapter = chapterFiles[chapterFiles.length - 1];

    for (const file of chapterFiles) {
      const filePath = path.join(textDir, file);
      let content = fs.readFileSync(filePath, 'utf8');
      const originalLen = content.length;

      content = content.replace(frontMatter, '');
      if (backMatter && file !== lastChapter) {
        content = content.replace(backMatter, '');
      }

      if (content.length !== originalLen) {
        fs.writeFileSync(filePath, content);
      }
    }

    const navPath = path.join(tmpDir, 'EPUB', 'nav.xhtml');
    if (fs.existsSync(navPath)) {
      let nav = fs.readFileSync(navPath, 'utf8');
      const navLen = nav.length;
      if (backMatter) nav = nav.replace(backMatter, '');
      if (nav.length !== navLen) {
        fs.writeFileSync(navPath, nav);
      }
    }

    const absEpub = path.resolve(epubPath);
    fs.unlinkSync(absEpub);
    execFileSync('zip', ['-0', '-X', absEpub, 'mimetype'], { cwd: tmpDir, stdio: 'pipe' });
    execFileSync('zip', ['-r', '-X', absEpub, 'META-INF', 'EPUB'], { cwd: tmpDir, stdio: 'pipe' });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function run(target) {
  let built;
  try { built = buildPandocArgs(target); } catch { console.error('Invalid private build settings (details withheld).'); process.exit(1); }
  const { args, output } = built;

  console.log(`\n  ${target.label}`);
  console.log(`  Input:  ${resolvedFiles.length} file(s)`);
  // Do not echo private titles/authors into public or shared console logs.
  if (target.ext === 'pdf') console.log(`  Trim:   ${opts.trim} (${trim.w} × ${trim.h})`);
  console.log('  Output: private storage');

  let artifacts;
  const rendered = path.join(workDir, `rendered-${target.label.replace(/[^a-z]/gi, '')}.${target.ext}`);
  try {
    artifacts = safety.reserveArtifacts(privateRoot, output);
    let pages = null;
    let inner = parseFloat(target.innerMargin || '0');
    let log = '';
    for (let attempt = 0; attempt < 4; attempt++) {
      const actualArgs = args.map(value => value.startsWith('inner-margin=') ? `inner-margin=${inner}in` : value);
      actualArgs[actualArgs.indexOf('-o') + 1] = rendered;
      const result = require('child_process').spawnSync('pandoc', actualArgs, {
        cwd: workDir, env: { ...process.env, TMPDIR: workDir, TMP: workDir, TEMP: workDir },
        encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
      });
      log += result.stderr || '';
      safety.writeArtifact(artifacts.log, log);
      if (result.status !== 0 || result.error) throw new Error('Private renderer failed.');
      if (/PandocResourceNotFound|Could not fetch resource|Could not load image/.test(log)) throw new Error('An image resource could not be rendered.');
      if (target.ext !== 'pdf') break;
      if (/Overfull \\[hv]box|Missing character:/.test(log)) throw new Error('Layout overflow or missing glyph.');
      const info = execFileSync('pdfinfo', [rendered], { encoding: 'utf8' });
      const match = info.match(/^Pages:\s+(\d+)/m);
      if (!match) throw new Error('Cannot verify final page count.');
      pages = Number(match[1]);
      const required = safety.gutterForPages(pages);
      if (!opts.syntheticFixture && (pages < 24 || (opts.paperStock === 'cream' && pages > 776))) throw new Error('Page count is outside supported KDP stock limits.');
      if (required <= inner) break;
      inner = required;
      if (attempt === 3) throw new Error('Gutter/page count did not converge.');
    }
    const commandVersion = (name, commandArgs) => execFileSync(name, commandArgs, { encoding: 'utf8' }).split('\n')[0];
    const version = {
      synthetic: !!opts.syntheticFixture, pages, innerMarginInches: inner || null,
      sourceCommit: execFileSync('git', ['-C', __dirname, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      sourceDirty: !!execFileSync('git', ['-C', __dirname, 'status', '--porcelain'], { encoding: 'utf8' }).trim(),
      pandoc: commandVersion('pandoc', ['--version']),
      templateSha256: safety.sha256(path.join(TEMPLATE_DIR, 'kdp-print.tex')),
      filters: ['scene-break.lua', 'heading-promote.lua'].map(name => ({ name, sha256: safety.sha256(path.join(FILTER_DIR, name)) })),
    };
    if (target.ext === 'pdf') {
      version.xelatex = commandVersion('xelatex', ['--version']);
      version.fonts = ['regular', 'bold', 'italic', 'bolditalic'].map(style => {
        const name = `lmroman10-${style}.otf`;
        const file = execFileSync('kpsewhich', [name], { encoding: 'utf8' }).trim();
        return { name, sha256: safety.sha256(file) };
      });
    }
    if (target.ext === 'epub') cleanupEpub(rendered);
    version.outputSha256 = safety.sha256(rendered);
    safety.writeArtifact(artifacts.output, fs.readFileSync(rendered));
    safety.writeArtifact(artifacts.record, JSON.stringify(version, null, 2) + '\n');
    safety.closeArtifacts(artifacts, true);
    artifacts = null;

    const stat = fs.statSync(output);
    const sizeMB = (stat.size / (1024 * 1024)).toFixed(1);
    console.log(`  Done    private output (${sizeMB} MB)`);
  } catch (err) {
    console.error(`\n  Failed: ${target.label}`);
    const reserved = !!artifacts;
    if (artifacts) safety.closeArtifacts(artifacts, false);
    console.error(reserved ? 'Build failed. Inspect the build log beside the output in private storage.' : 'Existing output preserved; choose a new versioned output path.');
    process.exit(1);
  }
}

const PAPERBACK = { label: 'Paperback PDF',  ext: 'pdf',  suffix: '-paperback', innerMargin: trim.inner,   openRight: !!opts.openRight };
const HARDCOVER = { label: 'Hardcover PDF',  ext: 'pdf',  suffix: '-hardcover', innerMargin: trim.hcInner, openRight: true  };
const KINDLE    = { label: 'Kindle EPUB',    ext: 'epub', suffix: '',           innerMargin: null,         openRight: false };

let targets;
switch (opts.format) {
  case 'all':  targets = [PAPERBACK, HARDCOVER, KINDLE]; break;
  case 'pdf':  targets = [{ ...PAPERBACK, suffix: '' }]; break;
  case 'epub': targets = [KINDLE]; break;
}

try {
  const document = safety.checkInputs(resolvedFiles, privateRoot, __dirname, !!opts.syntheticFixture);
  fs.writeFileSync(path.join(workDir, 'validated-input.json'), JSON.stringify(document), { mode: 0o600 });
  if (opts.cover) safety.privatePath(privateRoot, path.resolve(opts.cover));
  if (opts.backMatter) safety.privatePath(privateRoot, path.resolve(opts.backMatter));
} catch (error) { console.error(error.message); process.exit(1); }

console.log('\n  book-convert');
console.log('  ───────────');

for (const target of targets) {
  run(target);
}

console.log('\n  All done.\n');
