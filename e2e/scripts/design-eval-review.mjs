#!/usr/bin/env node
// Owner review of design-eval runs: blind pairwise against a baseline, or single-label acceptance.
import { createServer } from 'node:http';
import { randomInt } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const DIMENSIONS = ['composition', 'hierarchy', 'brand accuracy', 'finish'];

const REVIEW_LABELS = {
  composition: '构图',
  hierarchy: '视觉层级',
  'brand accuracy': '品牌准确性',
  finish: '完成度',
  redesign: '重新设计',
  'composition-fix': '优化构图',
  'resize-9x16': '调整为 9:16 竖版',
  face: '人脸',
  'held cup': '手持杯',
  'latte cup': '拿铁杯',
  'americano cup': '美式杯',
  'brand logo': '品牌标志',
  signature: '签名',
  'person fills most of the frame; should shrink or reframe':
    '人物占据大部分画面，应缩小人物或重新安排构图',
  'headline column crowds the face and the held cup': '标题挤占人脸和手持杯的空间',
  'endorsement credit competes with the hand and bracelet': '代言人信息与手部、手镯争夺视觉焦点',
  'footer panel and fine print are cramped': '底部信息区和小字过于拥挤',
  'third-party platform watermark must not carry over': '不应保留第三方平台水印',
  'person fills ~70% of the frame; should shrink or reframe':
    '人物占据约 70% 的画面，应缩小人物或重新安排构图',
  'headline block crowds her hair and face; needs a clear gap':
    '标题紧贴头发和人脸，需要留出清晰间隔',
  'endorsement credit and signature compete with the held cup':
    '代言人信息和签名与手持杯争夺视觉焦点',
  'footer band is cramped': '底部信息区过于拥挤',
  'third-party watermark must not carry over': '不应保留第三方水印',
};

/** Pairs run-i with run-i per case; `flip` decides whether the candidate shows as A. */
export function buildItems(candidateRuns, baselineRuns, flip) {
  const items = [];
  for (const [caseId, runs] of Object.entries(candidateRuns)) {
    const baseline = baselineRuns?.[caseId];
    if (baselineRuns && !baseline) continue;
    const count = baseline ? Math.min(runs.length, baseline.length) : runs.length;
    for (let index = 0; index < count; index += 1) {
      const id = `${caseId}#${index + 1}`;
      if (!baseline) {
        items.push({ id, caseId, sides: { A: { label: 'candidate', run: runs[index] } } });
        continue;
      }
      const candidate = { label: 'candidate', run: runs[index] };
      const base = { label: 'baseline', run: baseline[index] };
      items.push({
        id,
        caseId,
        sides: flip() ? { A: base, B: candidate } : { A: candidate, B: base },
      });
    }
  }
  return items;
}

/** Un-blinds verdicts; a case regresses when most of its pairs are worse on any dimension. */
export function scoreReview(items, verdicts) {
  const cases = {};
  for (const item of items) {
    const verdict = verdicts[item.id];
    const entry = (cases[item.caseId] ??= { pairs: 0, reviewed: 0, worse: {}, better: {} });
    entry.pairs += 1;
    if (!verdict) continue;
    entry.reviewed += 1;
    if (!item.sides.B) {
      entry.accepted = (entry.accepted ?? 0) + (verdict.accept ? 1 : 0);
      continue;
    }
    const candidateSide = item.sides.A.label === 'candidate' ? 'A' : 'B';
    for (const dimension of DIMENSIONS) {
      const choice = verdict.dims?.[dimension];
      if (!choice || choice === 'same') continue;
      const bucket = choice === candidateSide ? entry.better : entry.worse;
      bucket[dimension] = (bucket[dimension] ?? 0) + 1;
    }
  }
  for (const entry of Object.values(cases)) {
    entry.regressed = Object.entries(entry.worse)
      .filter(([, count]) => count > entry.pairs / 2)
      .map(([dimension]) => dimension);
  }
  return cases;
}

