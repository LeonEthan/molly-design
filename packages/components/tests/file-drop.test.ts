import { selectPastedClipboardFiles } from '../src/lib/file-drop';
// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { splitImageAndFileAttachments } from '../src/lib/file-drop';

describe('splitImageAndFileAttachments', () => {
  it('routes picker selections by supported image MIME type rather than filename', () => {
    const imageWithTextExtension = new File(['image'], 'preview.txt', { type: 'image/png' });
    const fileWithImageExtension = new File(['document'], 'report.png', {
      type: 'application/pdf',
    });
    const fileWithoutMime = new File(['data'], 'archive.bin');

    expect(
      splitImageAndFileAttachments([
        imageWithTextExtension,
        fileWithImageExtension,
        fileWithoutMime,
      ])
    ).toEqual({
      images: [imageWithTextExtension],
      attachments: [fileWithImageExtension, fileWithoutMime],
    });
  });

  it('routes SVG images to general file attachments', () => {
    const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'diagram.svg', {
      type: 'image/svg+xml',
    });

    expect(splitImageAndFileAttachments([svg])).toEqual({
      images: [],
      attachments: [svg],
    });
  });
});

describe('selectPastedClipboardFiles', () => {
  const renderedBitmap = (name = 'image.png') => new File(['png'], name, { type: 'image/png' });

  it('keeps the text a rich-text source copied and drops the bitmap beside it', () => {
    // What a Word or PowerPoint copy looks like: the prose, plus a picture of
    // the same selection that the user never asked for.
    const bitmap = renderedBitmap();

    expect(selectPastedClipboardFiles({ text: 'Quarterly plan', files: [bitmap] })).toEqual({
      files: [],
      renderedImages: [bitmap],
    });
  });

  it('drops an unnamed bitmap too, since not every engine names one', () => {
    const bitmap = renderedBitmap('');

    expect(selectPastedClipboardFiles({ text: 'Quarterly plan', files: [bitmap] })).toEqual({
      files: [],
      renderedImages: [bitmap],
    });
  });

  it('attaches a screenshot, which arrives with no text at all', () => {
    const screenshot = renderedBitmap();

    expect(selectPastedClipboardFiles({ text: '', files: [screenshot] })).toEqual({
      files: [screenshot],
      renderedImages: [],
    });
  });

  it('attaches a screenshot pasted beside whitespace-only clipboard text', () => {
    const screenshot = renderedBitmap();

    expect(selectPastedClipboardFiles({ text: ' \n ', files: [screenshot] })).toEqual({
      files: [screenshot],
      renderedImages: [],
    });
  });

  it('attaches an image the user copied in the file manager, name and all', () => {
    // Finder and Explorer put the filename on the clipboard as text, so the
    // name is what separates this from a bitmap the source app rendered.
    const photo = new File(['png'], 'photo.png', { type: 'image/png' });

    expect(selectPastedClipboardFiles({ text: 'photo.png', files: [photo] })).toEqual({
      files: [photo],
      renderedImages: [],
    });
  });

  it('attaches a non-image file regardless of the text beside it', () => {
    const report = new File(['pdf'], 'report.pdf', { type: 'application/pdf' });

    expect(selectPastedClipboardFiles({ text: 'report.pdf', files: [report] })).toEqual({
      files: [report],
      renderedImages: [],
    });
  });

  it('splits a clipboard carrying both a real file and a rendered bitmap', () => {
    const bitmap = renderedBitmap();
    const report = new File(['pdf'], 'report.pdf', { type: 'application/pdf' });

    expect(selectPastedClipboardFiles({ text: 'See attached', files: [report, bitmap] })).toEqual({
      files: [report],
      renderedImages: [bitmap],
    });
  });
});
