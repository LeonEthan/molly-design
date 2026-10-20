#!/usr/bin/env python3
"""Builds the Molly Design website into dist/ (Cloudflare Pages deploy folder)."""
import hashlib, json, pathlib, re, shutil, sys, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent
SRC = ROOT / 'assets'
SITE_DIR = ROOT / 'dist'
HERE = ROOT / 'src'
SITE = 'https://molly-design.pages.dev'
DMG_FALLBACK = 'https://github.com/LeonEthan/molly-design/releases/download/v0.1.1/MollyDesign-0.1.1-arm64.dmg'
DMG = DMG_FALLBACK
GH = 'https://github.com/LeonEthan/molly-design'
DOWNLOAD = GH + '/releases/latest'
RELEASES = GH + '/releases'
MAN = json.loads((SRC / 'manifest.json').read_text())
CFG = {}
DL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 20h14"/></svg>'
GITHUB_MARK = '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true" focusable="false"><path d="M6.766 11.328c-2.063-.25-3.516-1.734-3.516-3.656 0-.781.281-1.625.75-2.188-.203-.515-.172-1.609.063-2.062.625-.078 1.468.25 1.968.703.594-.187 1.219-.281 1.985-.281.765 0 1.39.094 1.953.265.484-.437 1.344-.765 1.969-.687.218.422.25 1.515.046 2.047.5.593.766 1.39.766 2.203 0 1.922-1.453 3.375-3.547 3.64.531.344.89 1.094.89 1.954v1.625c0 .468.391.734.86.547C13.781 14.359 16 11.53 16 8.03 16 3.61 12.406 0 7.984 0 3.563 0 0 3.61 0 8.031a7.88 7.88 0 0 0 5.172 7.422c.422.156.828-.125.828-.547v-1.25c-.219.094-.5.156-.75.156-1.031 0-1.64-.562-2.078-1.609-.172-.422-.36-.672-.719-.719-.187-.015-.25-.093-.25-.187 0-.188.313-.328.625-.328.453 0 .844.281 1.25.86.313.452.64.655 1.031.655s.641-.14 1-.5c.266-.265.47-.5.657-.656"/></svg>'
GITHUB_LABEL = '[[在 GitHub 上查看 Molly Design||Molly Design on GitHub]]'
CTA = '[[下载 macOS 版||Download for macOS]]'
CTA_GH = '[[在 GitHub 看源码||View source on GitHub]]'
WF_KEYS = ('brief', 'research', 'options', 'layers', 'edit', 'export')
TITLE_EN = 'Molly Design · AI design for graphic designers, in layers you can edit'
TITLE_ZH = 'Molly Design · 给平面设计师的 AI 设计工具，分层设计稿可以接着改'
DESC_EN = (
    'An AI design app for graphic designers on your computer. Describe the job and get back a layered file: '
    'real text, shapes and images you can keep editing.'
)
DESC_ZH = '给平面设计师的 AI 设计工具，在你的电脑上。说清要做什么，拿回分好层的设计稿，文字、形状、图片都能接着改。'


def pairs(s):
    s = re.sub(
        r'([a-z][\w-]*)="\[\[(.*?)\|\|(.*?)\]\]"',
        lambda m: '%s="%s" data-%s-zh="%s" data-%s-en="%s"'
        % (m.group(1), m.group(3), m.group(1), m.group(2), m.group(1), m.group(3)),
        s,
    )
    return re.sub(
        r'\[\[(.*?)\|\|(.*?)\]\]',
        lambda m: '<span data-l="zh">%s</span><span data-l="en">%s</span>' % (m.group(1), m.group(2)),
        s,
        flags=re.S,
    )


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
    return (
        '<img%s src="@@A:%s@@" srcset="%s" sizes="%s" width="%d" height="%d" %s %s decoding="async">'
        % (c, big, srcset, sizes, m['w'], m['h'], alt(zh, en), load)
    )


