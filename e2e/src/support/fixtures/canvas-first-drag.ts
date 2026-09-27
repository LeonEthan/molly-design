export const canvasFirstDragProbe = String.raw`
return (async () => {
  const canvas = webContents.getAllWebContents().find(contents =>
    contents.getURL().startsWith('molly-design://') &&
    new URL(contents.getURL()).searchParams.get('ws') === artworkId);
  if (!canvas) throw Error('Attached canvas missing');
  canvas.getOwnerBrowserWindow().show();
  canvas.getOwnerBrowserWindow().focus();
  canvas.focus();
  const setup = await canvas.executeJavaScript(
    '(async () => {' +
    'window.__firstDrag = {' +
    ' errors: [], inputs: [],' +
    ' read() { return Array.from(document.querySelectorAll(".ed-stage .bento-el-text")).map(el => {' +
    ' const r=el.getBoundingClientRect(); return {id:el.dataset.elId,x:r.x,y:r.y,width:r.width,height:r.height};' +
    ' }); },' +
    ' selection() { return window.molly.selection().map(s=>s.id); }' +
    '};' +
    'window.addEventListener("mousedown", () => window.__firstDrag.inputs.push(window.molly.state()),true);' +
    'window.addEventListener("error", e => window.__firstDrag.errors.push(e.message));' +
    'window.addEventListener("unhandledrejection", e => window.__firstDrag.errors.push(String(e.reason)));' +
    'for (const x of [80, 450]) {' +
    ' const added = window.molly.applyCommands({verb:"add-element",kind:"text"});' +
    ' const positioned = window.molly.applyCommands({verb:"position",x,y:180});' +
    ' if (!added.ok || !positioned.ok) throw Error("Fixture creation failed");' +
    '}' +
    'const saved = await window.molly.save();' +
    'if (!saved.ok) throw Error(saved.error);' +
    'return {elements:window.__firstDrag.read(),selected:window.__firstDrag.selection()};' +
    '})()');
  if (setup.elements.length !== 2 || setup.selected[0] !== setup.elements[1].id)
    throw Error('Fixture must start with only the second text selected');
  const cases=[];
  async function frame() { await canvas.executeJavaScript('new Promise(requestAnimationFrame)'); }
  async function read() { return canvas.executeJavaScript('window.__firstDrag.read()'); }
  async function snapshot() { return canvas.executeJavaScript('window.molly.snapshot()'); }
  async function click(element) {
    const x=Math.round(element.x+element.width/2), y=Math.round(element.y+element.height/2);
    canvas.sendInputEvent({type:'mouseMove',x,y});
    canvas.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x,y});
    canvas.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x,y});
    await frame();
  }
  async function drag(id, name, expectedMove = true, startSaving = false) {
    const before=await read();
    const element=before.find(e=>e.id===id);
    const x=Math.round(element.x+element.width/2), y=Math.round(element.y+element.height/2);
    const frames=[];
    let savingStarted = false;
    function start() {
      canvas.sendInputEvent({type:'mouseMove',x,y});
      canvas.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x,y});
    }
    if (startSaving) {
      const onConsole = (event, ...args) => {
        if ((event.message ?? args[1]) !== '__FIRST_DRAG_SAVING__') return;
        savingStarted = true;
        start();
      };
      canvas.on('console-message',onConsole);
      try {
        await canvas.executeJavaScript('window.__firstDrag.save = window.molly.save(); console.log("__FIRST_DRAG_SAVING__"); void 0');
      } finally {
        canvas.removeListener('console-message',onConsole);
      }
      if (!savingStarted) throw Error('Missing save-start signal');
    } else start();
    for (let delta=4; delta<=48; delta+=4) {
      canvas.sendInputEvent({type:'mouseMove',button:'left',modifiers:['leftButtonDown'],x:x+delta,y:y+delta/2});
      await frame();
      frames.push((await read()).find(e=>e.id===id));
    }
    const during=await read();
    canvas.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:x+48,y:y+24});
    await frame();
    const after=await read();
    const moved=during.find(e=>e.id===id);
    const committed=after.find(e=>e.id===id);
    const unchanged=before.filter(e=>e.id!==id || !expectedMove).every(e=>{
      const current=after.find(other=>other.id===e.id);
      return current.x===e.x && current.y===e.y;
    });
    cases.push({name,before,frames,during,after,selection:await canvas.executeJavaScript('window.__firstDrag.selection()'),
      startSaving,input:await canvas.executeJavaScript('window.__firstDrag.inputs.at(-1)'),
      expectedMove,moved:Math.abs(moved.x-element.x)>40 && Math.abs(moved.y-element.y)>15,
      committed:Math.abs(committed.x-moved.x)<1 && Math.abs(committed.y-moved.y)<1,unchanged});
  }
  const first=setup.elements[0].id, second=setup.elements[1].id;
  await drag(first,'first drag switches target after save');
  await drag(first,'already selected target');
  const beforeClick=await read();
  await click(beforeClick[1]);
  cases.push({name:'click changes only selection',unchanged:JSON.stringify(beforeClick)===JSON.stringify(await read()),
    selected:(await canvas.executeJavaScript('window.__firstDrag.selection()'))[0]===second});
  await drag(first,'released selection cannot hijack next drag');

  await drag(second,'first drag switches target while saving',true,true);
  const saved=await canvas.executeJavaScript('window.__firstDrag.save');
  const settledSave=await canvas.executeJavaScript('window.molly.save()');
  const beforeUndo=await snapshot();
  await drag(first,'first drag after saving completes');
  const afterUndoable=await snapshot();
  async function history(index) {
    const bounds=await canvas.executeJavaScript('(() => {' +
      'const r=document.querySelectorAll(".molly-dock .history")['+index+'].getBoundingClientRect();' +
      'return {x:r.x,y:r.y,width:r.width,height:r.height};})()');
    await click(bounds);
    return snapshot();
  }
  const undone=await history(0);
  const redone=await history(1);
  const beforeReadonly=await snapshot();
  await canvas.executeJavaScript('window.molly.setReadonly(true)');
  const readonlyCommand=await canvas.executeJavaScript('window.molly.applyCommands({verb:"position",x:0,y:0})');
  const readonlyButtons=await canvas.executeJavaScript('Array.from(document.querySelectorAll(".molly-dock button.history,.molly-dock button.create")).every(button=>button.disabled)');
  const afterReadonly=await snapshot();
  await canvas.executeJavaScript('window.molly.setReadonly(false)');
  await drag(second,'unlock restores first drag');
  const finalSave=await canvas.executeJavaScript('window.molly.save()');
  return {cases,saved,settledSave,finalSave,snapshot:await snapshot(),
    history:{beforeUndo,afterUndoable,undone,redone},readonly:{beforeReadonly,afterReadonly,readonlyCommand,readonlyButtons},
    errors:await canvas.executeJavaScript('window.__firstDrag.errors')};
})();
`;
