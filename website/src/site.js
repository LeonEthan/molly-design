(function () {
  var root = document.documentElement;
  function setAlts(l) {
    document.querySelectorAll('[data-alt-zh]').forEach(function (e) {
      var v = e.getAttribute('data-alt-' + l);
      if (e.tagName === 'VIDEO') e.setAttribute('aria-label', v);
      else e.setAttribute('alt', v);
    });
    ['aria-label', 'title'].forEach(function (a) {
      document.querySelectorAll('[data-' + a + '-zh]').forEach(function (e) {
        e.setAttribute(a, e.getAttribute('data-' + a + '-' + l));
      });
    });
  }
  function setLang(l, save) {
    root.setAttribute('data-lang', l);
    root.lang = l === 'zh' ? 'zh-CN' : 'en';
    setAlts(l);
    document.querySelectorAll('.lang button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-set') === l));
    });
    var title = root.getAttribute('data-title-' + l);
    var desc = root.getAttribute('data-desc-' + l);
    if (title) document.title = title;
    var meta = document.querySelector('meta[name="description"]');
    if (meta && desc) meta.setAttribute('content', desc);
    if (save) {
      try {
        localStorage.setItem('molly-lang', l);
      } catch (e) {}
    }
  }
  function setTheme(t, save) {
    root.setAttribute('data-theme', t);
    document.querySelectorAll('.theme button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-theme-set') === t));
    });
    if (save) {
      try {
        localStorage.setItem('molly-theme', t);
      } catch (e) {}
    }
  }
  setLang(root.getAttribute('data-lang') === 'en' ? 'en' : 'zh', false);
  var bootTheme = root.getAttribute('data-theme');
  if (bootTheme === 'light' || bootTheme === 'dark') setTheme(bootTheme, false);
  document.querySelectorAll('.lang button').forEach(function (b) {
    b.addEventListener('click', function () {
      setLang(b.getAttribute('data-set'), true);
    });
  });
  document.querySelectorAll('.theme button').forEach(function (b) {
    b.addEventListener('click', function () {
      setTheme(b.getAttribute('data-theme-set'), true);
    });
  });

  var top = document.querySelector('.top'),
    menu = document.querySelector('.menu');
  if (menu) {
    function closeMenu() {
      top.classList.remove('open');
      menu.setAttribute('aria-expanded', 'false');
    }
    menu.addEventListener('click', function () {
      var open = !top.classList.contains('open');
      top.classList.toggle('open', open);
      menu.setAttribute('aria-expanded', String(open));
    });
    document.querySelectorAll('#nav a').forEach(function (a) {
      a.addEventListener('click', closeMenu);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && top.classList.contains('open')) {
        closeMenu();
        menu.focus();
      }
    });
  }

  var wfSteps = [].slice.call(document.querySelectorAll('.wf-step'));
  var wfPanels = [].slice.call(document.querySelectorAll('.wf-panel'));
  function selectWf(btn, focus) {
    var key = btn.getAttribute('data-wf');
    wfSteps.forEach(function (s, i) {
      var on = s === btn;
      s.classList.toggle('on', on);
      s.setAttribute('aria-selected', String(on));
      s.tabIndex = on ? 0 : -1;
    });
    wfPanels.forEach(function (p) {
      var on = p.getAttribute('data-wf') === key;
      p.classList.toggle('on', on);
      p.hidden = !on;
    });
    if (focus) btn.focus();
  }
  wfSteps.forEach(function (btn, i) {
    btn.addEventListener('click', function () {
      selectWf(btn);
    });
    btn.addEventListener('keydown', function (e) {
      var j =
        e.key === 'ArrowRight'
          ? i + 1
          : e.key === 'ArrowLeft'
            ? i - 1
            : e.key === 'Home'
              ? 0
              : e.key === 'End'
                ? wfSteps.length - 1
                : null;
      if (j === null) return;
      e.preventDefault();
      selectWf(wfSteps[(j + wfSteps.length) % wfSteps.length], true);
    });
  });

  var watch = document.querySelector('.watch-edit');
  var editBlock = document.querySelector('.edit-block');
  if (watch && editBlock) {
    watch.addEventListener('click', function () {
      editBlock.hidden = false;
      watch.hidden = true;
      var v = editBlock.querySelector('video');
      if (v) {
        v.preload = 'auto';
        var r = v.play();
        if (r && r.catch) r.catch(function () {});
      }
      editBlock.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var vids = [].slice.call(document.querySelectorAll('video'));
  var seen = new Set();
  function playVisible() {
    if (reduce) return;
    vids.forEach(function (v) {
      if (seen.has(v) && !v.ended && v.offsetParent !== null) {
        var r = v.play();
        if (r && r.catch) r.catch(function () {});
      }
    });
  }
  if (reduce) vids.forEach(function (v) { v.controls = true; });
  if ('IntersectionObserver' in window && !reduce) {
    var vo = new IntersectionObserver(
      function (en) {
        en.forEach(function (x) {
          var v = x.target;
          if (x.isIntersecting) {
            if (v.ended) return;
            seen.add(v);
            if (v.preload === 'none') v.preload = 'auto';
            var r = v.play();
            if (r && r.catch) r.catch(function () {});
          } else {
            seen.delete(v);
            v.pause();
          }
        });
      },
      { threshold: 0.3 }
    );
    vids.forEach(function (v) {
      vo.observe(v);
      v.addEventListener('ended', function () {
        seen.delete(v);
        v.controls = true;
        vo.unobserve(v);
      });
    });
  }
})();

(function () {
  var hs = document.querySelector('.hs');
  if (!hs) return;
  var kettle = hs.querySelector('.hero-kettle'),
    next = null,
    gb = hs.querySelector('.hs-gb'),
    sweep = hs.querySelector('.hs-clip'),
    pill = hs.querySelector('.hs-pill'),
    cur = hs.querySelector('.hs-cur'),
    size = hs.querySelector('.hs-size');
  if (!kettle || !hs.dataset.kettleNext || !gb || !sweep || !pill || !cur || !size) return;
  var plate = hs.querySelector('.hero-plate'),
    motion = matchMedia('(prefers-reduced-motion: reduce)'),
    reduce = motion.matches,
    T = 10,
    t = 0,
    it = 0,
    raf = 0,
    last = 0,
    vis = false,
    ready = false;
  var REST_X = 0.44, REST_Y = 0.293, REST_W = 0.4, IMG = 782 / 1014;
  function clamp(x) { return Math.max(0, Math.min(1, x)); }
  function seg(time, a, b) { return clamp((time - a) / (b - a)); }
  function ease(x) { return x * x * (3 - 2 * x); }
  function mix(a, b, x) { return a + (b - a) * x; }
  function fade(time, a, b, c, d) { return Math.min(seg(time, a, b), 1 - seg(time, c, d)); }
  function alpha(e, n) { e.style.opacity = n <= 0 ? '0' : n >= 1 ? '1' : n.toFixed(3); }
  function place(e, x, y, w, h) {
    e.style.left = x.toFixed(2) + 'px';
    e.style.top = y.toFixed(2) + 'px';
    if (w !== undefined) e.style.width = w.toFixed(2) + 'px';
    if (h !== undefined) e.style.height = h.toFixed(2) + 'px';
  }
  function render(time) {
    var W = hs.clientWidth, H = hs.clientHeight;
    if (!W || !H) return;
    var move = ease(seg(time, 1.5, 2.25)),
      grown = ease(seg(time, 2.8, 3.55)),
      reset = ease(seg(time, 7.8, 9.25)),
      hold = 1 - reset,
      dx = -0.018 * move * hold,
      dy = -0.016 * move * hold,
      k = 1 + 0.06 * grown * hold,
      rw = REST_W * W,
      rh = rw * IMG,
      cx = REST_X * W + rw / 2 + dx * W,
      cy = REST_Y * H + rh / 2 + dy * H,
      bw = rw * k,
      bh = rh * k,
      x = cx - bw / 2,
      y = cy - bh / 2,
      pad = Math.max(6, W * 14 / 1536),
      box = { x: x - pad, y: y - pad, w: bw + pad * 2, h: bh + pad * 2 },
      magic = fade(time, 4, 4.65, 5.6, 6.3),
      shown = next && next.complete && next.naturalWidth && !reduce
        ? ease(seg(time, 4.25, 5.8)) * (1 - ease(seg(time, 7.8, 9.25)))
        : 0,
      shift = !reduce && (dx || dy || k !== 1)
        ? 'translate(' + (dx * W).toFixed(2) + 'px,' + (dy * H).toFixed(2) + 'px) scale(' + k.toFixed(4) + ')'
        : '';
    kettle.style.transform = shift;
    kettle.style.opacity = shown > 0 ? (1 - shown).toFixed(3) : '';
    if (next) {
      next.style.transform = shift;
      next.style.opacity = shown > 0 ? shown.toFixed(3) : '';
    }
    alpha(gb, reduce ? 0 : fade(time, 0.96, 1.08, 7.1, 7.5));
    place(gb, box.x, box.y, box.w, box.h);
    alpha(sweep, reduce ? 0 : magic);
    place(sweep, box.x, box.y, box.w, box.h);
    sweep.firstElementChild.style.backgroundPosition = (ease(seg(time, 4.25, 5.8)) * 140 - 20).toFixed(1) + '% 0';
    var glide = ease(seg(time, 0.1, 0.7)),
      tipX = mix(x + bw + W * 0.02, x + bw * 0.62, glide),
      tipY = mix(y + bh * 0.42, y + bh * 0.55, glide);
    if (time > 1.3) { tipX = x + bw * 0.62; tipY = y + bh * 0.55; }
    if (time > 2.45) {
      var toHandle = ease(seg(time, 2.45, 2.8));
      tipX = mix(x + bw * 0.62, box.x + box.w, toHandle);
      tipY = mix(y + bh * 0.55, box.y + box.h, toHandle);
    }
    var pillH = pill.offsetHeight || W * 34 / 1536,
      pillW = pill.offsetWidth || W * 120 / 1536,
      pillX = Math.min(Math.max(box.x + box.w / 2, pillW / 2 + 8), W - pillW / 2 - 8),
      pillY = Math.min(box.y + box.h + 8 + pillH / 2, H - 8 - pillH / 2);
    if (time > 3.6) {
      var toPill = ease(seg(time, 3.6, 3.95));
      tipX = mix(box.x + box.w, pillX, toPill);
      tipY = mix(box.y + box.h, pillY, toPill);
    }
    if (time > 3.95) {
      tipX = pillX;
      tipY = pillY;
    }
    var press = 1 - 0.12 * Math.min(ease(seg(time, 0.9, 0.96)), 1 - ease(seg(time, 0.96, 1.02)));
    press = Math.min(press, 1 - 0.12 * Math.min(ease(seg(time, 3.98, 4.06)), 1 - ease(seg(time, 4.06, 4.14))));
    cur.style.transform = 'translate(' + tipX.toFixed(2) + 'px,' + tipY.toFixed(2) + 'px) scale(' + press.toFixed(3) + ')';
    alpha(cur, reduce ? 0 : fade(time, 0.1, 0.35, 6.8, 7.2));
    cur.classList.toggle('rsz', time > 2.6 && time < 3.6);
    pill.style.transform = 'translate(' + pillX.toFixed(2) + 'px,' + pillY.toFixed(2) + 'px) translate(-50%,-50%)';
    alpha(pill, reduce ? 0 : fade(time, 3.5, 3.75, 6.4, 6.7));
    pill.classList.toggle('busy', time > 4 && time < 5.95);
    size.dataset.pct = Math.round(k * 100) + '%';
    size.style.transform = 'translate(' + (box.x + box.w - size.offsetWidth - 6).toFixed(2) + 'px,' + Math.max(6, box.y - size.offsetHeight - 6).toFixed(2) + 'px)';
    alpha(size, reduce ? 0 : fade(time, 2.7, 2.85, 3.55, 3.8));
    hs.dataset.time = time.toFixed(3);
    hs.dataset.iteration = String(it);
  }
  function frame(now) {
    var dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
    last = now;
    t += dt;
    while (t >= T) {
      t -= T;
      it++;
    }
    render(t);
    raf = requestAnimationFrame(frame);
  }
  function arm() {
    if (ready) return;
    ready = true;
    render(0);
    run();
  }
  function run() {
    var on = ready && vis && !document.hidden && !reduce;
    if (on && !raf) {
      last = 0;
      raf = requestAnimationFrame(frame);
    } else if (!on && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }
  new IntersectionObserver(function (entries) {
    vis = entries[0].isIntersecting;
    run();
  }).observe(hs);
  document.addEventListener('visibilitychange', run);
  motion.addEventListener('change', function () {
    reduce = motion.matches;
    if (reduce) {
      t = 0;
      it = 0;
      render(0);
    }
    run();
  });
  function loadNext() {
    var img = document.createElement('img');
    img.className = 'hero-kettle-next';
    img.alt = '';
    img.width = 1014;
    img.height = 782;
    img.decoding = 'async';
    img.setAttribute('aria-hidden', 'true');
    img.sizes = '(max-width:700px) 40vw, 438px';
    if (hs.dataset.kettleNextSrcset) img.srcset = hs.dataset.kettleNextSrcset;
    img.src = hs.dataset.kettleNext;
    kettle.insertAdjacentElement('afterend', img);
    next = img;
    var done = img.decode ? img.decode() : Promise.resolve();
    done.then(function () {}, function () {});
  }
  function boot() {
    arm();
    if (reduce) return;
    var started = false;
    function later() {
      if (started) return;
      started = true;
      loadNext();
    }
    try {
      new PerformanceObserver(function (list) {
        if (list.getEntries().length) later();
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch (e) {}
    setTimeout(later, 1500);
  }
  if (plate && plate.decode) plate.decode().then(boot, boot);
  else boot();
})();
