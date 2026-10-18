#!/usr/bin/env python3
"""Builds the Molly Design website into dist/ (the Cloudflare Pages deploy folder).
Python 3 standard library only; every path is relative to this file."""
import hashlib, json, pathlib, re, shutil, sys

ROOT = pathlib.Path(__file__).resolve().parent
SRC = ROOT / 'assets'                 # processed, web-ready assets (images, video, fonts, icons)
SITE_DIR = ROOT / 'dist'
HERE = ROOT / 'src'
SITE = 'https://molly-design.pages.dev'
# Update on every release (see README.md, "Release: bump the DMG URL").
DMG = 'https://github.com/LeonEthan/molly-design/releases/download/v0.1.1/MollyDesign-0.1.1-arm64.dmg'
RELEASE_PAGE = re.compile(r'releases/latest|/releases(?:["\'?#<\s]|/tag/|/?$)', re.M)
GH = 'https://github.com/LeonEthan/molly-design'
MAN = json.loads((SRC / 'manifest.json').read_text())
CFG = json.loads((HERE / 'slots.json').read_text().replace('@@DMG@@', DMG))
DL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 20h14"/></svg>'
GITHUB_MARK = '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true" focusable="false"><path d="M6.766 11.328c-2.063-.25-3.516-1.734-3.516-3.656 0-.781.281-1.625.75-2.188-.203-.515-.172-1.609.063-2.062.625-.078 1.468.25 1.968.703.594-.187 1.219-.281 1.985-.281.765 0 1.39.094 1.953.265.484-.437 1.344-.765 1.969-.687.218.422.25 1.515.046 2.047.5.593.766 1.39.766 2.203 0 1.922-1.453 3.375-3.547 3.64.531.344.89 1.094.89 1.954v1.625c0 .468.391.734.86.547C13.781 14.359 16 11.53 16 8.03 16 3.61 12.406 0 7.984 0 3.563 0 0 3.61 0 8.031a7.88 7.88 0 0 0 5.172 7.422c.422.156.828-.125.828-.547v-1.25c-.219.094-.5.156-.75.156-1.031 0-1.64-.562-2.078-1.609-.172-.422-.36-.672-.719-.719-.187-.015-.25-.093-.25-.187 0-.188.313-.328.625-.328.453 0 .844.281 1.25.86.313.452.64.655 1.031.655s.641-.14 1-.5c.266-.265.47-.5.657-.656"/></svg>'
GITHUB_LABEL = '[[在 GitHub 上查看 Molly Design||Molly Design on GitHub]]'
CTA = '[[下载 macOS 版||Download for macOS]]'


def pairs(s):
    s = re.sub(r'([a-z][\w-]*)="\[\[(.*?)\|\|(.*?)\]\]"',
               lambda m: '%s="%s" data-%s-zh="%s" data-%s-en="%s"' % (m.group(1), m.group(3), m.group(1), m.group(2), m.group(1), m.group(3)), s)
    return re.sub(r'\[\[(.*?)\|\|(.*?)\]\]',
                  lambda m: '<span data-l="zh">%s</span><span data-l="en">%s</span>' % (m.group(1), m.group(2)), s, flags=re.S)


def esc(s):
    return s.replace('&', '&amp;').replace('"', '&quot;')


def alt(zh, en):
    return 'alt="%s" data-alt-zh="%s" data-alt-en="%s"' % (esc(en), esc(zh), esc(en))


def pic(key, zh, en, sizes='(max-width:1040px) 100vw, 1100px', eager=False, cls=''):
    m = MAN['img'][key]
    ws = sorted(int(w) for w in m['files'])
    srcset = ', '.join('@@A:%s@@ %dw' % (m['files'][str(w)], w) for w in ws)
    big = m['files'][str(ws[-1])]
    load = 'fetchpriority="high"' if eager else 'loading="lazy"'
    c = ' class="%s"' % cls if cls else ''
    return ('<img%s src="@@A:%s@@" srcset="%s" sizes="%s" width="%d" height="%d" %s %s decoding="async">'
            % (c, big, srcset, sizes, m['w'], m['h'], alt(zh, en), load))


def vid(key, zh, en):
    m = MAN['video'][key]
    p = MAN['img'][m['poster']]
    pw = sorted(int(w) for w in p['files'])[-1]
    return ('<video muted%s playsinline preload="none" width="%d" height="%d" style="--ar:%d/%d" poster="@@A:%s@@" aria-label="%s" data-alt-zh="%s" data-alt-en="%s"><source src="@@A:%s@@" type="video/mp4"></video>'
            % ('', m['w'], m['h'], m['w'], m['h'], p['files'][str(pw)], esc(en), esc(zh), esc(en), m['file']))


