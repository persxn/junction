import { describe, expect, it } from 'vitest';

import { classify, defaultLabel, detect } from './classify.js';

/** R103's kinds and normalization, as a table (WP-20b step 3). */

describe('detecting the kind (R103)', () => {
  it.each([
    ['https://github.com/acme/rocket', 'GITHUB', 'https://github.com/acme/rocket'],
    ['https://github.com/acme/rocket.git', 'GITHUB', 'https://github.com/acme/rocket'],
    ['https://github.com/acme/rocket/', 'GITHUB', 'https://github.com/acme/rocket'],
    ['http://www.github.com/acme/rocket.git/', 'GITHUB', 'https://github.com/acme/rocket'],
    [
      'https://github.com/acme/rocket/tree/main/docs?tab=x#y',
      'GITHUB',
      'https://github.com/acme/rocket/tree/main/docs',
    ],
    ['https://github.com/acme', 'URL', 'https://github.com/acme'],
    [
      'https://docs.google.com/document/d/abc/edit',
      'CLOUD_DOC',
      'https://docs.google.com/document/d/abc/edit',
    ],
    ['https://drive.google.com/file/d/abc', 'CLOUD_DOC', 'https://drive.google.com/file/d/abc'],
    ['https://onedrive.live.com/?id=1', 'CLOUD_DOC', 'https://onedrive.live.com/?id=1'],
    ['https://1drv.ms/b/s!abc', 'CLOUD_DOC', 'https://1drv.ms/b/s!abc'],
    [
      'https://college.sharepoint.com/sites/x',
      'CLOUD_DOC',
      'https://college.sharepoint.com/sites/x',
    ],
    ['https://notsharepoint.com/x', 'URL', 'https://notsharepoint.com/x'],
    ['  https://devfolio.co/hack  ', 'URL', 'https://devfolio.co/hack'],
    ['C:\\Users\\prof\\deck.pptx', 'LOCAL_PATH', 'C:\\Users\\prof\\deck.pptx'],
    ['d:/team/report.pdf', 'LOCAL_PATH', 'd:\\team\\report.pdf'],
    ['\\\\LAB-NAS\\share\\brief.docx', 'LOCAL_PATH', '\\\\LAB-NAS\\share\\brief.docx'],
  ])('%s → %s', (input, kind, uri) => {
    expect(detect(input)).toEqual({ ok: true, kind, uri });
  });

  it.each([
    ['javascript:alert(1)', 'SCHEME'],
    ['JavaScript:alert(1)', 'SCHEME'],
    ['file:///C:/Windows/notepad.exe', 'SCHEME'],
    ['data:text/html,<script>', 'SCHEME'],
    ['ftp://files.example.com/x', 'SCHEME'],
    ['ms-settings:windowsupdate', 'SCHEME'],
    ['report.pdf', 'RELATIVE'],
    ['..\\..\\Windows\\notepad.exe', 'RELATIVE'],
    ['docs/brief.pdf', 'RELATIVE'],
    ['\\\\server', 'RELATIVE'],
    ['https://user:pw@evil.test/', 'MALFORMED'],
    ['https://', 'MALFORMED'],
    ['', 'EMPTY'],
    ['   ', 'EMPTY'],
    [`https://example.org/${'a'.repeat(2048)}`, 'TOO_LONG'],
  ])('%s is refused (%s)', (input, refusal) => {
    expect(detect(input)).toEqual({ ok: false, refusal });
  });
});

describe('a kind the person chose', () => {
  it('files any web link as URL or OTHER, keeping it as given', () => {
    expect(classify('https://github.com/acme/rocket.git', 'URL')).toEqual({
      ok: true,
      kind: 'URL',
      uri: 'https://github.com/acme/rocket.git',
    });
    expect(classify('https://docs.google.com/x', 'OTHER')).toMatchObject({
      ok: true,
      kind: 'OTHER',
    });
  });

  it('refuses a kind the text does not fit', () => {
    expect(classify('https://devfolio.co/x', 'GITHUB')).toEqual({ ok: false, refusal: 'KIND' });
    expect(classify('https://devfolio.co/x', 'LOCAL_PATH')).toEqual({ ok: false, refusal: 'KIND' });
    expect(classify('C:\\x.pdf', 'URL')).toEqual({ ok: false, refusal: 'KIND' });
    expect(classify('javascript:x', 'URL')).toEqual({ ok: false, refusal: 'SCHEME' });
  });
});

describe('a label when none is given', () => {
  it('reads one from the link or the file name', () => {
    expect(defaultLabel('GITHUB', 'https://github.com/acme/rocket/tree/main')).toBe('acme/rocket');
    expect(defaultLabel('URL', 'https://devfolio.co/hack/')).toBe('devfolio.co/hack');
    expect(defaultLabel('URL', 'https://devfolio.co/')).toBe('devfolio.co');
    expect(defaultLabel('LOCAL_PATH', 'C:\\Users\\prof\\deck.pptx')).toBe('deck.pptx');
    expect(defaultLabel('URL', `https://e.org/${'a'.repeat(200)}`)).toHaveLength(120);
  });
});