export function finalAgentMessage(conversation) {
  const lines = conversation.split('\n');
  const start = lines.findLastIndex((line) => /^Worked for /.test(line.trim()));
  if (start === -1) return '';
  const end = lines.findIndex(
    (line, index) => index > start && /^\d{1,2}:\d{2}\s?(AM|PM)$/.test(line.trim())
  );
  return lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join('\n')
    .trim();
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const evalRoot = join(root, 'e2e/design-eval');
const privateRoot = join(evalRoot, 'private');

async function listRuns(label) {
  const base = join(privateRoot, 'runs', label);
  const runs = {};
  for (const source of await readdir(base)) {
    for (const variant of await readdir(join(base, source))) {
      const directory = join(base, source, variant);
      const names = (await readdir(directory)).filter((name) => /^run-\d+$/.test(name));
      const complete = [];
      for (const name of names.sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)))) {
        const run = join(directory, name);
        if (!existsSync(join(run, 'preview.png'))) continue;
        const report = JSON.parse(await readFile(join(run, 'run.json'), 'utf8'));
        if (!report.error) complete.push(run);
      }
      if (complete.length) runs[`${source}/${variant}`] = complete;
    }
  }
  return runs;
}

async function findCase(caseId) {
  const [source, variant] = caseId.split('/');
  for (const dir of [join(evalRoot, 'cases', source), join(privateRoot, source)]) {
    const file = join(dir, `${variant}.json`);
    if (existsSync(file)) return { file, data: JSON.parse(await readFile(file, 'utf8')) };
  }
  throw Error(`No case file for ${caseId}`);
}

async function describeRun(run) {
  const report = JSON.parse(await readFile(join(run, 'run.json'), 'utf8'));
  const previews = [join(run, 'preview.png')];
  for (let index = 1; existsSync(join(run, `follow-up-${index}`, 'preview.png')); index += 1)
    previews.push(join(run, `follow-up-${index}`, 'preview.png'));
  const conversation = existsSync(join(run, 'conversation.txt'))
    ? await readFile(join(run, 'conversation.txt'), 'utf8')
    : '';
  return {
    previews,
    followUps: report.followUps,
    gate: report.gate,
    minutes: (report.turns ?? []).map((turn) => Math.round(turn.durationMs / 60000)),
    summary: finalAgentMessage(conversation),
  };
}