REAL = '[[真实截图||Real capture]]'
REALV = '[[真实录屏||Real recording]]'
ILL = '[[示意||Illustration]]'


def media(label, inner, chip=REAL, narrow=False, ill=False):
    """Frame for a capture or an illustration: a caption row above, never fake window chrome."""
    return ('<div class="media%s%s"><div class="mhead"><span class="ml">%s</span><span class="chip %s">%s</span></div><div class="mbody">%s</div></div>'
            % (' narrow' if narrow else '', ' ill' if ill else '', label, 'ill' if ill else 'real', ILL if ill else chip, inner))


HERO_TILES = ['hx-kettle', 'hx-latte', 'hx-forest', 'hx-ribbon']

def scene_asset(key):
    m = MAN['img'][key]
    ws = sorted(int(w) for w in m['files'])
    srcset = ', '.join('@@A:%s@@ %dw' % (m['files'][str(w)], w) for w in ws)
    return '<img data-scene="%s" src="@@A:%s@@" srcset="%s" sizes="(max-width:640px) 500px, 800px" width="%d" height="%d" alt="" aria-hidden="true" fetchpriority="low" decoding="async">' % (key, m['files'][str(ws[0])], srcset, m['w'], m['h'])


def hero_stage():
    assets = ''.join(scene_asset(k) for k in ['scene-plate', 'scene-kettle', 'scene-kettle-shadow', 'scene-mug', 'scene-mug-shadow'])
    return f'''<div class="hs-wrap">
    <div class="hs-amb" aria-hidden="true"><i class="a1"></i><i class="a2"></i><i class="a3"></i></div>
    <div class="hs" role="img" aria-label="[[示意动画：产品照片中的茶壶被单击选中、移动和缩放，再重新生成一个鼠尾草绿马克杯。背景和文字保持原位。马克杯由图像生成，抠图与背景修补为示意制作。||Illustration: the kettle in a product photo is clicked to select, moved and resized, then regenerated into a sage-green mug. Background and text stay in place. The mug is image-generated; cutouts and the repaired background are crafted for this illustration.]]">
      <div class="hs-fit"><div class="hs-scene">
        <div class="hs-glow"></div>
        <div class="hs-board">
          <canvas class="hs-photo" width="1000" height="1080" aria-hidden="true"></canvas>
          <div class="hs-assets" hidden>{assets}</div>
          <div class="hs-tone"></div>
          <p class="hs-mast"><span>Stillwater Clay</span><span>[[日常器物 / 01||Everyday objects / 01]]</span></p>
          <p class="hs-head">[[留一点时间，慢慢来。||Time, well spent.]]</p>
          <dl class="hs-spec"><div><dt>[[材质||Material]]</dt><dd>[[粗陶||Stoneware]]</dd></div><div><dt>[[表面||Finish]]</dt><dd>[[自然釉||Natural glaze]]</dd></div><div><dt>[[工艺||Made]]</dt><dd>[[手工修坯||Hand-finished]]</dd></div></dl>
          <p class="hs-cap"><span>[[让日常慢下来。||For the slower moments.]]</span><small>[[器物研究 · 2026||Object study · 2026]]</small></p>
        </div>
        <div class="hs-ui" aria-hidden="true">
          <span class="hs-gb"><i></i><i></i><i></i><i></i></span>
          <span class="hs-size"></span>
          <span class="hs-pill"><em class="a">[[重新生成||Regenerate]]</em><em class="b">[[生成中…||Regenerating…]]</em></span>
          <span class="hs-cur"><svg class="ar" viewBox="0 0 24 24"><path d="M5 3l14 8.2-6.1 1.5 3.6 6.6-2.7 1.4-3.5-6.6L5 18.5z"/></svg><svg class="rs" viewBox="0 0 24 24"><path d="M5 5h6l-2.2 2.2 8.4 8.4L19.4 13.4V19h-5.6l2.2-2.2-8.4-8.4L5.4 10.6z"/></svg></span>
        </div>
      </div></div>
    </div>
    <p class="hs-note">[[示意动画||Illustration]]</p>
  </div>'''


def sh(kicker, h2, lead=None):
    s = '<div class="sh"><p class="kicker">%s</p><h2>%s</h2>' % (kicker, h2)
    return s + ('<p class="lead">%s</p>' % lead if lead else '') + '</div>'


def S(name):
    """bilingual text from slots.json"""
    v = CFG['text'][name]
    return '[[%s||%s]]' % (v[0], v[1])


