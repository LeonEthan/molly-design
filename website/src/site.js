(function(){
  var root=document.documentElement;
  function setAlts(l){
    document.querySelectorAll('[data-alt-zh]').forEach(function(e){
      var v=e.getAttribute('data-alt-'+l);
      if(e.tagName==='VIDEO')e.setAttribute('aria-label',v);else e.setAttribute('alt',v);
    });
    ['aria-label','title'].forEach(function(a){document.querySelectorAll('[data-'+a+'-zh]').forEach(function(e){e.setAttribute(a,e.getAttribute('data-'+a+'-'+l))})});
  }
  function setLang(l,save){
    root.setAttribute('data-lang',l);
    root.lang=l==='zh'?'zh-CN':'en';
    setAlts(l);
    document.querySelectorAll('.lang button').forEach(function(b){b.setAttribute('aria-pressed',String(b.getAttribute('data-set')===l))});
    if(save){try{localStorage.setItem('molly-lang',l)}catch(e){}}
  }
  setLang(root.getAttribute('data-lang')==='en'?'en':'zh',false);
  document.querySelectorAll('.lang button').forEach(function(b){
    b.addEventListener('click',function(){setLang(b.getAttribute('data-set'),true)});
  });

  var top=document.querySelector('.top'),menu=document.querySelector('.menu');
  function closeMenu(){top.classList.remove('open');menu.setAttribute('aria-expanded','false')}
  menu.addEventListener('click',function(){
    var open=!top.classList.contains('open');
    top.classList.toggle('open',open);menu.setAttribute('aria-expanded',String(open));
  });
  document.querySelectorAll('#nav a').forEach(function(a){a.addEventListener('click',closeMenu)});
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&top.classList.contains('open')){closeMenu();menu.focus()}});

  var tabs=[].slice.call(document.querySelectorAll('[role="tab"]'));
  function select(t,focus){
    tabs.forEach(function(x){
      var on=x===t;x.setAttribute('aria-selected',String(on));x.tabIndex=on?0:-1;
      var p=document.getElementById(x.getAttribute('aria-controls'));p.hidden=!on;
      if(!on)p.querySelectorAll('video').forEach(function(v){v.pause()});
    });
    if(focus)t.focus();
    playVisible();
  }
  tabs.forEach(function(t,i){
    t.addEventListener('click',function(){select(t)});
    t.addEventListener('keydown',function(e){
      var j=e.key==='ArrowRight'?i+1:e.key==='ArrowLeft'?i-1:e.key==='Home'?0:e.key==='End'?tabs.length-1:null;
      if(j===null)return;e.preventDefault();select(tabs[(j+tabs.length)%tabs.length],true);
    });
  });

  var steps=document.querySelectorAll('.steps a');
  var prog=top.querySelector('.prog'),navs=[].slice.call(document.querySelectorAll('#nav a')),spb=document.querySelector('.steps .fill'),story=document.getElementById('story'),tick=false;
  var tgts=navs.map(function(a){return document.querySelector(a.getAttribute('href'))});
  function onScroll(){
    tick=false;var y=window.scrollY,vh=window.innerHeight,h=root.scrollHeight-vh,cur=-1;
    top.classList.toggle('solid',y>24);prog.style.setProperty('--p',(h>0?Math.min(1,y/h):0).toFixed(4));
    if(story&&spb){var r=story.getBoundingClientRect();spb.style.setProperty('--p',Math.min(1,Math.max(0,(vh*.4-r.top)/r.height)).toFixed(4))}
    tgts.forEach(function(e,i){if(e&&e.getBoundingClientRect().top<vh*.4)cur=i});
    navs.forEach(function(a,i){a.classList.toggle('on',i===cur)});
  }
  window.addEventListener('scroll',function(){if(!tick){tick=true;requestAnimationFrame(onScroll)}},{passive:true});
  window.addEventListener('resize',onScroll,{passive:true});onScroll();
  var reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var vids=[].slice.call(document.querySelectorAll('video'));
  var seen=new Set();
  function playVisible(){
    if(reduce)return;
    vids.forEach(function(v){if(seen.has(v)&&!v.ended&&v.offsetParent!==null){var r=v.play();if(r&&r.catch)r.catch(function(){})}});
  }
  if(reduce){vids.forEach(function(v){v.controls=true})}
  var anims=[].slice.call(document.querySelectorAll('[data-anim]'));
  if(!('IntersectionObserver' in window)){if(!reduce)vids.forEach(function(v){v.controls=true});anims.forEach(function(e){e.classList.remove('zz')});return}
  if(!reduce){var ao=new IntersectionObserver(function(en){en.forEach(function(x){x.target.classList.toggle('zz',!x.isIntersecting||document.hidden)})});anims.forEach(function(e){ao.observe(e)})}

  var so=new IntersectionObserver(function(en){en.forEach(function(x){
    if(x.isIntersecting){steps.forEach(function(a){a.classList.toggle('cur',a.getAttribute('href')==='#'+x.target.id)});
      document.querySelectorAll('.wf').forEach(function(w){w.classList.toggle('on',w===x.target)})}
  })},{rootMargin:'-45% 0px -50% 0px'});
  document.querySelectorAll('.wf').forEach(function(w){so.observe(w)});

  if(!reduce){
    var vo=new IntersectionObserver(function(en){en.forEach(function(x){
      var v=x.target;
      if(x.isIntersecting){if(v.ended)return;seen.add(v);if(v.preload==='none')v.preload='auto';var r=v.play();if(r&&r.catch)r.catch(function(){})}
      else{seen.delete(v);v.pause()}
    })},{threshold:.3});
    vids.forEach(function(v){vo.observe(v);v.addEventListener('ended',function(){seen.delete(v);v.controls=true;vo.unobserve(v)})});

    var els=[].slice.call(document.querySelectorAll('.sh,.card,.wf,.wt,.trio figure,.faq details,.wf-end,.dia,.ticks,.pillar-shot,.stage-d,.trust li,.ill-c'));
    var ro=new IntersectionObserver(function(en){en.forEach(function(x){if(x.isIntersecting){x.target.classList.add('in');ro.unobserve(x.target)}})},{rootMargin:'0px 0px -6% 0px',threshold:.01});
    var run=new Map();
    els.forEach(function(e){
      var r=e.getBoundingClientRect();
      if(r.top<window.innerHeight)return;
      if(e.classList.contains('ill-c')){e.classList.add('tw');ro.observe(e);return}
      var n=run.get(e.parentNode)||0;run.set(e.parentNode,n+1);if(n)e.style.setProperty('--d',String(Math.min(n,5)));
      e.classList.add('rv');ro.observe(e);
    });
  }
})();

