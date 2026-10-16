#!/usr/bin/env python3
"""Rendered synthetic interior checks; all output must stay outside Git."""
import argparse
import json
import os
import re
import subprocess
import unicodedata
from pathlib import Path
import fitz

REPO = Path(__file__).resolve().parents[1]
FIXTURES = REPO / 'tests/fixtures'

def norm(s):
    return ''.join(c for c in unicodedata.normalize('NFKC', s) if c.isalnum())

def inline(items):
    result = ''
    for item in items:
        kind, value = item['t'], item.get('c')
        if kind == 'Str': result += value
        elif kind in ('Space', 'SoftBreak', 'LineBreak'): result += ' '
        elif kind in ('Emph', 'Strong', 'SmallCaps', 'Strikeout'): result += inline(value)
        elif kind in ('Quoted', 'Span'): result += inline(value[-1])
    return result

def check_output(path):
    value = path.resolve()
    for parent in [value, *value.parents]:
        if (parent / '.git').exists(): raise ValueError('Regression output must stay outside Git.')
    if value.exists() and any(value.iterdir()): raise ValueError('Choose an empty, dedicated synthetic regression output directory.')
    value.mkdir(parents=True, exist_ok=True, mode=0o700)
    return value

def run_case(output, name, fixture, trim, title, extra=(), expected=0):
    command = ['node', str(REPO / 'convert.js'), str(FIXTURES / fixture),
               '--private-root', str(output), '--synthetic-fixture', '-f', 'pdf',
               '--trim', trim, '--title', title, '--author', 'Ada Example',
               '--subtitle', 'Synthetic regression only', '--year', '2026', '-o', name, *extra]
    result = subprocess.run(command, text=True, capture_output=True)
    (output / (name + '.console.log')).write_text(result.stdout + result.stderr)
    if bool(result.returncode) != bool(expected): raise AssertionError(name + ': unexpected build status')
    return {'argv': command, 'exit': result.returncode}

def audit_novel(output, name, trim):
    doc = fitz.open(output / (name + '.pdf'))
    width, height = (360,576) if trim == '5x8' else (432,648)
    assert all(abs(p.rect.width-width)<.01 and abs(p.rect.height-height)<.01 for p in doc)
    assert doc[3].get_text().strip() == '', 'intentional blank verso has a folio/header'
    headers, scenes, body = [], [], []
    for i, page in enumerate(doc):
        if i < 4: continue
        lines=[]
        for block in page.get_text('dict', clip=fitz.INFINITE_RECT())['blocks']:
            for line in block.get('lines', []):
                text=''.join(s['text'] for s in line['spans'])
                y=line['bbox'][1]
                if y < (50.4 if trim == '5x8' else 57.6)+25:
                    headers.append((i+1,text)); continue
                if y > height-40: continue
                lines.append((text,line['bbox']))
                for span in line['spans']:
                    assert -.5 <= span['bbox'][0] and span['bbox'][2] <= width+.5, 'horizontal overflow'
        body.extend(text for text,_ in lines)
        for text,bbox in lines:
            if text.replace(' ','') == '***':
                following=[t for t,b in lines if b[1]>bbox[3] and norm(t)]
                assert following, 'scene ornament stranded at page bottom'
                scenes.append(i+1)
    assert len(headers)>20, 'running headers absent'
    assert any('Harbour' in t for _,t in headers)
    assert len(scenes)==16
    ast=json.loads(subprocess.check_output(['pandoc',str(FIXTURES/'synthetic-novel.md'),'-t','json'],text=True))
    paras=[inline(b['c']) for b in ast['blocks'] if b['t']=='Para']
    combined=norm(' '.join(body));pos=0
    for para in paras:
        needle=norm(para);found=combined.find(needle,pos)
        assert found>=0, 'prose paragraph lost/reordered';pos=found+len(needle)
    fonts=subprocess.check_output(['pdffonts',str(output/(name+'.pdf'))],text=True)
    for line in fonts.splitlines()[2:]:
        assert re.search(r'\byes\s+yes\s+yes\b',line), 'font not embedded/subset/Unicode mapped'
    log=(output/(name+'.pdf.build.log')).read_text()
    assert not re.search(r'Overfull \\[hv]box|Missing character:',log)
    return {'pages':len(doc),'headers':len(headers),'scene_pages':scenes,'paragraphs':len(paras),
            'embedded_font_report':fonts,'build':json.loads((output/(name+'.pdf.build.json')).read_text())}