const page = (title) => `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><title>${title}</title>
<style>
body{font:14px/1.5 system-ui;margin:0;background:#f6f5f2;color:#222}
header{position:sticky;top:0;background:#fff;border-bottom:1px solid #ddd;padding:10px 20px;display:flex;gap:16px;align-items:center;z-index:1}
main{padding:20px;max-width:1500px;margin:auto}
.item{background:#fff;border-radius:12px;padding:16px;margin-bottom:28px}
.cols{display:grid;grid-template-columns:repeat(var(--n),1fr);gap:16px}
.cols img{display:block;max-width:100%;max-height:58vh;border:1px solid #ddd;border-radius:6px;cursor:zoom-in}
.previews{display:flex;gap:8px}.previews>div{min-width:0}
.side h3{margin:6px 0}.muted{color:#777}.summary{white-space:pre-wrap;font-size:12px;background:#f3f3f3;padding:8px;border-radius:6px;max-height:160px;overflow:auto}
table{border-collapse:collapse;margin-top:10px}td,th{padding:4px 10px;border-bottom:1px solid #eee;text-align:left}
.done{color:#0a7d3b}.zoom{position:fixed;inset:0;background:#000c;display:flex;justify-content:center;align-items:center}.zoom img{max-height:96vh;max-width:96vw}
</style>
<header><b>${title}</b><span id="progress"></span><span class="muted">选择后自动保存。点击图片可放大。</span></header>
<main id="app"></main>
<script>
const DIMS=${JSON.stringify(DIMENSIONS)};
const LABELS=${JSON.stringify(REVIEW_LABELS)};
const zh=(value)=>LABELS[value]??value;
const gateFailure=(message)=>message.replace(/^canvas is (.+), expected (.+)$/,'画布尺寸为 $1，要求为 $2').replace(/^missing editable text: /,'缺少可编辑文字：').replace(/^text (.+) extends outside the canvas$/,'文字元素 $1 超出画布');
const file=(p)=>'/file?path='+encodeURIComponent(p);
const zoom=(src)=>{const z=document.createElement('div');z.className='zoom';z.innerHTML='<img src="'+src+'">';z.onclick=()=>z.remove();document.body.append(z)};
(async()=>{
 const {items,verdicts}=await (await fetch('/data')).json();
 const app=document.getElementById('app');
 const save=async(id)=>{await fetch('/verdict',{method:'POST',body:JSON.stringify({id,verdict:verdicts[id]})});progress()};
 const progress=()=>{document.getElementById('progress').textContent='已评审 '+Object.values(verdicts).filter(v=>Object.keys(v).length).length+' / '+items.length+' 项'};
 progress();
 for(const item of items){
  const v=(verdicts[item.id]??={});const sides=Object.keys(item.sides);const pair=sides.length===2;
  const el=document.createElement('section');el.className='item';
  el.innerHTML='<h2>'+item.caseLabel+' <span class="muted">第 '+item.id.split('#')[1]+(pair?' 组对比':' 次运行')+'</span></h2>'+
   '<p><b>任务要求：</b> '+item.prompt+(item.followUps.length?' <b>后续要求：</b> '+item.followUps.join(' / '):'')+'</p>';
  const cols=document.createElement('div');cols.className='cols';cols.style.setProperty('--n',sides.length+1);
  cols.innerHTML='<div><h3>原图</h3><img src="'+file(item.source)+'"></div>';
  for(const s of sides){const d=item.sides[s];
   const gate=d.gate?.status==='passed'?'<span class="done">自动检查通过</span>':d.gate?.status==='failed'?'自动检查未通过：'+(d.gate.failures??[]).map(gateFailure).join('；'):'未记录自动检查结果';
   cols.innerHTML+='<div class="side"><h3>'+(pair?'方案 '+s:'生成结果')+'</h3>'+d.previews.map((p,i)=>'<p class="muted">'+(i?'第 '+i+' 次后续修改后':'首轮结果')+'</p><img src="'+file(p)+'">').join('')+
    '<p class="muted">'+gate+' · 各轮耗时：'+d.minutes.join(' + ')+' 分钟</p><b>助手总结</b><div class="summary">'+(d.summary||'（未记录最终回复）').replace(/</g,'&lt;')+'</div></div>'}
  el.append(cols);
  const t=document.createElement('table');
  const radio=(name,value,label,checked)=>'<label><input type="radio" name="'+name+'" value="'+value+'"'+(checked?' checked':'')+'> '+label+'</label> ';
  if(pair){t.innerHTML+='<tr><th>评分维度</th><th>哪个方案更好？</th></tr>'+DIMS.map(d=>'<tr><td>'+zh(d)+'</td><td>'+['A','same','B'].map(c=>radio(item.id+d,c,c==='same'?'相当':'方案 '+c,v.dims?.[d]===c)).join('')+'</td></tr>').join('')}
  else{t.innerHTML+='<tr><td>接受为基准结果</td><td>'+radio(item.id+'accept','yes','是',v.accept===true)+radio(item.id+'accept','no','否',v.accept===false)+'</td></tr>'}
  for(const s of sides){
   t.innerHTML+='<tr><td colspan=2><b>'+(pair?'方案 '+s:'生成结果')+'</b> · 勾选已修复的问题：</td></tr>'+item.knownDefects.map((k,i)=>'<tr><td></td><td><label><input type="checkbox" data-side="'+s+'" data-defect="'+i+'"'+(v.defectsFixed?.[s]?.includes(i)?' checked':'')+'> '+zh(k)+'</label></td></tr>').join('')+
    '<tr><td></td><td>指定保留区域是否完好（'+item.preserve.map(zh).join('、')+'）：'+radio(item.id+s+'p','yes','是',v.preserved?.[s]===true)+radio(item.id+s+'p','no','否',v.preserved?.[s]===false)+'</td></tr>'+
    '<tr><td></td><td>总结是否符合实际可见的修改：'+radio(item.id+s+'h','yes','是',v.honest?.[s]===true)+radio(item.id+s+'h','no','否',v.honest?.[s]===false)+'</td></tr>'}
  t.innerHTML+='<tr><td>备注</td><td><input size="80" data-note value="'+(v.note??'').replace(/"/g,'&quot;')+'"></td></tr>';
  el.append(t);
  el.addEventListener('change',(e)=>{const x=e.target;
   if(x.type==='radio'){const n=x.name.slice(item.id.length);
    if(DIMS.includes(n))(v.dims??={})[n]=x.value;else if(n==='accept')v.accept=x.value==='yes';
    else{const s=n.slice(0,-1);(n.endsWith('p')?(v.preserved??={}):(v.honest??={}))[s]=x.value==='yes'}}
   else if(x.type==='checkbox'){const list=((v.defectsFixed??={})[x.dataset.side]??=[]);const i=Number(x.dataset.defect);
    if(x.checked)list.push(i);else list.splice(list.indexOf(i),1)}
   else if('note' in x.dataset)v.note=x.value;
   save(item.id)});
  el.querySelectorAll('img').forEach(i=>i.onclick=()=>zoom(i.src));
  app.append(el)}
})();
</script></html>`;