(function(){
  var hs=document.querySelector('.hs');if(!hs)return;
  var scene=hs.querySelector('.hs-scene'),canvas=hs.querySelector('canvas'),ctx=canvas.getContext('2d'),imgs={},ready=false;
  var gb=hs.querySelector('.hs-gb'),pill=hs.querySelector('.hs-pill'),cur=hs.querySelector('.hs-cur'),size=hs.querySelector('.hs-size');
  var reduce=matchMedia('(prefers-reduced-motion: reduce)').matches,T=10,t=0,it=0,raf=0,last=0,vis=false,U=1,tx=0,ty=0,px=0,py=0;
  var boxes=[[290,267,678,479],[485,443,415,303]],names=['kettle','mug'];
  function clamp(x){return Math.max(0,Math.min(1,x))}
  function seg(t,a,b){return clamp((t-a)/(b-a))}
  function ease(x){return x*x*(3-2*x)}
  function mix(a,b,x){return a+(b-a)*x}
  function fade(t,a,b,c,d){return Math.min(seg(t,a,b),1-seg(t,c,d))}
  function alpha(e,n){e.style.opacity=n.toFixed(3)}
  function box(e,b){e.style.transform='translate('+b[0]+'px,'+b[1]+'px)';e.style.width=b[2]+'px';e.style.height=b[3]+'px'}
  function point(e,x,y,k){e.style.transform='translate('+x+'px,'+y+'px) scale('+(U*(k===undefined?1:k))+')'}
  function drawAsset(key,opacity,k,dx,dy,blur,clip){
    if(opacity<=0)return;
    ctx.save();ctx.globalAlpha=opacity;
    if(clip){ctx.beginPath();ctx.rect(clip[0],0,clip[1],540);ctx.clip()}
    ctx.translate(305+dx,416+dy);ctx.scale(k,k);ctx.translate(-305,-416);
    if(blur)ctx.filter='blur('+blur+'px)';
    ctx.drawImage(imgs['scene-'+key],-52.804,0,605.607,540);ctx.restore();
  }
  function bounds(b,k,dx,dy){var q=540/963;return [(b[0]*q-52.804-305)*k+305+dx+30,(b[1]*q-416)*k+416+dy+30,b[2]*q*k,b[3]*q*k]}
  function render(time,iteration){
    var from=iteration%2,to=1-from,move=ease(seg(time,1.5,2.25)),scale=ease(seg(time,2.8,3.55)),reset=ease(seg(time,7.8,9.25));
    var dx=-32*move*(1-reset),dy=-3*move*(1-reset),k=1+.075*scale*(1-reset),swap=ease(seg(time,4.7,5.8));
    var a=bounds(boxes[from],k,dx,dy),b=bounds(boxes[to],k,dx,dy),un=[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0]+a[2],b[0]+b[2])-Math.min(a[0],b[0]),Math.max(a[1]+a[3],b[1]+b[3])-Math.min(a[1],b[1])];
    var r=a.map(function(v,i){return mix(mix(v,un[i],ease(seg(time,4.25,4.65))),b[i],ease(seg(time,5.8,6.15)))});
    if(ready){
      ctx.setTransform(2,0,0,2,0,0);ctx.clearRect(0,0,500,540);ctx.drawImage(imgs['scene-plate'],-52.804,0,605.607,540);
      var cut=Math.max(0,Math.min(500,un[0]-30-14+(un[2]+28)*swap)),oldClip=swap>0?[cut,500-cut]:null,newClip=swap<1?[0,cut]:null;
      drawAsset(names[from]+'-shadow',swap<1?1:0,k,dx,dy,0,oldClip);drawAsset(names[to]+'-shadow',swap>0?1:0,k,dx,dy,0,newClip);
      var magic=fade(time,4,4.65,5.6,6.3);
      drawAsset(names[from],swap<1?1:0,k,dx,dy,magic*.35,oldClip);drawAsset(names[to],swap>0?1:0,k,dx,dy,magic*.35,newClip);
      if(magic>0){
        ctx.save();ctx.globalCompositeOperation='screen';
        ctx.filter='blur(8px)';
        var sx=time<4.7?un[0]-44:cut,grad=ctx.createLinearGradient(sx-50,0,sx+50,0);
        grad.addColorStop(0,'rgba(162,240,140,0)');grad.addColorStop(.35,'rgba(162,240,140,'+(.25*magic)+')');grad.addColorStop(.5,'rgba(252,250,238,'+(.7*magic)+')');grad.addColorStop(.65,'rgba(162,240,140,'+(.35*magic)+')');grad.addColorStop(1,'rgba(162,240,140,0)');
        ctx.fillStyle=grad;ctx.fillRect(un[0]-52,un[1]-52,un[2]+44,un[3]+44);ctx.restore();
      }
    }
    alpha(gb,fade(time,.96,1.08,7.1,7.5));box(gb,r);
    var glide=ease(seg(time,.1,.7)),start=bounds(boxes[from],1,0,0);
    var cx=mix(start[0]+start[2]+18,start[0]+start[2]*.56,glide),cy=mix(start[1]+start[3]*.6-30,start[1]+start[3]*.6,glide);
    var press=1-.12*Math.min(ease(seg(time,.9,.96)),1-ease(seg(time,.96,1.02)));
    if(time>1.3){cx=r[0]+r[2]*.56;cy=r[1]+r[3]*.6}
    if(time>2.45){var v=ease(seg(time,2.45,2.8));cx=mix(r[0]+r[2]*.56,r[0]+r[2],v);cy=mix(r[1]+r[3]*.6,r[1]+r[3],v)}
    var pillX=150,pillY=594;
    if(time>3.6){var v=ease(seg(time,3.6,3.95));cx=mix(r[0]+r[2],pillX+24,v);cy=mix(r[1]+r[3],pillY,v)}
    if(time>4.2){var v=ease(seg(time,4.2,4.7));cx=mix(pillX+24,Math.min(518,r[0]+r[2]+22),v);cy=mix(pillY,r[1]+r[3]*.65,v)}
    point(cur,cx,cy,press);alpha(cur,fade(time,.1,.35,6.8,7.2));cur.classList.toggle('rsz',time>2.6&&time<3.6);
    pill.style.transform='translate('+pillX+'px,'+pillY+'px) translate(-50%,-50%) scale('+U+')';alpha(pill,fade(time,3.5,3.75,6.4,6.7));pill.classList.toggle('busy',time>4&&time<5.95);
    point(size,from===0?r[0]+r[2]-55*U:r[0]+r[2]+10,r[1]+10*U);size.textContent=Math.round(k*100)+'%';alpha(size,fade(time,2.7,2.85,3.55,3.8));
    if(!reduce){px+=(tx-px)*.06;py+=(ty-py)*.06;scene.style.transform='perspective(1600px) rotateX('+(1.5-py*1.5).toFixed(3)+'deg) rotateY('+(-2+px*2).toFixed(3)+'deg)'}
    hs.dataset.time=time.toFixed(3);hs.dataset.iteration=iteration;
  }
  function scale(){var k=hs.clientWidth/500;U=Math.min(1.4,Math.max(.85,1/k));hs.style.setProperty('--k',k);hs.style.setProperty('--u',U)}
  scale();new ResizeObserver(scale).observe(hs);
  function frame(now){var dt=last?Math.min((now-last)/1000,.05):0;last=now;t+=dt;while(t>=T){t-=T;it++}render(t,it);raf=requestAnimationFrame(frame)}
  function run(){var on=ready&&vis&&!document.hidden&&!reduce;if(on&&!raf){last=0;raf=requestAnimationFrame(frame)}else if(!on&&raf){cancelAnimationFrame(raf);raf=0}}
  new IntersectionObserver(function(en){vis=en[0].isIntersecting;run()}).observe(hs);
  document.addEventListener('visibilitychange',run);
  if(!reduce&&matchMedia('(hover: hover) and (pointer: fine)').matches)window.addEventListener('pointermove',function(e){tx=e.clientX/innerWidth*2-1;ty=e.clientY/innerHeight*2-1},{passive:true});
  var loading=[].map.call(hs.querySelectorAll('[data-scene]'),function(im){imgs[im.dataset.scene]=im;return im.decode()});
  Promise.all(loading).then(function(){ready=true;render(reduce?3.85:0,0);run()});
  if(reduce){scene.style.transform='none';render(3.85,0)}else render(0,0);
})();