def head():
    desc_en = 'An AI design app for graphic designers on the Mac. Describe the job and get back a layered file: real text, shapes and images you can keep editing.'
    desc_zh = '给平面设计师的 Mac AI 设计工具。说清要做什么，拿回分好层的稿子，文字、形状、图片都能接着改。'
    title = 'Molly Design · AI design for graphic designers, in layers you can edit'
    jsonld = json.dumps({"@context": "https://schema.org", "@type": "SoftwareApplication", "name": "Molly Design",
                         "applicationCategory": "DesignApplication", "operatingSystem": "macOS",
                         "url": SITE + '/', "downloadUrl": DMG, "image": SITE + '/og.png', "description": desc_en,
                         "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"}}, ensure_ascii=False)
    return f'''<!doctype html>
<html lang="zh-CN" data-lang="zh">
<head>
<meta charset="utf-8">
<!-- SITE_URL={SITE} -->
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc_en} {desc_zh}">
<meta name="theme-color" content="#0e1711">
<meta name="color-scheme" content="dark light">
<link rel="canonical" href="{SITE}/">
<link rel="icon" href="@@R:favicon.ico@@" sizes="32x32">
<link rel="icon" href="@@R:favicon.svg@@" type="image/svg+xml">
<link rel="apple-touch-icon" href="@@R:apple-touch-icon.png@@">
<link rel="manifest" href="@@R:site.webmanifest@@">
<link rel="preload" href="@@A:fonts/geist.woff2@@" as="font" type="font/woff2" crossorigin>
<meta property="og:type" content="website">
<meta property="og:site_name" content="Molly Design">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc_en}">
<meta property="og:url" content="{SITE}/">
<meta property="og:image" content="{SITE}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Molly Design: AI design for graphic designers">
<meta property="og:locale" content="zh_CN">
<meta property="og:locale:alternate" content="en_US">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{title}">
<meta name="twitter:description" content="{desc_en}">
<meta name="twitter:image" content="{SITE}/og.png">
<script type="application/ld+json">{jsonld}</script>
<script>(function(){{var l=null;try{{l=localStorage.getItem('molly-lang')}}catch(e){{}}if(l!=='zh'&&l!=='en')l=/^zh/i.test(navigator.language||'')?'zh':'en';var r=document.documentElement;r.setAttribute('data-lang',l);r.lang=l==='zh'?'zh-CN':'en'}})();</script>
<style>
{(HERE / 'style.css').read_text()}
</style>
</head>
'''


def words(zh, en):
    """Brief text split into spans so the illustration can 'type' it in on reveal."""
    def wrap(parts, sep):
        return sep.join('<span style="--i:%d">%s</span>' % (i, w) for i, w in enumerate(parts))
    zh_parts = re.findall(r'[^，。？]+[，。？]?', zh)
    return '<span data-l="zh">%s</span><span data-l="en">%s</span>' % (wrap(zh_parts, ''), wrap(en.split(' '), ' '))


SEND = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m0 0l-6 6m6-6l6 6"/></svg>'


def ill_brief():
    sizes = [('auto', '自动', 'Auto size', '按简报', 'by brief'), ('sq', '方图', 'Square', '1080×1080', '1080×1080'),
             ('po', '竖版', 'Portrait', '1080×1350', '1080×1350'), ('st', '竖屏', 'Story', '1080×1920', '1080×1920'),
             ('la', '横版', 'Landscape', '1920×1080', '1920×1080'), ('lo', '长图', 'Long image', '1080×2400', '1080×2400')]
    cells = ''.join('<span class="%s"><i class="r-%s"></i><b>[[%s||%s]]</b><em>[[%s||%s]]</em></span>'
                    % ('on' if k == 'po' else '', k, zh, en, mz, me) for k, zh, en, mz, me in sizes)
    text = words('给海边的周末陶器市集做一张海报，温暖、安静、有手作感。先找几张参考，给我看两三个方向？',
                 'A poster for a weekend ceramics market by the harbour. Warm, calm and handmade. Find a few references and show me a couple of directions first?')
    return f'''<div class="ill-c ib" role="img" aria-label="[[示意：新建设计的输入框里写着一句简报，下面是尺寸预设：按简报自动、方图、竖版、竖屏、横版和长图。||Illustration: the new-design box with a one-line brief, above the size presets: auto by brief, square, portrait, story, landscape and long image.]]">
        <div class="ib-box"><p class="ib-text">{text}<i class="ib-caret"></i></p>
          <div class="ib-row"><span class="ib-plus">+</span><span class="ib-chip"><i></i>1080 × 1350</span><span class="ib-send">{SEND}</span></div></div>
        <div class="ib-sizes">{cells}</div>
      </div>'''