const CONTENT_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

async function main() {
  const { values } = parseArgs({
    options: {
      candidate: { type: 'string' },
      baseline: { type: 'string' },
      score: { type: 'boolean', default: false },
      port: { type: 'string', default: '0' },
    },
  });
  if (!values.candidate)
    throw Error(
      'usage: node e2e/scripts/design-eval-review.mjs --candidate <label> [--baseline <label>] [--score] [--port 0]'
    );
  const name = values.baseline ? `${values.candidate}--vs--${values.baseline}` : values.candidate;
  const reviewDir = join(privateRoot, 'reviews', name);
  await mkdir(reviewDir, { recursive: true });
  const keyFile = join(reviewDir, 'key.json');
  const verdictFile = join(reviewDir, 'verdicts.json');

  let items;
  if (existsSync(keyFile)) {
    items = JSON.parse(await readFile(keyFile, 'utf8'));
  } else {
    const candidate = await listRuns(values.candidate);
    const baseline = values.baseline ? await listRuns(values.baseline) : undefined;
    items = buildItems(candidate, baseline, () => randomInt(2) === 1);
    await writeFile(keyFile, JSON.stringify(items, null, 2));
  }
  const verdicts = existsSync(verdictFile) ? JSON.parse(await readFile(verdictFile, 'utf8')) : {};

  if (values.score) {
    const result = scoreReview(items, verdicts);
    await writeFile(join(reviewDir, 'summary.json'), JSON.stringify(result, null, 2));
    for (const [caseId, entry] of Object.entries(result)) {
      const status =
        entry.reviewed < entry.pairs
          ? 'incomplete'
          : entry.regressed.length
            ? `REGRESSED: ${entry.regressed.join(', ')}`
            : 'ok';
      const accepted =
        entry.accepted === undefined ? '' : ` accepted ${entry.accepted}/${entry.pairs}`;
      console.log(`${caseId}: ${entry.reviewed}/${entry.pairs} reviewed${accepted} → ${status}`);
    }
    return;
  }

  const blind = [];
  for (const item of items) {
    const { data, file } = await findCase(item.caseId);
    const sides = {};
    for (const [side, { run }] of Object.entries(item.sides)) sides[side] = await describeRun(run);
    blind.push({
      id: item.id,
      caseId: item.caseId,
      caseLabel: `${file.startsWith(privateRoot + sep) ? '私有案例' : '合成案例'} · ${REVIEW_LABELS[item.caseId.split('/')[1]] ?? item.caseId}`,
      prompt: data.prompt,
      followUps: sides.A.followUps ?? data.followUps,
      knownDefects: data.knownDefects,
      preserve: data.preserve,
      source: resolve(dirname(file), data.input.source),
      sides,
    });
  }
  const allowed = [privateRoot + sep, join(evalRoot, 'cases') + sep];
  const handle = async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(page(`设计评审：${values.baseline ? 'A/B 盲评' : values.candidate}`));
    } else if (url.pathname === '/data') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ items: blind, verdicts }));
    } else if (url.pathname === '/file') {
      const path = resolve(url.searchParams.get('path') ?? '');
      if (!allowed.some((prefix) => path.startsWith(prefix)) || !CONTENT_TYPES[extname(path)]) {
        res.writeHead(403).end();
        return;
      }
      res.writeHead(200, { 'Content-Type': CONTENT_TYPES[extname(path)] });
      res.end(await readFile(path));
    } else if (url.pathname === '/verdict' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const { id, verdict } = JSON.parse(body);
      if (!items.some((item) => item.id === id)) {
        res.writeHead(400).end();
        return;
      }
      verdicts[id] = verdict;
      await writeFile(verdictFile, JSON.stringify(verdicts, null, 2));
      res.writeHead(204).end();
    } else {
      res.writeHead(404).end();
    }
  };
  const server = createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  server.listen(Number(values.port), '127.0.0.1', () => {
    console.log(`Review ${items.length} items at http://127.0.0.1:${server.address().port}/`);
    console.log(`Verdicts: ${verdictFile}. Score with --score when done.`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
