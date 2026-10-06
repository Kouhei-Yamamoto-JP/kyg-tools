(() => {
  const UI = window.KygImageSuiteUI, $ = (s) => document.querySelector(s);
  const state = { images: [], outputs: [], selectedBox: 0, selectedGuide: null, drag: null, stopped: false, busy: false };
  const capImages = 20, capPixels = 100_000_000, capOne = 67_200_000, capAreas = 200, capOutputs = 400, capOutPixels = 134_400_000;
  const valid = (f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|avif|bmp|ico|svg|heic|heif)$/i.test(f.name);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const num = (sel, d) => Math.max(0, Number($(sel).value) || d);
  function load(file) { return UI.loadImageFromFile(file); }
  async function add(files) {
    let sum = state.images.reduce((n, x) => n + x.width * x.height, 0);
    for (const file of files) {
      if (!valid(file)) { UI.toast('対応していない画像形式です。PNG、JPG、WebP、GIF、AVIF、BMP、ICO、SVG、HEIC、HEIFを選んでください。', 'danger'); continue; }
      if (state.images.some((x) => x.file === file || (x.file.name === file.name && x.file.size === file.size && x.file.lastModified === file.lastModified))) continue;
      if (state.images.length >= capImages) { UI.toast('画像は最大20枚まで追加できます。', 'danger'); break; }
      try { const img = await load(file); const px = img.width * img.height;
        if (px > capOne) { UI.toast(`${file.name}: ${px.toLocaleString()}画素が上限67,200,000画素を超えています。`, 'danger'); continue; }
        if (sum + px > capPixels) { UI.toast('合計画素数が100,000,000画素を超えるため、これ以上追加できません。', 'danger'); break; }
        sum += px; const item = { file, img, width: img.width, height: img.height, path: file.webkitRelativePath || file.name, v: [], h: [], boxes: [{ x: Math.floor(img.width * .1), y: Math.floor(img.height * .1), w: Math.floor(img.width * .8), h: Math.floor(img.height * .8) }] }; state.images.push(item);
      } catch { UI.toast('ファイルを読み込めませんでした。画像が破損している可能性があります。', 'danger'); }
    }
    renderList(); renderActive(); renderPreview();
  }
  function renderList() {
    const host = $('#image-list'); host.replaceChildren(); const selector = $('#active-image'); selector.replaceChildren();
    state.images.forEach((x, i) => { const opt = document.createElement('option'); opt.value = i; opt.textContent = x.file.name; selector.append(opt);
      const row = document.createElement('div'); row.className = 'image-row'; const im = document.createElement('img'); im.src = x.img.src; im.alt = '';
      const name = document.createElement('span'); name.textContent = `${x.file.name} · ${x.width} × ${x.height}`;
      const remove = document.createElement('button'); remove.className = 'btn remove'; remove.textContent = '取り除く'; remove.onclick = () => { state.images.splice(i, 1); selector.value = '0'; renderList(); renderPreview(); };
      row.append(im, name, remove); host.append(row); });
    if (state.images.length) selector.value = String(clamp(+selector.value || 0, 0, state.images.length - 1));
  }
  function active() { return state.images[+$('#active-image').value] || null; }
  function renderActive() {
    const mode = $('#mode').value; $('#grid-settings').hidden = mode !== 'grid'; $('#fixed-settings').hidden = mode !== 'fixed'; $('#line-settings').hidden = mode !== 'lines'; $('#box-settings').hidden = mode !== 'boxes';
    $('#add-v').disabled = !active(); $('#add-h').disabled = !active(); $('#add-box').disabled = !active();
  }
  function segments(start, end, cuts) { return [start, ...cuts.filter((v) => v > start && v < end).sort((a, b) => a - b), end]; }
  function rects(item, mode) {
    const w = item.width, h = item.height;
    if (mode === 'grid') {
      const rows = clamp(Math.floor(num('#rows', 2)), 1, 50), cols = clamp(Math.floor(num('#cols', 2)), 1, 50); if (rows * cols > capAreas) throw Error('1画像あたりの上限200領域を超えています。');
      const gap = clamp(num('#gap', 0), 0, 20) / 100; const dx = w * gap / cols, dy = h * gap / rows; const out = [];
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const x0 = Math.round(c * w / cols + (c ? dx / 2 : 0)), x1 = Math.round((c + 1) * w / cols - (c < cols - 1 ? dx / 2 : 0)); const y0 = Math.round(r * h / rows + (r ? dy / 2 : 0)), y1 = Math.round((r + 1) * h / rows - (r < rows - 1 ? dy / 2 : 0)); if (x1 > x0 && y1 > y0) out.push({ x:x0,y:y0,w:x1-x0,h:y1-y0 }); }
      return out;
    }
    if (mode === 'fixed') {
      const tw = clamp(Math.floor(num('#tile-w', 500)), 10, 12000), th = clamp(Math.floor(num('#tile-h', 500)), 10, 12000), gap = clamp(Math.floor(num('#tile-gap', 0)), 0, 1000), edge = $('#keep-edge').checked; const out = [];
      for (let y = 0; y < h; y += th + gap) for (let x = 0; x < w; x += tw + gap) { const cw = Math.min(tw, w - x), ch = Math.min(th, h - y); if (cw === tw && ch === th || edge) out.push({ x,y,w:cw,h:ch }); if (out.length > capAreas) throw Error('1画像あたりの上限200領域を超えています。寸法を広げてください。'); }
      return out;
    }
    if (mode === 'lines') { const xs = segments(0, w, item.v), ys = segments(0, h, item.h), out = []; for (let r = 0; r < ys.length - 1; r++) for (let c = 0; c < xs.length - 1; c++) out.push({ x:xs[c],y:ys[r],w:xs[c+1]-xs[c],h:ys[r+1]-ys[r] }); return out; }
    return item.boxes.map((b) => ({ x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.w),h:Math.round(b.h) }));
  }
  const canvas = $('#preview'), ctx = canvas.getContext('2d');
  function renderPreview() {
    const item = active(); canvas.width = canvas.height = 0; $('#line-values').replaceChildren(); $('#box-values').replaceChildren(); if (!item) return;
    const scale = Math.min(1, 1100 / item.width, 650 / item.height); canvas.width = Math.round(item.width * scale); canvas.height = Math.round(item.height * scale); canvas.dataset.scale = scale; ctx.drawImage(item.img, 0, 0, canvas.width, canvas.height); ctx.save(); ctx.scale(scale, scale); ctx.lineWidth = Math.max(1 / scale, 2); ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--guide-line').trim() || '#1d9bf0'; ctx.setLineDash([8 / scale, 5 / scale]);
    const mode = $('#mode').value;
    if (mode === 'lines') { item.v.forEach((x) => { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, item.height); ctx.stroke(); }); item.h.forEach((y) => { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(item.width, y); ctx.stroke(); }); }
    if (mode === 'boxes') item.boxes.forEach((b, i) => { ctx.strokeStyle = i === state.selectedBox ? '#1d9bf0' : 'rgba(29,155,240,.55)'; ctx.strokeRect(b.x, b.y, b.w, b.h); ctx.fillStyle = '#1d9bf0'; ctx.fillRect(b.x+b.w-7/scale,b.y+b.h-7/scale,14/scale,14/scale); }); ctx.restore();
    item.v.forEach((x,i) => addCoord($('#line-values'), '縦', x, item.width, (v) => { item.v[i] = v; renderPreview(); })); item.h.forEach((y,i) => addCoord($('#line-values'), '横', y, item.height, (v) => { item.h[i] = v; renderPreview(); }));
    item.boxes.forEach((b, i) => { const row = document.createElement('div'); row.className = 'field-row'; for (const [key, cap, max] of [['x','左',item.width],['y','上',item.height],['w','幅',item.width],['h','高さ',item.height]]) { const inp = document.createElement('input'); inp.type='number'; inp.min=key==='w'||key==='h'?'1':'0'; inp.max=max; inp.value=b[key]; inp.setAttribute('aria-label',`枠${i+1} ${cap}`); inp.oninput=()=>{ b[key]=clamp(+inp.value,key==='w'||key==='h'?1:0,max);b.x=clamp(b.x,0,item.width-1);b.y=clamp(b.y,0,item.height-1);b.w=clamp(b.w,1,item.width-b.x);b.h=clamp(b.h,1,item.height-b.y);state.selectedBox=i;renderPreview(); }; row.append(inp); } $('#box-values').append(row); });
  }
  function addCoord(host, axis, value, max, update) { const wrap=document.createElement('label'); wrap.className='field'; wrap.textContent=`${axis}分割線の位置（px）`; const inp=document.createElement('input'); inp.type='number'; inp.min='1'; inp.max=max-1; inp.value=Math.round(value); inp.onchange=()=>{ update(clamp(+inp.value,1,max-1)); }; wrap.append(inp); host.append(wrap); }
  canvas.addEventListener('pointerdown', (e) => { const item=active(); if (!item) return; const rect=canvas.getBoundingClientRect(), scale=(item.width/rect.width); const x=(e.clientX-rect.left)*scale, y=(e.clientY-rect.top)*scale; const mode=$('#mode').value; let best=null, dist=Infinity;
    if(mode==='lines'){ item.v.forEach((v,i)=>{const d=Math.abs(x-v);if(d<dist&&d<24){dist=d;best={axis:'v',i};}});item.h.forEach((v,i)=>{const d=Math.abs(y-v);if(d<dist&&d<24){dist=d;best={axis:'h',i};}}); if(best) state.selectedGuide=best; }
    if(mode==='boxes'){ let hit=-1; item.boxes.forEach((b,i)=>{if(x>=b.x-10&&x<=b.x+b.w+10&&y>=b.y-10&&y<=b.y+b.h+10)hit=i;});if(hit>=0){state.selectedBox=hit;const b=item.boxes[hit],resize=Math.abs(x-(b.x+b.w))<18&&Math.abs(y-(b.y+b.h))<18;best={axis:resize?'resize':'box',i:hit,dx:x-b.x,dy:y-b.y};} }
    if(best){state.drag=best;canvas.setPointerCapture(e.pointerId);}
  });
  canvas.addEventListener('pointermove',(e)=>{if(!state.drag)return;const item=active(), rect=canvas.getBoundingClientRect(), x=(e.clientX-rect.left)*(item.width/rect.width),y=(e.clientY-rect.top)*(item.height/rect.height),d=state.drag;if(d.axis==='v')item.v[d.i]=clamp(Math.round(x),1,item.width-1);if(d.axis==='h')item.h[d.i]=clamp(Math.round(y),1,item.height-1);if(d.axis==='box'){const b=item.boxes[d.i];b.x=clamp(Math.round(x-d.dx),0,item.width-b.w);b.y=clamp(Math.round(y-d.dy),0,item.height-b.h);}if(d.axis==='resize'){const b=item.boxes[d.i];b.w=clamp(Math.round(x-b.x),1,item.width-b.x);b.h=clamp(Math.round(y-b.y),1,item.height-b.y);}renderPreview();});
  canvas.addEventListener('pointerup',()=>state.drag=null);
  canvas.addEventListener('keydown',(e)=>{const item=active(), step=e.shiftKey?10:1, mode=$('#mode').value;if(!item)return;let axis=null,index=0;if(mode==='lines'&&state.selectedGuide){axis=state.selectedGuide.axis;index=state.selectedGuide.i;}if(mode==='boxes')axis='box';if(!axis)return;if(mode==='lines'&&!e.key.startsWith('Arrow')&&e.key!=='Delete'&&e.key!=='Backspace')return;e.preventDefault();if(axis==='v'&&(e.key==='ArrowLeft'||e.key==='ArrowRight'))item.v[index]=clamp(item.v[index]+(e.key==='ArrowLeft'?-step:step),1,item.width-1);if(axis==='h'&&(e.key==='ArrowUp'||e.key==='ArrowDown'))item.h[index]=clamp(item.h[index]+(e.key==='ArrowUp'?-step:step),1,item.height-1);if(mode==='lines'&&(e.key==='Delete'||e.key==='Backspace')){(axis==='v'?item.v:item.h).splice(index,1);state.selectedGuide=null;}if(axis==='box'){const b=item.boxes[state.selectedBox];if(e.key==='ArrowLeft')b.x=clamp(b.x-step,0,item.width-b.w);if(e.key==='ArrowRight')b.x=clamp(b.x+step,0,item.width-b.w);if(e.key==='ArrowUp')b.y=clamp(b.y-step,0,item.height-b.h);if(e.key==='ArrowDown')b.y=clamp(b.y+step,0,item.height-b.h);}renderPreview();});
  function clearOutputs(){state.outputs.forEach(o=>URL.revokeObjectURL(o.url));state.outputs=[];$('#outputs').replaceChildren();$('#zip').disabled=true;}
  function outName(item,n,ext){return item.file.name.replace(/\.[^.]+$/,'')+`_${String(n).padStart(3,'0')}.${ext}`;}
  async function run(){if(state.busy||!state.images.length)return;clearOutputs();state.busy=true;state.stopped=false;$('#process').disabled=true;$('#cancel').disabled=false;const mode=$('#mode').value, all=[];let total=0,pixels=0;try{for(const item of state.images){const rects0=rects(item,mode);if(!rects0.length)throw Error('切り出せる領域がありません。');if(rects0.length>capAreas)throw Error('1画像あたりの上限200領域を超えています。');for(const r of rects0){if(r.w>12000||r.h>12000||r.w*r.h>capOne)throw Error('出力1枚の上限（1辺12,000px・6,720万画素）を超える範囲があります。');total++;pixels+=r.w*r.h;all.push({item,r});}}if(total>capOutputs)throw Error(`出力予定が${total}枚です。上限400枚を超えています。`);if(pixels>capOutPixels)throw Error(`保存予定の合計画素数${pixels.toLocaleString()}が上限134,400,000画素を超えています。`);}catch(e){state.busy=false;$('#process').disabled=false;$('#cancel').disabled=true;UI.toast(e.message,'danger');return;}
    const format=$('#format').value,ext=format.split('/')[1].replace('jpeg','jpg'),quality=clamp(+$('#quality').value,1,100)/100;$('#progress').max=all.length;$('#progress').value=0;
    for(let i=0;i<all.length;i++){if(state.stopped)break;const {item,r}=all[i];try{const c=document.createElement('canvas');c.width=r.w;c.height=r.h;const cctx=c.getContext('2d');if(format==='image/jpeg'){cctx.fillStyle='#fff';cctx.fillRect(0,0,r.w,r.h);}cctx.drawImage(item.img,r.x,r.y,r.w,r.h,0,0,r.w,r.h);const blob=await UI.canvasToBlob(c,format,quality);c.width=0;c.height=0;const name=outName(item,i+1,ext),path=item.path.split('/').slice(0,-1).concat(name).join('/'),url=URL.createObjectURL(blob);state.outputs.push({name,path,blob,url});const figure=document.createElement('div');figure.className='output-row';const im=document.createElement('img');im.src=url;im.alt='';const cap=document.createElement('span');cap.textContent=`${name} · ${r.w}×${r.h}`;const b=document.createElement('button');b.className='btn save';b.textContent='保存';b.onclick=()=>UI.downloadBlob(blob,name);figure.append(im,cap,b);$('#outputs').append(figure);}catch(e){UI.toast(`${item.file.name}: ${e.message}`,'danger');}$('#progress').value=i+1;$('#status').textContent=`${i+1}/${all.length}領域を処理しました。`;await new Promise(requestAnimationFrame);}
    state.busy=false;$('#process').disabled=false;$('#cancel').disabled=true;$('#zip').disabled=!state.outputs.length;$('#status').textContent=state.stopped?`中止しました。完了した${state.outputs.length}領域は保存できます。`:`${state.outputs.length}領域を書き出しました。`;
  }
  $('#choose').onclick=()=>$('#files').click();$('#choose-folder').onclick=()=>$('#folder').click();$('#files').onchange=e=>add([...e.target.files]);$('#folder').onchange=e=>add([...e.target.files]);UI.setupDropzone($('#dropzone'),{onFiles:add});
  document.addEventListener('paste',e=>{const files=[...(e.clipboardData?.items||[])].filter(x=>x.type.startsWith('image/')).map(x=>x.getAsFile()).filter(Boolean);if(files.length)add(files);else UI.toast('画像形式のクリップボードデータではありません。','danger');});
  $('#mode').onchange=()=>{renderActive();renderPreview();};$('#active-image').onchange=()=>renderPreview();['rows','cols','gap','tile-w','tile-h','tile-gap'].forEach(id=>$('#'+id).addEventListener('input',renderPreview));
  $('#add-v').onclick=()=>{const x=active();if(x&&x.v.length+x.h.length<capAreas-1){x.v.push(Math.round(x.width/2));renderPreview();}};$('#add-h').onclick=()=>{const x=active();if(x&&x.v.length+x.h.length<capAreas-1){x.h.push(Math.round(x.height/2));renderPreview();}};$('#clear-lines').onclick=()=>{const x=active();if(x){x.v=[];x.h=[];renderPreview();}};
  $('#add-box').onclick=()=>{const x=active();if(x&&x.boxes.length<capAreas){x.boxes.push({x:Math.round(x.width*.2),y:Math.round(x.height*.2),w:Math.round(x.width*.6),h:Math.round(x.height*.6)});state.selectedBox=x.boxes.length-1;renderPreview();}};$('#duplicate-box').onclick=()=>{const x=active(),b=x?.boxes[state.selectedBox];if(b&&x.boxes.length<capAreas){x.boxes.push({...b,x:Math.min(x.width-b.w,b.x+20),y:Math.min(x.height-b.h,b.y+20)});state.selectedBox=x.boxes.length-1;renderPreview();}};$('#delete-box').onclick=()=>{const x=active();if(x&&x.boxes.length>1){x.boxes.splice(state.selectedBox,1);state.selectedBox=0;renderPreview();}};
  $('#process').onclick=run;$('#cancel').onclick=()=>{state.stopped=true;$('#status').textContent='中止処理中です。完了分は保持します。'};$('#zip').onclick=async()=>{try{const zip=new JSZip(),used=new Set();state.outputs.forEach(o=>zip.file(UI.uniqueName(o.path,used),o.blob));UI.downloadBlob(await zip.generateAsync({type:'blob'}),'image-tiles.zip');}catch{UI.toast('ZIPを作成できませんでした。','danger');}};
  window.addEventListener('beforeunload',()=>state.outputs.forEach(o=>URL.revokeObjectURL(o.url)));
})();
