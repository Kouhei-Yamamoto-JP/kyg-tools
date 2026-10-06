(() => {
  const UI = window.KygImageSuiteUI;
  const Store = window.KygImageSuiteStorage;
  const $ = (s) => document.querySelector(s);
  const allowed = /\.(png|jpe?g|webp|gif|avif|bmp|ico|svg)$/i;
  const state = { images: [], layers: [], outputs: [], activeLayer: null, stopped: false, busy: false };
  const label = (text) => { const e = document.createElement('label'); e.textContent = text; return e; };
  const field = (caption, control) => { const wrap = document.createElement('div'); wrap.className = 'field'; const l = label(caption); if (control.id) l.htmlFor = control.id; wrap.append(l, control); return wrap; };
  const control = (type, value, min, max, step = 1) => { const e = document.createElement('input'); e.type = type; if (value != null) e.value = value; if (min != null) e.min = min; if (max != null) e.max = max; if (step != null) e.step = step; return e; };
  async function validFiles(files) {
    let pixels = state.images.reduce((n, x) => n + (x.width || 0) * (x.height || 0), 0);
    for (const file of files) {
      if (!(file.type.startsWith('image/') || allowed.test(file.name))) { UI.toast('対応していない画像形式です。PNG、JPG、WebP、GIF、AVIF、BMP、ICO、SVGを選んでください。', 'danger'); continue; }
      if (state.images.some((x) => x.file === file)) continue;
      if (state.images.length >= 20) { UI.toast('画像は最大20枚まで追加できます。', 'danger'); break; }
      if (file.size > 50 * 1024 * 1024) { UI.toast(`${file.name}: 1ファイル50 MBを超えています。`, 'danger'); continue; }
      try {
        const image = await UI.loadImageFromFile(file), size = image.width * image.height;
        if (size > 67_200_000) { UI.toast(`${file.name}: ${size.toLocaleString()}画素が上限67,200,000画素を超えています。`, 'danger'); continue; }
        if (pixels + size > 100_000_000) { UI.toast('元画像の合計画素数が100,000,000画素を超えます。', 'danger'); break; }
        pixels += size; state.images.push({ file, width: image.width, height: image.height, path: file.webkitRelativePath || file.name });
      } catch { UI.toast(`${file.name}: ファイルを読み込めませんでした。画像が破損している可能性があります。`, 'danger'); }
    }
    renderImages(); renderPreview();
  }
  function renderImages() {
    const host = $('#image-list'); host.replaceChildren();
    state.images.forEach((item, i) => {
      const row = document.createElement('div'); row.className = 'image-row';
      if(item.thumb)URL.revokeObjectURL(item.thumb);const thumb = document.createElement('img'); thumb.alt = ''; thumb.src = URL.createObjectURL(item.file); item.thumb = thumb.src;
      const name = document.createElement('span'); name.textContent = `${item.file.name} · ${item.width} × ${item.height} px · ${UI.formatBytes(item.file.size)}`;
      const remove = document.createElement('button'); remove.className = 'btn remove'; remove.textContent = '取り除く'; remove.onclick = () => { URL.revokeObjectURL(item.thumb); state.images.splice(i, 1); renderImages(); renderPreview(); };
      row.append(thumb, name, remove); host.append(row);
    });
  }
  function newLayer() { return { type: 'text', text: '© KYG Style', logo: null, mode: 'single', opacity: 80, rotation: 0, x: 50, y: 50, interval: 150, tileLimit:1000, count: 10, jitter: false, size: 36, color: '#ffffff', stroke: 0, strokeColor: '#000000', letterSpacing:0, lineHeight:1.2, shadowBlur:4, shadowX:2, shadowY:2, shadowColor:'#000000', logoWidth: 200, bannerColor: '#000000', bannerOpacity: 60, bannerPad: 20, position: 'bottom' }; }
  function renderLayers() {
    const root = $('#layers'); root.replaceChildren();
    state.layers.forEach((layer, index) => {
      const card = document.createElement('article'); card.className = 'layer-card';
      card.addEventListener('click',()=>{state.activeLayer=layer;});
      card.addEventListener('dragover',e=>{if(layer.type==='logo'){e.preventDefault();card.classList.add('dragover');}});
      card.addEventListener('dragleave',()=>card.classList.remove('dragover'));
      card.addEventListener('drop',async e=>{if(layer.type!=='logo')return;e.preventDefault();card.classList.remove('dragover');const f=[...(e.dataTransfer?.files||[])].find(x=>x.type.startsWith('image/'));if(f){layer.logo=f;if($('#persist').checked)try{await Store.putBlob(`mark.logo.${index}`,f,{name:f.name});}catch{UI.toast('ブラウザ保存の容量が不足しています。','danger');}renderPreview();}});
      const top = document.createElement('div'); top.className = 'layer-top'; const title = document.createElement('strong'); title.textContent = `レイヤー ${index + 1}`;
      const actions = document.createElement('div'); actions.className = 'mini-actions';
      [['↑', -1], ['↓', 1]].forEach(([text, delta]) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.textContent = delta < 0 ? '前へ' : '後ろへ'; b.onclick = () => { const j = index + delta; if (j >= 0 && j < state.layers.length) { [state.layers[j], state.layers[index]] = [state.layers[index], state.layers[j]]; renderLayers(); renderPreview(); } }; actions.append(b); });
      const del = document.createElement('button'); del.className = 'btn danger'; del.textContent = '削除'; del.onclick = () => { state.layers.splice(index, 1); renderLayers(); renderPreview(); }; actions.append(del); top.append(title, actions); card.append(top);
      const grid = document.createElement('div'); grid.className = 'layer-grid';
      const type = document.createElement('select'); type.innerHTML = '<option value="text">文字列</option><option value="logo">ロゴ画像</option>'; type.value = layer.type;
      grid.append(field('素材', type));
      if (layer.type === 'text') { const text = document.createElement('textarea'); text.maxLength = 1000; text.rows = 2; text.value = layer.text; text.addEventListener('input', () => { layer.text = text.value; renderPreview(); }); grid.append(field('文字列（最大1,000文字・20行）', text)); }
      else { const file = document.createElement('input'); file.type = 'file'; file.accept = 'image/png,image/jpeg,image/webp,image/svg+xml'; file.addEventListener('change', async () => { const f = file.files[0]; if (f) { layer.logo = f; if ($('#persist').checked) { try { await Store.putBlob(`mark.logo.${index}`, f, { name: f.name }); } catch { UI.toast('ブラウザ保存の容量が不足しています。保存データを整理してください。', 'danger'); } } renderPreview(); } }); grid.append(field('ロゴ画像', file));
        const width = control('number', layer.logoWidth, 10, 800); width.addEventListener('input', () => { layer.logoWidth = clamp(+width.value, 10, 800); renderPreview(); }); grid.append(field('ロゴ幅（px）', width)); }
      const mode = document.createElement('select'); mode.innerHTML = '<option value="single">単一配置（固定）</option><option value="tile">全面敷き詰め（グリッド）</option><option value="random">散布配置（ランダム）</option><option value="dynamic">動的テキスト合成</option><option value="banner">帯状バナー（ヘッダー/フッター）</option>'; mode.value = layer.mode; mode.onchange = () => { layer.mode = mode.value; renderLayers(); renderPreview(); }; grid.append(field('配置方法', mode));
      const opacity = control('number', layer.opacity, 0, 100); opacity.addEventListener('input', () => { layer.opacity = clamp(+opacity.value, 0, 100); renderPreview(); }); grid.append(field('不透明度（%）', opacity));
      const rotation = control('number', layer.rotation, -180, 180); rotation.addEventListener('input', () => { layer.rotation = clamp(+rotation.value, -180, 180); renderPreview(); }); grid.append(field('回転角度（度）', rotation));
      if (layer.mode === 'single') { for (const [key, cap] of [['x', '水平位置（%）'], ['y', '垂直位置（%）']]) { const c = control('number', layer[key], 0, 100); c.addEventListener('input', () => { layer[key] = clamp(+c.value, 0, 100); renderPreview(); }); grid.append(field(cap, c)); } const p=document.createElement('select');p.innerHTML='<option value="0,0">左上</option><option value="50,0">上中央</option><option value="100,0">右上</option><option value="0,50">中央左</option><option value="50,50">中央</option><option value="100,50">中央右</option><option value="0,100">左下</option><option value="50,100">下中央</option><option value="100,100">右下</option>';p.value=`${layer.x},${layer.y}`;p.onchange=()=>{[layer.x,layer.y]=p.value.split(',').map(Number);renderLayers();renderPreview();};grid.append(field('位置プリセット',p)); }
      if (layer.mode === 'tile') { const c = control('number', layer.interval, 10, 1000); c.addEventListener('input', () => { layer.interval = clamp(+c.value, 10, 1000); renderPreview(); }); grid.append(field('タイル間隔（px）', c));const limit=control('number',layer.tileLimit,1,1000);limit.oninput=()=>{layer.tileLimit=clamp(+limit.value,1,1000);renderPreview();};grid.append(field('配置上限（個）',limit)); }
      if (layer.mode === 'random') { const c = control('number', layer.count, 1, 50); c.addEventListener('input', () => { layer.count = clamp(+c.value, 1, 50); renderPreview(); }); grid.append(field('散布する個数', c)); const j = document.createElement('input'); j.type = 'checkbox'; j.checked = layer.jitter; j.onchange = () => { layer.jitter = j.checked; renderPreview(); }; grid.append(field('角度・大きさ・透明度をランダムに変える', j)); }
      if (layer.type === 'text') { for (const [key, cap, min, max, step] of [['size', '文字サイズ（px）', 10, 800, 1], ['stroke', '縁取り幅（px）', 0, 20, 1],['letterSpacing','文字間隔（px）',-5,50,1],['lineHeight','行間（倍率）',.8,3,.1],['shadowBlur','影のぼかし（px）',0,50,1],['shadowX','影の距離X（px）',-50,50,1],['shadowY','影の距離Y（px）',-50,50,1]]) { const c = control('number', layer[key], min, max, step); c.addEventListener('input', () => { layer[key] = clamp(+c.value, min, max); renderPreview(); }); grid.append(field(cap, c)); } const color = control('color', layer.color); color.oninput = () => { layer.color = color.value; renderPreview(); }; grid.append(field('文字色', color));const strokeColor=control('color',layer.strokeColor);strokeColor.oninput=()=>{layer.strokeColor=strokeColor.value;renderPreview();};grid.append(field('縁取り色',strokeColor));const shadowColor=control('color',layer.shadowColor);shadowColor.oninput=()=>{layer.shadowColor=shadowColor.value;renderPreview();};grid.append(field('影の色',shadowColor)); }
      if (layer.mode === 'banner') { const color = control('color', layer.bannerColor); color.oninput = () => { layer.bannerColor = color.value; renderPreview(); }; grid.append(field('帯の背景色', color));const alpha=control('number',layer.bannerOpacity,0,100);alpha.oninput=()=>{layer.bannerOpacity=clamp(+alpha.value,0,100);renderPreview();};grid.append(field('帯の不透明度（%）',alpha));const pad=control('number',layer.bannerPad,0,200);pad.oninput=()=>{layer.bannerPad=clamp(+pad.value,0,200);renderPreview();};grid.append(field('帯の上下余白（px）',pad)); const pos = document.createElement('select'); pos.innerHTML = '<option value="top">上部</option><option value="center">中央</option><option value="bottom">下部</option>'; pos.value = layer.position; pos.onchange = () => { layer.position = pos.value; renderPreview(); }; grid.append(field('帯の位置', pos)); }
      card.append(grid); root.append(card);
      type.onchange = () => { layer.type = type.value; renderLayers(); renderPreview(); };
    });
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, Number.isFinite(v) ? v : a)); }
  async function loadLogo(layer) { if (layer.logo) return UI.loadImageFromFile(layer.logo); return null; }
  function paintLayer(ctx, layer, w, h, image, serial = 1, filename = '') {
    if (layer.mode === 'banner') { const textH = layer.type === 'text' ? layer.size * 1.5 : layer.logoWidth; const bandH = Math.min(h, textH + layer.bannerPad * 2); const y = layer.position === 'top' ? 0 : layer.position === 'center' ? (h - bandH) / 2 : h - bandH; ctx.save(); ctx.globalAlpha = layer.bannerOpacity / 100; ctx.fillStyle = layer.bannerColor; ctx.fillRect(0, y, w, bandH); ctx.restore(); }
    const text = layer.mode === 'dynamic' ? layer.text.replaceAll('{連番}', String(serial)).replaceAll('{ファイル名}', filename.replace(/\.[^.]+$/, '')).replaceAll('{日付}', new Date().toLocaleDateString('ja-JP')) : layer.text;
    const drawOne = (x, y, scale = 1, alpha = 1) => {
      ctx.save(); ctx.globalAlpha = (layer.opacity / 100) * alpha; ctx.translate(x, y); ctx.rotate(layer.rotation * Math.PI / 180);
      if (layer.type === 'text') { const size = layer.size * scale; ctx.font = `600 ${size}px "KygWatermarkFont", system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; ctx.letterSpacing = `${layer.letterSpacing || 0}px`;ctx.shadowColor=layer.shadowColor||'transparent';ctx.shadowBlur=layer.shadowBlur||0;ctx.shadowOffsetX=layer.shadowX||0;ctx.shadowOffsetY=layer.shadowY||0; const lines = text.split('\n').slice(0, 20); const lh = size * (layer.lineHeight||1.2); lines.forEach((line, i) => { const yy = (i - (lines.length - 1) / 2) * lh; if (layer.stroke) { ctx.lineWidth = layer.stroke; ctx.strokeStyle = layer.strokeColor; ctx.strokeText(line, 0, yy, w * 0.95); } ctx.fillStyle = layer.color; ctx.fillText(line, 0, yy, w * 0.95); }); }
      else if (image) { const iw = layer.logoWidth * scale, ih = iw * image.height / image.width; ctx.drawImage(image, -iw / 2, -ih / 2, iw, ih); }
      ctx.restore();
    };
    if (layer.mode === 'tile') { const step = Math.max(10, layer.interval), limit=clamp(layer.tileLimit||1000,1,1000); let n = 0; for (let y = -step; y <= h + step && n < limit; y += step) for (let x = -step; x <= w + step && n < limit; x += step, n++) drawOne(x, y); }
    else if (layer.mode === 'random') { const seed = (serial + 3) * 7159; let n = seed; const rand = () => { n = (n * 48271) % 2147483647; return n / 2147483647; }; for (let i = 0; i < layer.count; i++) { const scale = layer.jitter ? .55 + rand() * .9 : 1; drawOne(rand() * w, rand() * h, scale, layer.jitter ? .45 + rand() * .55 : 1); } }
    else if (layer.mode === 'banner') { const half = layer.type === 'text' ? layer.size / 2 : layer.logoWidth / 2; const y = layer.position === 'top' ? layer.bannerPad + half : layer.position === 'center' ? h / 2 : h - layer.bannerPad - half; drawOne(w / 2, y); }
    else { const x = w * layer.x / 100, y = h * layer.y / 100; drawOne(x, y); }
  }
  async function renderOne(file, serial, preview = false) {
    const image = await UI.loadImageFromFile(file); const outW = clamp(+$('out-width').value || image.width, 1, 12000); const scale = outW / image.width; const w = Math.round(outW), h = Math.round(image.height * scale);
    UI.assertCanvasSafe(w, h); if (w > 12000 || h > 12000) throw new Error('出力画像の1辺は12,000px以下に設定してください。');
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h; const ctx = canvas.getContext('2d'); const format = $('#format').value; if (format === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
    ctx.drawImage(image, 0, 0, w, h);
    for (const layer of state.layers) { let logo = null; if (layer.type === 'logo') { try { logo = await loadLogo(layer); } catch { UI.toast('ロゴ画像を読み込めませんでした。', 'danger'); } } paintLayer(ctx, layer, w, h, logo, serial, file.name); }
    if (preview) return canvas;
    const blob = await UI.canvasToBlob(canvas, format, .92); canvas.width = 0; canvas.height = 0; return blob;
  }
  async function renderPreview() {
    const host = $('#preview'); host.replaceChildren(); if (!state.images.length) return;
    try { const canvas = await renderOne(state.images[0].file, 1, true); canvas.style.maxWidth = '100%'; canvas.style.height = 'auto'; host.append(canvas); } catch (e) { $('#status').textContent = e.message; }
  }
  function clearOutputs() { state.outputs.forEach((o) => URL.revokeObjectURL(o.url)); state.outputs = []; $('#preview').replaceChildren(); $('#zip').disabled = true; }
  async function run() {
    if (!state.images.length || !state.layers.length || state.busy) { if (!state.layers.length) UI.toast('透かしレイヤーを1つ以上追加してください。', 'danger'); return; }
    clearOutputs(); state.stopped = false; state.busy = true; $('#process').disabled = true; $('#cancel').disabled = false; $('#files').disabled=$('#folder').disabled=$('#format').disabled=$('#out-width').disabled=$('#add-layer').disabled=true;$('#layers').style.pointerEvents='none';const progress = $('#progress'); progress.max = state.images.length; progress.value = 0;
    $('#outputs').replaceChildren();
    for (let i = 0; i < state.images.length; i++) { if (state.stopped) break; const item = state.images[i]; try { const blob = await renderOne(item.file, i + 1); const ext = $('#format').value.split('/')[1].replace('jpeg', 'jpg'); const name = item.file.name.replace(/\.[^.]+$/, '') + `_marked.${ext}`; const url = URL.createObjectURL(blob); state.outputs.push({ name, path: item.path.split('/').slice(0, -1).concat(name).join('/'), blob, url }); const fig=document.createElement('figure'),img=document.createElement('img'),cap=document.createElement('figcaption'),save=document.createElement('button');img.src=url;img.alt='';cap.textContent=name;save.className='btn';save.textContent='この画像を保存';save.onclick=()=>UI.downloadBlob(blob,name);fig.append(img,cap,save);$('#outputs').append(fig); $('#status').textContent = `${i + 1}/${state.images.length}枚を処理しました。`; } catch (e) { UI.toast(`${item.file.name}: ${e.message}`, 'danger'); } progress.value = i + 1; await new Promise(requestAnimationFrame); }
    state.busy = false; $('#process').disabled = false; $('#cancel').disabled = true; $('#files').disabled=$('#folder').disabled=$('#format').disabled=$('#out-width').disabled=$('#add-layer').disabled=false;$('#layers').style.pointerEvents='';$('#zip').disabled = !state.outputs.length; $('#status').textContent = state.stopped ? `中止しました。完了した${state.outputs.length}枚は保存できます。` : `${state.outputs.length}枚を書き出しました。`;
  }
  $('#choose').onclick = () => $('#files').click(); $('#choose-folder').onclick = () => $('#folder').click(); $('#files').onchange = (e) => validFiles([...e.target.files]); $('#folder').onchange = (e) => validFiles([...e.target.files]);
  UI.setupDropzone($('#dropzone'), { onFiles: validFiles, acceptDir: false });
  document.addEventListener('paste', async (e) => { const files = [...(e.clipboardData?.items || [])].filter((x) => x.type.startsWith('image/')).map((x) => x.getAsFile()).filter(Boolean); if (!files.length) { UI.toast('画像形式のクリップボードデータではありません。', 'danger'); return; } if(state.activeLayer?.type==='logo'){const f=files[0],index=state.layers.indexOf(state.activeLayer);state.activeLayer.logo=f;if($('#persist').checked)try{await Store.putBlob(`mark.logo.${index}`,f,{name:f.name});}catch{UI.toast('ブラウザ保存の容量が不足しています。','danger');}renderPreview();}else validFiles(files); });
  $('#add-layer').onclick = () => { if (state.layers.length >= 10) return UI.toast('透かしレイヤーは最大10個です。', 'danger'); state.layers.push(newLayer()); renderLayers(); renderPreview(); };
  $('#process').onclick = run; $('#cancel').onclick = () => { state.stopped = true; $('#status').textContent = '中止処理中です。完了済みの結果は保持します。'; };
  $('#zip').onclick = async () => { try { const zip = new JSZip(); const used = new Set(); state.outputs.forEach((o) => zip.file(UI.uniqueName(o.path, used), o.blob)); UI.downloadBlob(await zip.generateAsync({ type: 'blob' }), 'watermarked-images.zip'); } catch { UI.toast('ZIPを作成できませんでした。', 'danger'); } };
  $('#format').onchange = renderPreview; $('#out-width').oninput = renderPreview;
  $('#font-file').addEventListener('change', async (e) => { const file=e.target.files[0]; if(!file)return; if(file.size>5*1024*1024){UI.toast('カスタムフォントは5MB以下のファイルを選んでください。','danger');e.target.value='';return;} try{const url=URL.createObjectURL(file),font=new FontFace('KygWatermarkFont',`url(${url})`);await font.load();document.fonts.add(font);URL.revokeObjectURL(url);if($('#persist').checked)await Store.putBlob('mark.font',file,{name:file.name});renderPreview();UI.toast($('#persist').checked?'フォントを読み込み、IndexedDBに保存しました。':'フォントを読み込みました。','ok');}catch{UI.toast('フォントを読み込めませんでした。形式を確認してください。','danger');} });
  $('#reset-data').onclick = async () => { try { await Promise.all(['mark.font',...Array.from({length:10},(_,i)=>`mark.logo.${i}`)].map(id=>Store.deleteBlob(id))); Store.clearSettings('mark-images.'); UI.toast('このツールで保存したフォント・ロゴ・設定を削除しました。', 'ok'); } catch { UI.toast('保存データを削除できませんでした。', 'danger'); } };
  window.addEventListener('beforeunload', () => { state.images.forEach((x) => { if (x.thumb) URL.revokeObjectURL(x.thumb); }); state.outputs.forEach((x) => URL.revokeObjectURL(x.url)); });
  $('#add-layer').click();
  (async()=>{try{const savedFont=await Store.getBlob('mark.font');if(savedFont?.blob){const url=URL.createObjectURL(savedFont.blob),font=new FontFace('KygWatermarkFont',`url(${url})`);await font.load();document.fonts.add(font);URL.revokeObjectURL(url);}for(let i=0;i<10;i++){const saved=await Store.getBlob(`mark.logo.${i}`);if(!saved?.blob)continue;while(state.layers.length<=i)state.layers.push(newLayer());state.layers[i].type='logo';state.layers[i].logo=saved.blob;}renderLayers();renderPreview();}catch{UI.toast('保存済みの素材を読み込めませんでした。','danger');}})();
})();