def vid(key, zh, en, cls=''):
    m = MAN['video'][key]
    p = MAN['img'][m['poster']]
    pw = sorted(int(w) for w in p['files'])[-1]
    c = ' class="%s"' % cls if cls else ''
    return (
        '<video muted playsinline preload="none" width="%d" height="%d" style="--ar:%d/%d" poster="@@A:%s@@" aria-label="%s" data-alt-zh="%s" data-alt-en="%s"%s><source src="@@A:%s@@" type="video/mp4"></video>'
        % (m['w'], m['h'], m['w'], m['h'], p['files'][str(pw)], esc(en), esc(zh), esc(en), c, m['file'])
    )


def S(name):
    v = CFG['text'][name]
    return '[[%s||%s]]' % (v[0], v[1])


def stable_releases(rows):
    """Published releases only. Drafts and prereleases are not site content."""
    stable = []
    for row in rows:
        if row.get('draft') or row.get('prerelease'):
            continue
        if not row.get('tag_name') or not row.get('published_at'):
            continue
        stable.append(row)
    return stable


def dmg_asset(row):
    for asset in row.get('assets') or []:
        url = asset.get('browser_download_url') or ''
        name = asset.get('name') or ''
        if name.endswith('.dmg') and url:
            return url
    return ''


def fetch_github():
    """Newest stable app DMG. Falls back offline.

    Scans the release list, not only the newest entry, so a draft,
    prerelease, or non-app release does not hide the current installer.
    """
    global DMG, CFG
    dmg = DMG_FALLBACK
    try:
        req = urllib.request.Request(
            'https://api.github.com/repos/LeonEthan/molly-design/releases?per_page=100',
            headers={'Accept': 'application/vnd.github+json', 'User-Agent': 'molly-design-website-build'},
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
        for row in stable_releases(data):
            found = dmg_asset(row)
            if found:
                dmg = found
                break
    except Exception:
        pass
    DMG = dmg
    CFG = json.loads((HERE / 'slots.json').read_text().replace('@@DMG@@', DMG))


def hero_h1():
    def lines(text):
        parts = [part.strip() for part in re.split(r'<br\s*/?>', text) if part.strip()]
        return ''.join('<span class="hero-line">%s</span>' % part for part in parts)

    zh, en = CFG['text']['h1']
    return '[[%s||%s]]' % (lines(zh), lines(en))


def trust_line():
    a, b = CFG['text']['trust2'], CFG['text']['trust3']
    zh = a[0].rstrip('。') + '。' + b[0].rstrip('。') + '。'
    en = a[1].rstrip('.') + '. ' + b[1].rstrip('.') + '.'
    return '[[%s||%s]]' % (zh, en)


def hero_stage():
    return f'''<div class="stage"><div class="stage-fit" role="img" aria-label="[[示意静帧：横版石材画面铺满画幅。左侧是可编辑的标题和材质说明，右侧是单独的粗陶茶壶图层。||Illustration: a landscape still filling the frame. Editable headline and material specs sit on the left. A separate stoneware kettle layer sits on the right.]]">
    <img class="hero-plate" src="@@A:img/hero-plate.webp@@" srcset="@@A:img/hero-plate-768.webp@@ 768w, @@A:img/hero-plate.webp@@ 1536w" sizes="(max-width:700px) calc(100vw - 40px), (max-width:1224px) calc(100vw - 64px), 1096px" width="1536" height="864" alt="" aria-hidden="true" fetchpriority="high" decoding="sync">
    <img class="hero-kettle" src="@@A:img/hero-kettle.webp@@" srcset="@@A:img/hero-kettle-480.webp@@ 480w, @@A:img/hero-kettle.webp@@ 1014w" sizes="(max-width:700px) 40vw, 442px" width="1014" height="782" alt="" aria-hidden="true">
    <div class="hero-copy">
      <p class="hs-mast"><span>Stillwater Clay</span><span>[[日常器物 / 01||Everyday objects / 01]]</span></p>
      <p class="hs-head">[[留一点时间，慢慢来。||Time, well spent.]]</p>
      <dl class="hs-spec"><div><dt>[[材质||Material]]</dt><dd>[[粗陶||Stoneware]]</dd></div><div><dt>[[表面||Finish]]</dt><dd>[[自然釉||Natural glaze]]</dd></div><div><dt>[[工艺||Made]]</dt><dd>[[手工修坯||Hand-finished]]</dd></div></dl>
      <p class="hs-cap"><span>[[让日常慢下来。||For the slower moments.]]</span><small>[[器物研究 · 2026||Object study · 2026]]</small></p>
    </div>
  </div></div>'''


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
    rows = ''.join(
        '<li>%s[[%s||%s]]%s</li>'
        % (ic(k), zh, en, '<em>[[加密||encrypted]]</em>' if k == 'key' else '')
        for k, zh, en in [
            ('art', '作品', 'Artwork'),
            ('ver', '版本', 'Versions'),
            ('chat', '对话', 'Chats'),
            ('key', '密钥', 'Keys'),
        ]
    )
    return f'''<div class="dia" role="img" aria-label="[[示意图：作品、版本、对话和加密的密钥都在你的电脑上；模型和图片请求直接发给你配置的服务商；不需要 Molly 云账户。||Diagram: artwork, versions, chats and encrypted keys stay on your computer; model and image requests go straight to the providers you configure; no Molly cloud account.]]">
        <div class="dg">
          <div class="dg-mac"><p class="dg-h">{ic('mac')}[[你的电脑||Your computer]]</p><ul>{rows}</ul></div>
          <div class="dg-link"><span class="ln"><i></i><i></i></span><span class="ln"><i></i><i></i></span><em>[[直接请求||direct]]</em></div>
          <div class="dg-prov"><p class="dg-h">[[你配置的服务商||Providers you configure]]</p><span class="nd"><i></i>[[对话模型||Chat models]]</span><span class="nd"><i></i>[[图片模型||Image models]]</span></div>
        </div>
        <p class="dg-no"><span>[[Molly 云账户||Molly cloud account]]</span><b>[[不需要||Not needed]]</b></p>
      </div>'''


SEND = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m0 0l-6 6m6-6l6 6"/></svg>'


def words(zh, en):
    def wrap(parts, sep):
        return sep.join('<span style="--i:%d">%s</span>' % (i, w) for i, w in enumerate(parts))

    zh_parts = re.findall(r'[^，。？]+[，。？]?', zh)
    return '<span data-l="zh">%s</span><span data-l="en">%s</span>' % (wrap(zh_parts, ''), wrap(en.split(' '), ' '))


def ill_brief():
    sizes = [
        ('auto', '自动', 'Auto size', '按简报', 'by brief'),
        ('sq', '方图', 'Square', '1080×1080', '1080×1080'),
        ('po', '竖版', 'Portrait', '1080×1350', '1080×1350'),
        ('st', '竖屏', 'Story', '1080×1920', '1080×1920'),
        ('la', '横版', 'Landscape', '1920×1080', '1920×1080'),
        ('lo', '长图', 'Long image', '1080×2400', '1080×2400'),
    ]
    cells = ''.join(
        '<span class="%s"><i class="r-%s"></i><b>[[%s||%s]]</b><em>[[%s||%s]]</em></span>'
        % ('on' if k == 'po' else '', k, zh, en, mz, me)
        for k, zh, en, mz, me in sizes
    )
    text = words(
        '给海边的周末陶器市集做一张海报，温暖、安静、有手作感。先找几张参考，给我看两三个方向？',
        'A poster for a weekend ceramics market by the harbour. Warm, calm and handmade. Find a few references and show me a couple of directions first?',
    )
    return f'''<div class="ill-c ib" role="img" aria-label="[[示意：新建设计的输入框里写着一句简报，下面是尺寸预设：按简报自动、方图、竖版、竖屏、横版和长图。||Illustration: the new-design box with a one-line brief, above the size presets: auto by brief, square, portrait, story, landscape and long image.]]">
        <div class="ib-box"><p class="ib-text">{text}<i class="ib-caret"></i></p>
          <div class="ib-row"><span class="ib-plus">+</span><span class="ib-chip"><i></i>1080 × 1350</span><span class="ib-send">{SEND}</span></div></div>
        <div class="ib-sizes">{cells}</div>
      </div>'''


def wf_shot(key):
    w = CFG['wf'][key]
    if key == 'brief':
        return ill_brief()
    if key == 'export':
        d = CFG['demo'][1]
        return pic(d['img'], d['alt'][0], d['alt'][1], sizes='(max-width:1040px) 100vw, 900px')
    return pic(w['img'], w['alt'][0], w['alt'][1], sizes='(max-width:1040px) 100vw, 900px')


def head():
    desc_en = DESC_EN
    desc_zh = DESC_ZH
    title = TITLE_EN
    jsonld = json.dumps(
        {
            '@context': 'https://schema.org',
            '@type': 'SoftwareApplication',
            'name': 'Molly Design',
            'applicationCategory': 'DesignApplication',
            'operatingSystem': 'macOS',
            'url': SITE + '/',
            'downloadUrl': DOWNLOAD,
            'image': SITE + '/og.png',
            'description': desc_en,
            'offers': {'@type': 'Offer', 'price': '0', 'priceCurrency': 'USD'},
        },
        ensure_ascii=False,
    )
    theme_boot = (
        "(function(){var t=null;try{t=localStorage.getItem('molly-theme')}catch(e){}"
        "if(t!=='light'&&t!=='dark')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';"
        "document.documentElement.setAttribute('data-theme',t);})();"
    )
    lang_boot = (
        "(function(){var l=null;try{l=localStorage.getItem('molly-lang')}catch(e){}"
        "if(l!=='zh'&&l!=='en')l=/^zh/i.test(navigator.language||'')?'zh':'en';"
        "var r=document.documentElement;r.setAttribute('data-lang',l);r.lang=l==='zh'?'zh-CN':'en';"
        "var t=r.getAttribute('data-title-'+l);if(t)document.title=t;"
        "var md=document.querySelector('meta[name=description]');var d=r.getAttribute('data-desc-'+l);if(md&&d)md.setAttribute('content',d);})();"
    )
    return f'''<!doctype html>
<html lang="zh-CN" data-lang="zh" data-title-zh="{esc(TITLE_ZH)}" data-title-en="{esc(TITLE_EN)}" data-desc-zh="{esc(DESC_ZH)}" data-desc-en="{esc(DESC_EN)}">
<head>
<meta charset="utf-8">
<!-- SITE_URL={SITE} -->
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc_en} {desc_zh}">
<meta name="theme-color" content="#f6f1e6">
<meta name="color-scheme" content="light dark">
<link rel="canonical" href="{SITE}/">
<link rel="icon" href="@@R:favicon.ico@@" sizes="32x32">
<link rel="icon" href="@@R:favicon.svg@@" type="image/svg+xml">
<link rel="apple-touch-icon" href="@@R:apple-touch-icon.png@@">
<link rel="manifest" href="@@R:site.webmanifest@@">
<link rel="preload" as="image" href="@@A:img/hero-plate-768.webp@@" imagesrcset="@@A:img/hero-plate-768.webp@@ 768w, @@A:img/hero-plate.webp@@ 1536w" imagesizes="(max-width:700px) calc(100vw - 40px), (max-width:1224px) calc(100vw - 64px), 1096px" fetchpriority="high">
<link rel="preload" href="@@A:fonts/inter.woff2@@" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="@@A:fonts/instrument-serif.woff2@@" as="font" type="font/woff2" crossorigin>
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
<script>{theme_boot}</script>
<script>{lang_boot}</script>
<style>
{(HERE / 'style.css').read_text()}
</style>
</head>
'''


def body():
    demo = CFG['demo'][0]
    bullets = ''.join('<li>%s</li>' % S('p1_b%d' % i) for i in (1, 2, 3))

    def wall_tile(w, cls=''):
        return (
            '<figure class="wt%s"><div class="shot">%s</div><figcaption><b>[[%s||%s]]</b>[[%s||%s]]</figcaption></figure>'
            % (
                (' ' + cls) if cls else '',
                pic(w['img'], w['alt'][0], w['alt'][1], sizes='(max-width:700px) 100vw, 520px'),
                w['title'][0],
                w['title'][1],
                w['cap'][0],
                w['cap'][1],
            )
        )

    by_img = {w['img']: w for col in CFG['wall'] for w in col}
    wall_html = (
        '<div class="wall-side">%s<div class="wall-sq">%s%s</div></div>%s%s'
        % (
            wall_tile(by_img['s-kv'], 'w-wide'),
            wall_tile(by_img['s-social']),
            wall_tile(by_img['s-packaging']),
            wall_tile(by_img['s-detail'], 'w-tall'),
            wall_tile(by_img['s-longform'], 'w-tall'),
        )
    )

    steps = ''.join(
        '<button type="button" class="wf-step%s" data-wf="%s" role="tab" aria-selected="%s" tabindex="%s"><i>%02d</i><span>[[%s||%s]]</span></button>'
        % (' on' if i == 0 else '', k, 'true' if i == 0 else 'false', '0' if i == 0 else '-1', i + 1, CFG['wf'][k]['h'][0], CFG['wf'][k]['h'][1])
        for i, k in enumerate(WF_KEYS)
    )

    wf_panels = ''.join(
        '<div class="wf-panel%s" data-wf="%s" role="tabpanel"%s><h3>[[%s||%s]]</h3><p>[[%s||%s]]</p><div class="shot wf-shot">%s</div></div>'
        % (
            ' on' if i == 0 else '',
            k,
            '' if i == 0 else ' hidden',
            CFG['wf'][k]['why'][0],
            CFG['wf'][k]['why'][1],
            CFG['wf'][k]['p'][0],
            CFG['wf'][k]['p'][1],
            wf_shot(k),
        )
        for i, k in enumerate(WF_KEYS)
    )

    faq = ''.join(
        '<details><summary><span>[[%s||%s]]</span><b class="pm" aria-hidden="true"></b></summary><div class="fa"><p>[[%s||%s]]</p></div></details>'
        % (q[0], q[1], q[2], q[3])
        for q in CFG['faq']
    )

    return f'''<body>
<a class="skip" href="#main">[[跳到正文||Skip to content]]</a>
<header class="top" id="top">
  <div class="wrap top-in">
    <a class="brand" href="#main" aria-label="Molly Design"><img src="@@A:brand/molly-wordmark.svg@@" width="91" height="30" alt="Molly Design"></a>
    <div class="nav-cluster">
    <nav class="links" id="nav" aria-label="[[主导航||Main]]">
      <a href="#demo">[[演示||Demo]]</a>
      <a href="#workflow">[[工作流程||Workflow]]</a>
      <a href="#work">[[作品||Work]]</a>
      <a href="{RELEASES}">[[更新||Releases]]</a>
      <a href="#faq">[[常见问题||FAQ]]</a>
    </nav>
    <span class="sp"></span>
    <div class="nav-tools">
    <div class="lang" role="group" aria-label="Language / 语言">
      <button type="button" data-set="zh" lang="zh-CN">中</button>
      <button type="button" data-set="en" lang="en">EN</button>
    </div>
    <div class="theme" role="group" aria-label="[[主题||Theme]]">
      <button type="button" data-theme-set="light" aria-label="[[浅色||Light]]">☀</button>
      <button type="button" data-theme-set="dark" aria-label="[[深色||Dark]]">☾</button>
    </div>
    </div>
    </div>
    <a class="btn accent nav-dl" href="{DOWNLOAD}">{CTA}</a>
    <a class="btn ic nav-github" href="{GH}" target="_blank" rel="noopener noreferrer" aria-label="{GITHUB_LABEL}" title="{GITHUB_LABEL}">{GITHUB_MARK}</a>
    <button type="button" class="menu" aria-controls="nav" aria-expanded="false" aria-label="菜单 / Menu"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
  </div>
</header>

<main id="main">
<header class="hero">
  <div class="wrap hero-in">
    <h1 class="serif">{hero_h1()}</h1>
    {hero_stage()}
  </div>
</header>

<div class="band lime">
  <div class="wrap strip">
    <div><h2 class="h3">[[能接着做的源文件||A real working file]]</h2><p>[[真文字、矢量形状和一层图片，都在同一份设计稿里。||Real text, vector shapes and one image layer in the same file.]]</p></div>
    <div><h2 class="h3">{S('p2_h')}</h2><p>[[几套方向并排摆出来，你选一套，它就按那套出稿。||Pick one of a few directions, and Molly builds that one.]]</p></div>
    <div><h2 class="h3">[[留在你的电脑上||Stays on your computer]]</h2><p>{trust_line()}</p></div>
  </div>
</div>

<section class="feat" id="demo" aria-labelledby="p1-h">
  <div class="wrap">
    <div class="fh"><div><h2 class="serif" id="p1-h">{S('p1_h')}</h2></div><p>{S('p1_lead')}</p></div>
    <ul class="ticks layers-ticks">{bullets}</ul>
    <div class="shot">{pic(CFG['p1_img'], CFG['p1_alt'][0], CFG['p1_alt'][1], sizes='(max-width:1040px) 100vw, 1100px')}</div>
    <div class="edit-block" hidden>
      <p class="cap">[[{demo['cap'][0]}||{demo['cap'][1]}]]</p>
      {vid(demo['video'], demo['alt'][0], demo['alt'][1], cls='edit-vid')}
    </div>
    <button type="button" class="more watch-edit">[[看改字录屏 →||Watch the edit →]]</button>
  </div>
</section>

<section class="feat" id="directions" aria-labelledby="p2-h">
  <div class="wrap">
    <div class="fh"><div><h2 class="serif" id="p2-h">{S('p2_h')}</h2></div><p>{S('p2_lead')}</p></div>
    <div class="shot">{pic('p-research-v7c', CFG['trio'][0]['alt'][0], CFG['trio'][0]['alt'][1], sizes='(max-width:1040px) 100vw, 920px')}</div>
  </div>
</section>

<div class="band olive" id="workflow">
  <section class="feat" aria-labelledby="wf-h">
    <div class="wrap">
      <div class="fh"><div><h2 class="serif" id="wf-h">{S('wf_h')}</h2></div><p>{S('wf_lead')}</p></div>
      <div class="steps" role="tablist" aria-label="[[流程步骤||Workflow steps]]">{steps}</div>
      <div class="wfbody">{wf_panels}</div>
      <p class="wf-end">{S('wf_end')}</p>
    </div>
  </section>
</div>

<section class="feat" id="export" aria-labelledby="export-h">
  <div class="wrap">
    <div class="fh"><div><h2 class="serif" id="export-h">[[{CFG['wf']['export']['why'][0]}||{CFG['wf']['export']['why'][1]}]]</h2></div><p>[[{CFG['wf']['export']['p'][0]}||{CFG['wf']['export']['p'][1]}]]</p></div>
    <div class="shot">{pic(CFG['demo'][1]['img'], CFG['demo'][1]['alt'][0], CFG['demo'][1]['alt'][1], sizes='(max-width:1040px) 100vw, 1100px')}</div>
    <div class="local">
      <div><h3 class="h4">{S('p3_h')}</h3><p class="lead-sm">{S('p3_lead')}</p><ul class="ticks">{''.join('<li>%s</li>' % S('p3_l%d' % i) for i in range(1, 5))}</ul></div>
      {diagram()}
    </div>
  </div>
</section>

<section class="feat" id="work" aria-labelledby="cases-h">
  <div class="wrap">
    <div class="fh"><div><h2 class="serif" id="cases-h">{S('cases_h')}</h2></div><p>{S('cases_lead')}</p></div>
    <div class="wall">{wall_html}</div>
  </div>
</section>

<section class="feat" id="models" aria-labelledby="m-h">
  <div class="wrap">
    <div class="fh"><div><h2 class="serif" id="m-h">[[用你自己的模型||Bring your own models]]</h2></div><p>{S('m_lead')}</p></div>
    <div class="grid3 mods">
      <div class="card"><p class="num">01</p><h3 class="h4">OpenAI</h3><p>[[用 ChatGPT 登录，或者粘贴 API key。||Sign in with ChatGPT or paste an API key.]]</p></div>
      <div class="card"><p class="num">02</p><h3 class="h4">Kimi Code</h3><p>[[会员 API key，或设备码登录。||Membership API key or device-code sign-in.]]</p></div>
      <div class="card"><p class="num">03</p><h3 class="h4">[[OpenAI 兼容接口||OpenAI-compatible]]</h3><p>[[自定义地址，可读取模型列表。Ollama、LM Studio 这类本地服务不填密钥也能用。||Any custom endpoint, with model discovery. Local services such as Ollama and LM Studio work without a key.]]</p></div>
    </div>
    <div class="mi card"><div><p class="num">[[图片生成||Image generation]]</p><h3 class="h4">[[图片模型单独设置||Image models are set up separately]]</h3></div><p>{S('m_img')}</p></div>
    <p class="note">[[能用哪些模型，取决于服务商和你的密钥。||Which models you can use depends on the provider and your key.]]</p>
  </div>
</section>

<section class="feat" id="faq" aria-labelledby="faq-h">
  <div class="wrap faq-wrap">
    <h2 class="serif" id="faq-h">[[常见问题||FAQ]]</h2>
    <div class="faq">{faq}</div>
  </div>
</section>

<div class="band olive end">
  <section class="close" aria-labelledby="final-h">
    <div class="wrap">
      <h2 class="serif" id="final-h">[[从<em>下一份需求</em>开始。||Start with your <em>next brief.</em>]]</h2>
      <p>{S('final_p')}</p>
      <div class="cta-row">
        <a class="btn accent" href="{DOWNLOAD}">{DL}{CTA}</a>
        <a class="btn ghost" href="{GH}" target="_blank" rel="noopener noreferrer">{CTA_GH}</a>
      </div>
    </div>
  </section>
  <footer>
    <div class="wrap ft">
      <div><img src="@@A:brand/molly-wordmark.svg@@" width="79" height="26" alt="Molly Design" loading="lazy"><p class="ft-copy">© 2026 Molly Design</p></div>
      <div><p class="ft-h">[[产品||Product]]</p><a href="#demo">[[图层||Layers]]</a><a href="#directions">[[方向||Directions]]</a><a href="#export">[[导出||Export]]</a></div>
      <div><p class="ft-h">[[资源||Resources]]</p><a href="{RELEASES}">[[更新||Releases]]</a><a href="#faq">[[常见问题||FAQ]]</a></div>
      <div><p class="ft-h">[[社区||Community]]</p><a class="footer-github" href="{GH}" target="_blank" rel="noopener noreferrer">{GITHUB_MARK}<span>GitHub</span></a></div>
    </div>
  </footer>
</div>
</main>
<script>
{(HERE / 'site.js').read_text()}
</script>
</body>
</html>
'''


def build():
    fetch_github()
    html = pairs(head() + body())
    if re.search(r'ph-tag|ph-block|placeholder|占位', html, re.I):
        sys.exit('placeholder markup left in page')
    used = sorted(set(re.findall(r'@@A:([^@]+)@@', html)))
    roots = sorted(set(re.findall(r'@@R:([^@]+)@@', html)))
    for u in used:
        if not (SRC / u).exists():
            sys.exit('missing asset ' + u)

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
    nf = nf.replace('@@LATEST@@', DOWNLOAD)
    (SITE_DIR / '404.html').write_text(nf, encoding='utf-8')
    (SITE_DIR / 'robots.txt').write_text('User-agent: *\nAllow: /\n\nSitemap: %s/sitemap.xml\n' % SITE)
    (SITE_DIR / 'sitemap.xml').write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>%s/</loc></url>\n</urlset>\n' % SITE
    )
    shutil.copyfile(HERE / '_headers', SITE_DIR / '_headers')
    print('dist/index.html', len(s.encode()), 'sha256', hashlib.sha256(s.encode()).hexdigest(), 'assets', len(used))


build()