def ill_export():
    files = ''.join('<li style="--i:%d"><i class="fi"></i><span>poster@%dx.png</span><em>%d × %d</em><b>%d×</b></li>' % (i, k, 1080 * k, 1350 * k, k)
                    for i, k in enumerate([1, 2, 3]))
    vers = ''.join('<span class="v k%d"><i></i><b>v%d</b></span>' % (i, i) for i in (1, 2, 3))
    return f'''<div class="ill-c ix" role="img" aria-label="[[示意：可编辑的稿子和保存的版本留在 Mac 上；导出 PNG 或 JPEG，1×、2×、3× 三档，交给客户。||Illustration: the editable file and its saved versions stay on your Mac; the export goes out as PNG or JPEG at 1×, 2× or 3× for the client.]]">
        <div class="ix-mac"><p class="ix-h">[[留在你的 Mac 上||Stays on your Mac]]</p>
          <div class="ix-stack">{vers}</div>
          <p class="ix-s">[[可编辑的稿子 · 已保存的版本||Editable file · saved versions]]</p></div>
        <div class="ix-go" aria-hidden="true"><span></span><em>[[导出||Export]]</em></div>
        <div class="ix-out"><p class="ix-h">[[交给客户||For the client]]</p>
          <p class="ix-fmt"><b>PNG</b><span>JPEG</span></p>
          <ul>{files}</ul></div>
      </div>'''


ICON = {
    'art': '<path d="M4 5h16v14H4z"/><path d="M4 15l5-5 4 4 3-3 4 4"/>',
    'ver': '<path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="8"/>',
    'chat': '<path d="M5 6h14v9H9l-4 3z"/>',
    'key': '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
    'mac': '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M2 20h20"/>',
}


def ic(k):
    return '<svg viewBox="0 0 24 24" aria-hidden="true">%s</svg>' % ICON[k]


def diagram():
    rows = ''.join('<li>%s[[%s||%s]]%s</li>' % (ic(k), zh, en, '<em>[[加密||encrypted]]</em>' if k == 'key' else '')
                   for k, zh, en in [('art', '作品', 'Artwork'), ('ver', '版本', 'Versions'), ('chat', '对话', 'Chats'), ('key', '密钥', 'Keys')])
    return f'''<div class="dia" role="img" aria-label="[[示意图：作品、版本、对话和加密的密钥都在你的 Mac 上；模型和图片请求直接发给你配置的服务商；不需要 Molly 云账户。||Diagram: artwork, versions, chats and encrypted keys stay on your Mac; model and image requests go straight to the providers you configure; no Molly cloud account.]]">
        <div class="mhead"><span class="ml">[[数据怎么走||Where things go]]</span><span class="chip ill">[[示意图||Diagram]]</span></div>
        <div class="dg zz" data-anim>
          <div class="dg-mac"><p class="dg-h">{ic('mac')}[[你的 Mac||Your Mac]]</p><ul>{rows}</ul></div>
          <div class="dg-link"><span class="ln"><i></i><i></i></span><span class="ln"><i></i><i></i></span><em>[[直接请求||direct]]</em></div>
          <div class="dg-prov"><p class="dg-h">[[你配置的服务商||Providers you configure]]</p><span class="nd"><i></i>[[对话模型||Chat models]]</span><span class="nd"><i></i>[[图片模型||Image models]]</span></div>
        </div>
        <p class="dg-no"><span>[[Molly 云账户||Molly cloud account]]</span><b>[[不需要||Not needed]]</b></p>
      </div>'''


GLYPH = [
    '<svg viewBox="0 0 120 72" aria-hidden="true"><text x="6" y="54" class="g-t">Aa</text><path class="g-c" d="M79 16v44"/><rect class="g-s" x="2" y="10" width="88" height="56" rx="3"/><rect class="g-h" x="-1" y="7" width="6" height="6"/><rect class="g-h" x="87" y="63" width="6" height="6"/></svg>',
    '<svg viewBox="0 0 120 72" aria-hidden="true"><circle class="g-f" cx="34" cy="38" r="22"/><path class="g-l" d="M58 60L112 14"/><rect class="g-h" x="55" y="57" width="6" height="6"/><rect class="g-h" x="109" y="11" width="6" height="6"/><circle class="g-o" cx="34" cy="38" r="22"/></svg>',
    '<svg viewBox="0 0 120 72" aria-hidden="true"><rect class="g-b" x="30" y="4" width="70" height="44" rx="5"/><rect class="g-b" x="20" y="14" width="70" height="44" rx="5"/><rect class="g-i" x="10" y="24" width="70" height="44" rx="5"/><path class="g-m" d="M10 58l20-16 14 11 10-8 26 21"/></svg>',
]