def image_and_companion_controls(output):
    import hashlib
    import zipfile
    private = output/'resource-cases';private.mkdir()
    inputs=[];expected=[]
    for index, tone in [(1, 80), (2, 190)]:
        folder=private/('source-'+str(index));folder.mkdir()
        image=fitz.Pixmap(fitz.csRGB,fitz.IRect(0,0,24,24));image.clear_with(tone);image.save(folder/'image.png')
        expected.append(hashlib.sha256((folder/'image.png').read_bytes()).hexdigest())
        source=folder/(str(index)+'.md');source.write_text('# Synthetic chapter '+str(index)+'\n\nSYNTHETIC_IMAGE_SENTINEL_'+str(index)+'\n\n![Synthetic square](image.png)\n')
        inputs.append(str(source))
    command=['node',str(REPO/'convert.js'),*inputs,'--private-root',str(private),'-f','epub','-t','Synthetic image controls','-o','image-book']
    result=subprocess.run(command,text=True,capture_output=True)
    (private/'image-book.console.log').write_text(result.stdout+result.stderr)
    assert result.returncode==0,'relative image EPUB failed'
    with zipfile.ZipFile(private/'image-book.epub') as archive:
        actual=[hashlib.sha256(archive.read(name)).hexdigest() for name in archive.namelist() if '/media/' in name and not name.endswith('/')]
        assert sorted(actual)==sorted(expected),'different source-relative image bytes lost/substituted'
        text=''.join(archive.read(name).decode() for name in archive.namelist() if name.endswith('.xhtml'))
        assert all('SYNTHETIC_IMAGE_SENTINEL_'+str(n) in text for n in [1,2])
    # Shared reference and footnote definitions retain combined Markdown semantics.
    shared=private/'shared';shared.mkdir()
    (shared/'image.png').write_bytes((private/'source-1/image.png').read_bytes())
    (shared/'01.md').write_text('---\ntitle: Shared Metadata\n---\n\n# Shared chapter\n\n![Shared square][diagram]\n\nShared prose[^note].\n')
    (shared/'02.md').write_text('[diagram]: image.png\n\n[^note]: SHARED_FOOTNOTE_SENTINEL\n')
    result=subprocess.run(['node',str(REPO/'convert.js'),str(shared/'01.md'),str(shared/'02.md'),'--private-root',str(private),'-f','epub','-t','Synthetic shared references','-o','shared-book'],capture_output=True,text=True)
    assert result.returncode==0,'shared-reference EPUB failed'
    with zipfile.ZipFile(private/'shared-book.epub') as archive:
        media=[archive.read(name) for name in archive.namelist() if '/media/' in name and not name.endswith('/')]
        assert len(media)==1 and hashlib.sha256(media[0]).hexdigest()==expected[0],'shared reference image lost'
        text=''.join(archive.read(name).decode() for name in archive.namelist() if name.endswith('.xhtml'))
        assert 'SHARED_FOOTNOTE_SENTINEL' in text and '[diagram]' not in text,'cross-file footnote/reference lost'
    # Images in cross-file footnote definitions use their authored file, not the reference file.
    note_a=private/'source-1/note-a.md';note_b=private/'source-2/note-b.md'
    note_a.write_text('# Synthetic notes\n\nFootnote reference[^n].\n')
    note_b.write_text('[^n]: FOOTNOTE_IMAGE_SENTINEL ![Note square](image.png)\n')
    result=subprocess.run(['node',str(REPO/'convert.js'),str(note_a),str(note_b),'--private-root',str(private),'-f','epub','-t','Synthetic note images','-o','note-images'],capture_output=True,text=True)
    assert result.returncode==0,'footnote image EPUB failed'
    with zipfile.ZipFile(private/'note-images.epub') as archive:
        media=[archive.read(name) for name in archive.namelist() if '/media/' in name and not name.endswith('/')]
        assert len(media)==1 and hashlib.sha256(media[0]).hexdigest()==expected[1],'footnote image selected the reference folder instead of its authored folder'
    titleblock=private/'titleblock.md';titleblock.write_text('% Synthetic Title Block\n% Ada Synthetic\n% 2026\n\n# Synthetic chapter\n\nTITLEBLOCK_PROSE_SENTINEL\n')
    result=subprocess.run(['node',str(REPO/'convert.js'),str(titleblock),'--private-root',str(private),'-f','epub','-o','titleblock'],capture_output=True,text=True)
    assert result.returncode==0,'native title block EPUB failed'
    with zipfile.ZipFile(private/'titleblock.epub') as archive:
        opf=''.join(archive.read(name).decode() for name in archive.namelist() if name.endswith('.opf'))
        text=''.join(archive.read(name).decode() for name in archive.namelist() if name.endswith('.xhtml'))
        assert 'Synthetic Title Block' in opf and 'Ada Synthetic' in opf,'native title/author metadata lost'
        assert '% Synthetic Title Block' not in text and 'TITLEBLOCK_PROSE_SENTINEL' in text,'metadata leaked into body'
    # Missing images fail before output is reserved, not as a successful incomplete EPUB.
    missing=private/'missing.md';missing.write_text('# Synthetic\n\n![missing](absent.png)\n')
    result=subprocess.run(['node',str(REPO/'convert.js'),str(missing),'--private-root',str(private),'-f','epub','-o','missing'],capture_output=True,text=True)
    assert result.returncode!=0 and not (private/'missing.epub').exists()
    for suffix in ['.build.log','.build.json']:
        case=private/('sidecar-'+suffix.rsplit('.',1)[1]);case.mkdir()
        sentinel=private/('outside-'+suffix.rsplit('.',1)[1]);sentinel.write_text('SYNTHETIC OUTSIDE SENTINEL')
        (case/('blocked.epub'+suffix)).symlink_to(sentinel)
        result=subprocess.run(['node',str(REPO/'convert.js'),str(FIXTURES/'synthetic-short-chapter-openings.md'),'--synthetic-fixture','--private-root',str(case),'-f','epub','-o','blocked'],capture_output=True,text=True)
        assert result.returncode!=0 and sentinel.read_text()=='SYNTHETIC OUTSIDE SENTINEL'
        assert not (case/'blocked.epub').exists()
    return {'relative_image_hashes':expected,'matching_packaged_images':len(actual),'missing_image_rejected':True,'outside_sidecars_preserved':True,'shared_references_and_footnotes_preserved':True,'authored_footnote_image_preserved':True,'native_titleblock_preserved':True,'argv':command}

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,required=True);args=parser.parse_args();output=check_output(args.output)
    report={'cases':{},'novels':{}}
    for trim in ('5x8','6x9'):
        name='maintained-novel-'+trim
        report['cases'][name]=run_case(output,name,'synthetic-novel.md',trim,'The Harbour of Quiet Stars',('--toc','--open-right'))
        report['novels'][trim]=audit_novel(output,name,trim)
    for right in (False,True):
        name='short-open-'+str(right).lower()
        report['cases'][name]=run_case(output,name,'synthetic-short-chapter-openings.md','5x8','Synthetic Opening Test',('--open-right',) if right else ())
        doc=fitz.open(output/(name+'.pdf'));pages=[i+1 for i,p in enumerate(doc) if 'Second Departure' in p.get_text()]
        assert pages and pages[0]%2==(1 if right else 0),'open-right flag not honored'
        if right: assert not doc[3].get_text().strip(), 'chapter-open blank verso not empty'
    report['cases']['h1-preserved']=run_case(output,'h1-preserved','synthetic-first-h1-chapter.md','5x8','Different Book Title')
    assert 'The First Real Chapter' in ''.join(p.get_text() for p in fitz.open(output/'h1-preserved.pdf'))
    # A finished output must survive a repeated invocation unchanged.
    import hashlib
    existing=output/'short-open-false.pdf';before=hashlib.sha256(existing.read_bytes()).hexdigest()
    report['cases']['existing-preserved']=run_case(output,'short-open-false','synthetic-short-chapter-openings.md','5x8','Synthetic Opening Test',expected=1)
    assert hashlib.sha256(existing.read_bytes()).hexdigest()==before,'existing book was overwritten/deleted'
    # Metadata is literal TeX text, never executable input.
    (output/'tripwire.tex').write_text('SYNTHETIC-METADATA-TRIPWIRE')
    report['cases']['literal-metadata']=run_case(output,'literal-metadata','synthetic-short-chapter-openings.md','5x8','Synthetic Opening Test',('--subtitle',r'A & B \input{tripwire.tex}'))
    meta=''.join(p.get_text() for p in fitz.open(output/'literal-metadata.pdf'))
    assert 'SYNTHETIC-METADATA-TRIPWIRE' not in meta and 'A & B' in meta
    report['cases']['invalid-font-size']=run_case(output,'invalid-font-size','synthetic-short-chapter-openings.md','5x8','Synthetic Opening Test',('--font-size',r'11pt}\input{tripwire.tex}'),expected=1)
    assert not (output/'invalid-font-size.pdf').exists()
    report['cases']['overflow-rejected']=run_case(output,'overflow-rejected','synthetic-stress.md','5x8','Stress Fixture',expected=1)
    assert not (output/'overflow-rejected.pdf').exists()
    report['image_and_companion_controls'] = image_and_companion_controls(output)
    (output/'render-regression.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({k:{'pages':v['pages'],'headers':v['headers'],'scenes':len(v['scene_pages']),'paragraphs':v['paragraphs']} for k,v in report['novels'].items()},indent=2))
    print('Synthetic interior rendered regression passed.')

if __name__=='__main__': main()
