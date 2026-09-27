#!/usr/bin/env python3

import re
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

PACKAGE_DIR = Path(__file__).resolve().parent.parent
BRAND_SOURCE = PACKAGE_DIR / 'src/lib/molly-brand.ts'
INTER_BOLD = PACKAGE_DIR / 'node_modules/@fontsource/inter/files/inter-latin-700-normal.woff2'
ASSETS_DIR = PACKAGE_DIR / 'src/assets'

M_HEIGHT_EM = 1.16
M_DROP_EM = 0.15
M_TRAILING_EM = -0.02
LETTER_SPACING_EM = -0.01
VARIANTS = {'molly-wordmark.svg': '#1E1E1E', 'molly-wordmark-dark.svg': '#FFFFFF'}


def read_brand_constant(source, name):
    match = re.search(rf"{name}\s*=\s*'([^']+)'", source)
    if not match:
        raise SystemExit(f'{name} not found in {BRAND_SOURCE}')
    return match.group(1)


def pair_kerning(font, left, right):
    total = 0
    for lookup in font['GPOS'].table.LookupList.Lookup:
        for subtable in lookup.SubTable:
            if lookup.LookupType == 9:
                subtable = subtable.ExtSubTable
            if subtable.LookupType != 2 or left not in subtable.Coverage.glyphs:
                continue
            if subtable.Format == 1:
                pair_set = subtable.PairSet[subtable.Coverage.glyphs.index(left)]
                for record in pair_set.PairValueRecord:
                    if record.SecondGlyph == right and record.Value1:
                        total += getattr(record.Value1, 'XAdvance', 0) or 0
            else:
                left_class = subtable.ClassDef1.classDefs.get(left, 0)
                right_class = subtable.ClassDef2.classDefs.get(right, 0)
                value = subtable.Class1Record[left_class].Class2Record[right_class].Value1
                if value:
                    total += getattr(value, 'XAdvance', 0) or 0
    return total


def main():
    source = BRAND_SOURCE.read_text()
    m_path = read_brand_constant(source, 'MOLLY_M_PATH')
    _, _, m_width, m_height = (float(v) for v in read_brand_constant(source, 'MOLLY_M_VIEW_BOX').split())

    font = TTFont(INTER_BOLD)
    em = font['head'].unitsPerEm
    glyph_set = font.getGlyphSet()
    cmap = font.getBestCmap()

    m_scale = M_HEIGHT_EM * em / m_height
    m_top = -(M_HEIGHT_EM - M_DROP_EM) * em
    m_right = m_width * m_scale

    text_pen = SVGPathPen(glyph_set)
    bounds = BoundsPen(glyph_set)
    names = [cmap[ord(c)] for c in 'olly']
    x = m_right + M_TRAILING_EM * em
    for index, name in enumerate(names):
        transform = (1, 0, 0, -1, x, 0)
        glyph_set[name].draw(TransformPen(text_pen, transform))
        glyph_set[name].draw(TransformPen(bounds, transform))
        x += glyph_set[name].width + LETTER_SPACING_EM * em
        if index + 1 < len(names):
            x += pair_kerning(font, name, names[index + 1])

    _, text_top, text_right, text_bottom = bounds.bounds
    top = min(m_top, text_top)
    bottom = max(m_top + m_height * m_scale, text_bottom)
    view_box = f'0 {top:.0f} {text_right:.0f} {bottom - top:.0f}'
    m_transform = f'translate(0 {m_top:.2f}) scale({m_scale:.5f})'

    for filename, fill in VARIANTS.items():
        svg = (
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view_box}" role="img" aria-label="Molly">'
            f'<title>Molly</title><g fill="{fill}">'
            f'<path transform="{m_transform}" d="{m_path}"/>'
            f'<path d="{text_pen.getCommands()}"/></g></svg>\n'
        )
        (ASSETS_DIR / filename).write_text(svg)
        print(f'wrote {ASSETS_DIR / filename}')


if __name__ == '__main__':
    main()