def body():
    t = CFG['text']
    def tile(w):
        return ('<figure class="wt"><div class="art">%s</div><figcaption><b>[[%s||%s]]</b>[[%s||%s]]</figcaption></figure>'
                % (pic(w['img'], w['alt'][0], w['alt'][1], sizes='(max-width:640px) 90vw, (max-width:1040px) 45vw, 360px'),
                   w['title'][0], w['title'][1], w['cap'][0], w['cap'][1]))
    wall = ''.join('<div class="wcol">%s</div>' % ''.join(tile(w) for w in col) for col in CFG['wall'])
    trio = ''.join(
        '<figure><p class="tn" aria-hidden="true">0%d</p>%s<figcaption><b>[[%s||%s]]</b>[[%s||%s]]</figcaption></figure>'
        % (i + 1, media('[[%s||%s]]' % tuple(f['bar']), pic(f['img'], f['alt'][0], f['alt'][1], sizes='(max-width:860px) 100vw, 380px')),
           f['title'][0], f['title'][1], f['cap'][0], f['cap'][1]) for i, f in enumerate(CFG['trio']))

    ills = {'brief': ('[[新建设计||New design]]', ill_brief()), 'export': ('[[导出||Export]]', ill_export())}

    def wf(n, key):
        w = CFG['wf'][key]
        if key in ills:
            shot = media(ills[key][0], ills[key][1], ill=True)
        else:
            vis = vid(w['video'], *w['alt']) if w.get('video') else pic(w['img'], *w['alt'], sizes='(max-width:1040px) 100vw, 680px')
            shot = media('[[%s||%s]]' % tuple(w['bar']), vis)
        return f'''
    <div class="wf" id="w{n}">
      <div class="wf-t"><div class="n" aria-hidden="true"><span>0{n}</span><i></i></div><h3>[[{w['h'][0]}||{w['h'][1]}]]</h3><p class="why">[[{w['why'][0]}||{w['why'][1]}]]</p>
        <p>[[{w['p'][0]}||{w['p'][1]}]]</p></div>
      {shot}
    </div>'''

    demo = CFG['demo']
    tabs = ''.join('<button type="button" role="tab" id="t-%s" aria-controls="%s" aria-selected="%s" tabindex="%s"><b>%s</b>[[%s||%s]]</button>'
                   % (d['id'], d['id'], 'true' if i == 0 else 'false', '0' if i == 0 else '-1', 'AB'[i], d['tab'][0], d['tab'][1])
                   for i, d in enumerate(demo))
    panels = ''
    for i, d in enumerate(demo):
        vis = vid(d['video'], *d['alt']) if d.get('video') else pic(d['img'], *d['alt'], sizes='(max-width:860px) 100vw, 1100px')
        label = 'Molly Design · [[%s||%s]]' % tuple(d['tab'])
        panels += ('<div class="dpanel" role="tabpanel" id="%s" aria-labelledby="t-%s"%s>%s<p class="cap"><b aria-hidden="true">%s</b>[[%s||%s]]</p></div>'
                   % (d['id'], d['id'], '' if i == 0 else ' hidden', media(label, vis, REALV if d.get('video') else REAL), 'AB'[i], d['cap'][0], d['cap'][1]))

    trust = [('原生', 'Native', S('trust1'), '<circle cx="12" cy="9" r="5"/><path d="M8.5 13.5L7 21l5-3 5 3-1.5-7.5"/>'),
             ('本地', 'Local', S('trust2'), '<rect x="3" y="14" width="18" height="6" rx="1.5"/><path d="M5 14l2-8h10l2 8M17 17h.01"/>'),
             ('自带密钥', 'Your keys', S('trust3'), '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3M14 9l2 2"/>'),
             ('更新', 'Updates', S('trust4'), '<path d="M4 12a8 8 0 0114-5.3M20 12a8 8 0 01-14 5.3M18 3v4h-4M6 21v-4h4"/>')]
    trust_li = ''.join('<li><span class="ti"><svg viewBox="0 0 24 24" aria-hidden="true">%s</svg></span><div><em>[[%s||%s]]</em><span>%s</span></div></li>'
                       % (svg, zh, en, txt) for zh, en, txt, svg in trust)

    cards1 = [('文字是真文字', 'Real text', 'p1_b1'), ('形状是矢量', 'Real shapes', 'p1_b2'), ('图片只占一层', 'The image is one layer', 'p1_b3')]
    grid1 = ''.join('<div class="card gc"><div class="gl">%s</div><p class="num">0%d</p><h3 class="h4">[[%s||%s]]</h3><p>%s</p></div>'
                    % (GLYPH[i], i + 1, zh, en, S(k)) for i, (zh, en, k) in enumerate(cards1))

    faq = ''.join('<details><summary><i>%02d</i><span>[[%s||%s]]</span><b class="pm" aria-hidden="true"></b></summary><div class="fa"><p>[[%s||%s]]</p></div></details>'
                  % ((n + 1,) + tuple(q)) for n, q in enumerate(CFG['faq']))
    fc = ''.join('<img class="fc-i c%d" src="@@A:%s@@" width="280" height="280" alt="" aria-hidden="true" loading="lazy" fetchpriority="low" decoding="async">'
                 % (i, MAN['img'][k]['files']['280']) for i, k in enumerate(HERO_TILES))

    return f'''<body>
<a class="skip" href="#main">[[跳到正文||Skip to content]]</a>
<header class="top" id="top">
  <div class="wrap">
    <a class="brand" href="#main" aria-label="Molly Design"><img src="@@A:brand/molly-wordmark.svg@@" width="91" height="30" alt="Molly Design"></a>
    <nav class="links" id="nav" aria-label="[[主导航||Main]]">
      <a href="#demo">[[演示||Demo]]</a>
      <a href="#story">[[工作流程||Workflow]]</a>
      <a href="#why">[[为什么是 Molly||Why Molly]]</a>
      <a href="#cases">[[作品||Work]]</a>
      <a href="#faq">[[常见问题||FAQ]]</a>
    </nav>
    <a class="nav-github" href="{GH}" target="_blank" rel="noopener noreferrer" aria-label="{GITHUB_LABEL}" title="{GITHUB_LABEL}">{GITHUB_MARK}</a>
    <div class="lang" role="group" aria-label="Language / 语言">
      <button type="button" data-set="zh" lang="zh-CN">中</button>
      <button type="button" data-set="en" lang="en">EN</button>
    </div>
    <button type="button" class="menu" aria-controls="nav" aria-expanded="false" aria-label="菜单 / Menu"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
    <a class="btn" href="{DMG}" download>{DL}{CTA}</a>
  </div>
  <span class="prog" aria-hidden="true"></span>
</header>

<main id="main">
<div class="hero"><div class="hero-amb zz" data-anim aria-hidden="true"><i class="g1"></i><i class="g2"></i></div><div class="wrap hero-in">
  <div class="hero-copy">
    <p class="eyebrow">[[Mac 桌面应用||Mac app]]</p>
    <h1>{S('h1')}</h1>
    <div class="hero-side">
      <p class="sub">{S('sub')}</p>
      <div class="cta-row"><a class="btn lg" href="{DMG}" download>{DL}{CTA}</a><a class="ghost" href="#demo">[[看演示||Watch the demo]]</a></div>
      <p class="cta-note">{S('note')}</p>
    </div>
  </div>
  {hero_stage()}
</div></div>

<div class="trust"><div class="wrap"><ul>{trust_li}</ul></div></div>

<section class="s-dark" id="demo" aria-labelledby="demo-h">
  <div class="wrap">
    <div class="sh"><p class="kicker">[[产品演示||Product demo]]</p><h2 id="demo-h">{S('demo_h')}</h2><p class="lead">{S('demo_lead')}</p></div>
    <div class="stage-d">
      <div class="tabs" role="tablist" aria-label="[[演示片段||Demo clips]]">{tabs}</div>
      {panels}
    </div>
  </div>
</section>

<section class="s-cream sheet" id="story" aria-labelledby="story-h">
  <div class="wrap"><div class="sh"><p class="kicker">[[工作流程||Workflow]]</p><h2 id="story-h">{S('wf_h')}</h2><p class="lead">{S('wf_lead')}</p></div></div>
  <nav class="steps" aria-label="[[流程步骤||Workflow steps]]"><div class="wrap">
    <a href="#w1"><b>1</b>[[写简报||Brief]]</a><a href="#w2"><b>2</b>[[找参考||References]]</a><a href="#w3"><b>3</b>[[挑方向||Direction]]</a><a href="#w4"><b>4</b>[[落成图层||Layers]]</a><a href="#w5"><b>5</b>[[客户回修||Revisions]]</a><a href="#w6"><b>6</b>[[导出交付||Export]]</a>
  </div><span class="fill" aria-hidden="true"></span></nav>
  <div class="wrap wfs">
    {wf(1, 'brief')}{wf(2, 'research')}{wf(3, 'options')}{wf(4, 'layers')}{wf(5, 'edit')}{wf(6, 'export')}
    <p class="wf-end"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 0114-5.3M20 12a8 8 0 01-14 5.3M18 3v4h-4M6 21v-4h4"/></svg><span>{S('wf_end')}</span></p>
  </div>
</section>

<section class="s-dark sheet" id="why" aria-labelledby="p1-h">
  <div class="wrap">
    <div class="sh"><p class="kicker">[[为什么是 Molly · 分层||Why Molly · Layers]]</p><h2 id="p1-h">{S('p1_h')}</h2><p class="lead">{S('p1_lead')}</p></div>
    <div class="pillar-shot">{media('Molly Design · [[图层||Layers]]', pic(CFG['p1_img'], *CFG['p1_alt']))}</div>
    <div class="grid3">{grid1}</div>
  </div>
</section>

<section class="s-cream sheet" aria-labelledby="p2-h">
  <div class="wrap">
    <div class="sh"><p class="kicker">[[为什么是 Molly · 自主探索||Why Molly · Explores first]]</p><h2 id="p2-h">{S('p2_h')}</h2><p class="lead">{S('p2_lead')}</p></div>
    <div class="trio">{trio}</div>
  </div>
</section>

<section class="s-dark sheet" aria-labelledby="p3-h">
  <div class="wrap">
    <div class="sh"><p class="kicker">[[为什么是 Molly · 留在本机||Why Molly · On your Mac]]</p><h2 id="p3-h">{S('p3_h')}</h2><p class="lead">{S('p3_lead')}</p></div>
    <div class="local">
      {diagram()}
      <ul class="ticks">
        <li>{S('p3_l1')}</li><li>{S('p3_l2')}</li><li>{S('p3_l3')}</li><li>{S('p3_l4')}</li>
      </ul>
    </div>
  </div>
</section>

<section class="s-cream sheet" id="cases" aria-labelledby="cases-h">
  <div class="wrap">
    <div class="sh sh-row"><div><p class="kicker">[[作品||Work]]</p><h2 id="cases-h">{S('cases_h')}</h2></div><p class="lead">{S('cases_lead')}<span class="chip real">[[Molly 导出原图||Exported from Molly]]</span></p></div>
    <div class="wall">{wall}</div>
  </div>
</section>

<section class="s-dark sheet" aria-labelledby="cmp-h">
  <div class="wrap">
    <div class="sh"><p class="kicker">[[对比||Compare]]</p><h2 id="cmp-h">[[和一键出图的工具比||Compared with one-shot image tools]]</h2></div>
    <table class="cmp">
      <thead><tr><th scope="col">[[维度||Aspect]]</th><th scope="col">[[一键出图工具（泛指）||One-shot image tools]]</th><th scope="col"><span>Molly Design</span></th></tr></thead>
      <tbody>{''.join('<tr><td>[[%s||%s]]</td><td><span class="mh" aria-hidden="true">[[一键出图工具||One-shot tools]]</span>[[%s||%s]]</td><td><span class="mh" aria-hidden="true">Molly Design</span>[[%s||%s]]</td></tr>' % tuple(r) for r in CFG['cmp'])}</tbody>
    </table>
    <p class="fine">[[表格概括的是常见产品形态，不对应任何一家的完整功能。||This sketches common product types, not any one vendor's full feature set.]]</p>
  </div>
</section>

<section class="s-forest sheet" aria-labelledby="m-h">
  <div class="wrap">
    <div class="sh"><p class="kicker">[[模型与密钥||Models &amp; keys]]</p><h2 id="m-h">[[用你自己的模型||Bring your own models]]</h2><p class="lead">{S('m_lead')}</p></div>
    <div class="grid3 mods">
      <div class="card"><p class="num">01</p><h3 class="h4">OpenAI</h3><p>[[用 ChatGPT 登录，或者粘贴 API key。||Sign in with ChatGPT or paste an API key.]]</p></div>
      <div class="card"><p class="num">02</p><h3 class="h4">Kimi Code</h3><p>[[会员 API key，或设备码登录。||Membership API key or device-code sign-in.]]</p></div>
      <div class="card"><p class="num">03</p><h3 class="h4">[[OpenAI 兼容接口||OpenAI-compatible]]</h3><p>[[自定义地址，可读取模型列表。Ollama、LM Studio 这类本地服务不填密钥也能用。||Any custom endpoint, with model discovery. Local services such as Ollama and LM Studio work without a key.]]</p></div>
    </div>
    <div class="mi card"><div><p class="num">[[图片生成||Image generation]]</p><h3 class="h4">[[图片模型单独设置||Image models are set up separately]]</h3></div><p>{S('m_img')}</p></div>
    <p class="note">[[能用哪些模型，取决于服务商和你的密钥。||Which models you can use depends on the provider and your key.]]</p>
  </div>
</section>

<section class="s-cream sheet" id="faq" aria-labelledby="faq-h">
  <div class="wrap faq-grid">
    <div class="faq-side"><div class="sh"><p class="kicker">[[常见问题||FAQ]]</p><h2 id="faq-h">[[常见问题||Common questions]]</h2></div>
      <p class="faq-more">[[没找到答案？||Didn’t find your answer?]] <a href="{GH}/issues">[[在 GitHub 上提问||Ask on GitHub]] ↗</a></p></div>
    <div class="faq">{faq}</div>
  </div>
</section>

<section class="final sheet" aria-labelledby="final-h">
  <div class="fc zz" data-anim aria-hidden="true">{fc}</div>
  <div class="wrap">
    <p class="kicker">Molly Design</p>
    <h2 id="final-h">[[在你的 Mac 上试试||Try it on your Mac]]</h2>
    <p>{S('final_p')}</p>
    <div class="cta-row"><a class="btn lg" href="{DMG}" download>{DL}{CTA}</a></div>
    <p class="links2"><a href="{GH}">[[GitHub 源码||Source on GitHub]]</a><a href="{GH}/issues">[[反馈问题||Report an issue]]</a></p>
  </div>
</section>
</main>

<footer>
  <div class="wrap">
    <div class="ft-top">
      <div class="ft-b"><img src="@@A:brand/molly-wordmark.svg@@" width="79" height="26" alt="Molly Design" loading="lazy"><p>[[给平面设计师的 Mac AI 设计工具。||AI design for graphic designers, on the Mac.]]</p></div>
      <nav aria-label="[[页脚||Footer]]"><a href="{DMG}" download>[[下载 macOS 版||Download for macOS]]</a><a class="footer-github" href="{GH}" target="_blank" rel="noopener noreferrer">{GITHUB_MARK}<span>[[GitHub||GitHub]]</span></a><a href="{GH}/issues">Issues</a></nav>
    </div>
    <small>[[基于 Lody 构建；Bento 等组件保留各自的许可。||Built on Lody. Bento and other components keep their own licenses.]]</small>
    <img class="ft-mark" src="@@A:brand/molly-wordmark.svg@@" width="1747" height="576" alt="" aria-hidden="true" loading="lazy">
  </div>
</footer>
<script>
{(HERE / 'site.js').read_text()}
</script>
</body>
</html>
'''


