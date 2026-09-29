from pathlib import Path
import json
import xml.etree.ElementTree as ET

PACKAGE_DIR = Path(__file__).resolve().parent.parent
ASSETS = PACKAGE_DIR / 'src/assets'
NS = '{http://www.w3.org/2000/svg}'
ET.register_namespace('', NS[1:-1])


def geometry(filename):
    root = ET.parse(ASSETS / filename).getroot()
    group = root.find(f'{NS}g')
    return root.attrib['viewBox'], group.attrib['transform'], [p.attrib['d'] for p in group.findall(f'{NS}path')]


def main():
    view, transform, paths = geometry('molly-wordmark-source.svg')
    m_view, m_transform, m_paths = geometry('molly-mark.svg')
    constants = {
        'MOLLY_WORDMARK_FONT_FAMILY': 'Inter, sans-serif',
        'MOLLY_WORDMARK_VIEW_BOX': view,
        'MOLLY_WORDMARK_TRANSFORM': transform,
        'MOLLY_WORDMARK_PATHS': paths,
        'MOLLY_M_VIEW_BOX': m_view,
        'MOLLY_M_TRANSFORM': m_transform,
        'MOLLY_M_PATH': ' '.join(m_paths),
    }
    (PACKAGE_DIR / 'src/lib/molly-brand.ts').write_text(''.join(
        f'export const {key} = {json.dumps(value)};\n' for key, value in constants.items()
    ))
    for filename, color in [('molly-wordmark.svg', '#26281f'), ('molly-wordmark-dark.svg', '#ffffff')]:
        root = ET.parse(ASSETS / 'molly-wordmark-source.svg').getroot()
        root.set('fill', color)
        ET.ElementTree(root).write(ASSETS / filename, encoding='unicode')


if __name__ == '__main__':
    main()