def build():
    html = pairs(head() + body())
    if re.search(r'ph-tag|ph-block|placeholder|占位', html, re.I):
        sys.exit('placeholder markup left in page')
    if RELEASE_PAGE.search(html):
        sys.exit('release-page URL left in page; downloads must use DMG')
    used = sorted(set(re.findall(r'@@A:([^@]+)@@', html)))
    roots = sorted(set(re.findall(r'@@R:([^@]+)@@', html)))
    for u in used:
        if not (SRC / u).exists():
            sys.exit('missing asset ' + u)

    # dist/: only used assets, content-hashed under /assets/, root files unhashed
    SITE_DIR.mkdir(exist_ok=True)
    for c in SITE_DIR.iterdir():
        shutil.rmtree(c) if c.is_dir() else c.unlink()
    (SITE_DIR / 'assets').mkdir()
    amap = {}
    for u in used:
        p = SRC / u
        h = hashlib.sha256(p.read_bytes()).hexdigest()[:10]
        dest = pathlib.Path('assets') / (u.rsplit('.', 1)[0].replace('/', '-') + '.' + h + '.' + u.rsplit('.', 1)[1])
        shutil.copyfile(p, SITE_DIR / dest)
        amap[u] = '/' + dest.as_posix()
    for f in (SRC / 'icons').iterdir():
        shutil.copyfile(f, SITE_DIR / f.name)
    shutil.copyfile(SRC / 'og.png', SITE_DIR / 'og.png')
    s = re.sub(r'@@A:([^@]+)@@', lambda m: amap[m.group(1)], html)
    s = re.sub(r'@@R:([^@]+)@@', r'/\1', s)
    (SITE_DIR / 'index.html').write_text(s, encoding='utf-8')

    nf = (HERE / '404.html').read_text()
    nf = re.sub(r'@@A:([^@]+)@@', lambda m: amap.get(m.group(1)) or sys.exit('404 uses unshipped ' + m.group(1)), nf)
    nf = nf.replace('@@DMG@@', DMG)
    if RELEASE_PAGE.search(nf):
        sys.exit('release-page URL left in 404')
    (SITE_DIR / '404.html').write_text(nf, encoding='utf-8')
    (SITE_DIR / 'robots.txt').write_text('User-agent: *\nAllow: /\n\nSitemap: %s/sitemap.xml\n' % SITE)
    (SITE_DIR / 'sitemap.xml').write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>%s/</loc></url>\n</urlset>\n' % SITE)
    shutil.copyfile(HERE / '_headers', SITE_DIR / '_headers')
    print('dist/index.html', len(s.encode()), 'sha256', hashlib.sha256(s.encode()).hexdigest(), 'assets', len(used))


build()
