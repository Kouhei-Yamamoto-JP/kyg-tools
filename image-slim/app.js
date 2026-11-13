(() => {
  const UI = window.KygImageSuiteUI;
  const Store = window.KygImageSuiteStorage;
  const app = document.getElementById('app');
  const state = { items: [], mode: 'keep', strength: 40, stripMeta: true, abort: false, results: [] };
  const MiB = 1024 * 1024;
  let fflatePromise;

  function render() {
    app.innerHTML = `
      <section class="panel">
        <div class="dropzone" id="dz"><p>画像を追加（最大20枚・合計100MB）</p>
          <input type="file" accept="image/*,.svg,.heic,.heif" multiple hidden>
          <button type="button" class="btn" id="pick">ファイルを選ぶ</button>
          <button type="button" class="btn ghost" id="pickDir">フォルダー</button></div>
        <p class="hint" id="count">0 / 20</p>
      </section>
      <section class="panel">
        <h2>2. 圧縮方法を調整</h2><div class="field"><label>方式</label>
          <select id="mode"><option value="keep">画質優先・最適化</option><option value="manual">圧縮率指定（手動調整）</option></select></div>
        <div class="field"><label>圧縮強度 1〜100（強いほど軽量化）: <span id="qv">40</span></label><input type="range" id="q" min="1" max="100" value="40"></div>
        <label><input type="checkbox" id="strip" checked> メタデータ（Exif等）を削除して軽量化</label>
        <div class="actions"><button class="btn primary" id="runSelected" type="button">選択した画像を処理</button><button class="btn" id="run" type="button">すべて処理</button><button class="btn danger" id="abort" type="button">中止</button><button class="btn" id="zip" type="button" disabled>ZIPで保存</button></div>
        <div id="file-list" class="file-list"></div><div class="status-bar" id="status">待機中</div><h2>3. 比較して保存</h2><div class="preview-box" id="prev"></div>
      </section>`;
    wire();
    const saved = Store.getSetting('slim.settings.v2');
    if (saved?.strength) { document.getElementById('q').value = saved.strength; document.getElementById('qv').textContent = saved.strength; state.strength = saved.strength; }
  }

  function bytesView(blob) { return blob.arrayBuffer().then((b) => new Uint8Array(b)); }
  function u32(a, p) { return (a[p] | a[p+1] << 8 | a[p+2] << 16 | a[p+3] << 24) >>> 0; }
  function ascii(a, p, n) { return String.fromCharCode(...a.subarray(p, p+n)); }
  function blobFrom(a, type) { return new Blob([a], { type }); }
  function smallerOrOriginal(file, blob) { return blob.size < file.size ? blob : file; }

  function pngCrc32(type, data) {
    let crc = 0xffffffff;
    for (let i = 0; i < 4 + data.length; i++) {
      const value = i < 4 ? type.charCodeAt(i) : data[i - 4];
      crc ^= value;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function makePngChunk(type, data) {
    const chunk = new Uint8Array(data.length + 12), view = new DataView(chunk.buffer);
    view.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) chunk[4 + i] = type.charCodeAt(i);
    chunk.set(data, 8);
    view.setUint32(chunk.length - 4, pngCrc32(type, data));
    return chunk;
  }

  function concatBytes(parts) {
    const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
    let offset = 0;
    for (const part of parts) { out.set(part, offset); offset += part.length; }
    return out;
  }

  function redistribute(data, lengths) {
    const out = [];
    let offset = 0, remainingWeight = lengths.reduce((n, length) => n + length, 0);
    for (let i = 0; i < lengths.length; i++) {
      const remainingChunks = lengths.length - i;
      const size = i === lengths.length - 1 ? data.length - offset : remainingWeight
        ? Math.min(data.length - offset, Math.round((data.length - offset) * lengths[i] / remainingWeight))
        : Math.floor((data.length - offset) / remainingChunks);
      out.push(data.subarray(offset, offset + size));
      offset += size;
      remainingWeight -= lengths[i];
    }
    return out;
  }

  async function optimiseApng(data, file) {
    if (!fflatePromise) fflatePromise = import('/assets/image-suite/vendor/fflate/browser.mjs');
    const { unzlibSync, zlibSync } = await fflatePromise;
    const chunks = [];
    for (let p = 8; p < data.length;) {
      if (p + 12 > data.length) throw new Error(`${file.name}: PNGチャンクが途中で切れています。`);
      const length = new DataView(data.buffer, data.byteOffset + p, 4).getUint32(0);
      const end = p + 12 + length;
      if (end > data.length) throw new Error(`${file.name}: PNGチャンク長が不正です。`);
      const type = ascii(data, p + 4, 4);
      chunks.push({ type, raw: data.subarray(p, end), payload: data.subarray(p + 8, p + 8 + length) });
      p = end;
      if (type === 'IEND') break;
    }
    if (!chunks.some((chunk) => chunk.type === 'acTL')) return null;
    const frameCount = chunks.filter((chunk) => chunk.type === 'fcTL').length;
    if (frameCount > 200) throw new Error(`${file.name}: アニメーションは200フレームまでです。`);

    // APNG control chunks are copied byte-for-byte. Only complete zlib streams are
    // recompressed; the resulting bytes are distributed over the same data chunks,
    // so every fdAT sequence number and all timing/rectangle/blend fields survive.
    const replacements = new Map();
    for (let i = 0; i < chunks.length;) {
      const type = chunks[i].type;
      if (type !== 'IDAT' && type !== 'fdAT') { i++; continue; }
      const group = [];
      while (i < chunks.length && chunks[i].type === type) group.push(chunks[i++]);
      const payloads = group.map((chunk) => type === 'fdAT' ? chunk.payload.subarray(4) : chunk.payload);
      const compressed = concatBytes(payloads);
      const raw = unzlibSync(compressed);
      const optimized = zlibSync(raw, { level: 9 });
      const pieces = redistribute(optimized, payloads.map((part) => part.length));
      group.forEach((chunk, index) => {
        const payload = type === 'fdAT'
          ? concatBytes([chunk.payload.subarray(0, 4), pieces[index]])
          : pieces[index];
        replacements.set(chunk, makePngChunk(type, payload));
      });
    }
    const result = concatBytes([data.subarray(0, 8), ...chunks.map((chunk) => replacements.get(chunk) || chunk.raw)]);
    const optimized = blobFrom(result, 'image/png');
    return optimized.size < file.size ? optimized : blobFrom(data, 'image/png');
  }

  async function optimisePng(file) {
    const data = await bytesView(file);
    if (ascii(data, 0, 8) !== '\x89PNG\r\n\x1a\n') return file;
    // APNG image streams are losslessly recompressed while the animation chunks stay intact.
    let apng = false;
    for (let p=8; p+12<=data.length;) { const n=((data[p]<<24)|(data[p+1]<<16)|(data[p+2]<<8)|data[p+3])>>>0; const type=ascii(data,p+4,4); if(type==='acTL')apng=true; p += 12+n; if(type==='IEND')break; }
    if (apng) return optimiseApng(data, file);
    const { default: optimise } = await import('/assets/image-suite/vendor/oxipng/optimise.js');
    const out = await optimise(data, { level: 2, optimiseAlpha: true });
    return smallerOrOriginal(file, blobFrom(out, 'image/png'));
  }

  function gifInfo(a) {
    if (!/^GIF8[79]a$/.test(ascii(a,0,6))) return null;
    const w=a[6]|a[7]<<8, h=a[8]|a[9]<<8, packed=a[10]; let p=13, frames=0;
    if(packed&0x80)p += 3*(1<<((packed&7)+1));
    while(p<a.length) {
      const b=a[p++];
      if(b===0x3b)break;
      if(b===0x21) { p++; while(p<a.length){const n=a[p++];if(!n)break;p+=n;} }
      else if(b===0x2c) { if(p+9>a.length)break; const flags=a[p+8]; p+=9; if(flags&0x80)p+=3*(1<<((flags&7)+1)); p++; frames++; while(p<a.length){const n=a[p++];if(!n)break;p+=n;} }
      else break;
    }
    return {w,h,frames};
  }
  async function optimiseGif(file) {
    const data=await bytesView(file), info=gifInfo(data);
    if(!info) return file;
    checkAnimation(file.name, info.w, info.h, info.frames);
    const { default: gifsicle } = await import('/assets/image-suite/vendor/gifsicle/gifsicle.min.js');
    const output=await gifsicle.run({ input:[{file,name:'source.gif'}], command:['-O2 source.gif -o /out/optimised.gif'] });
    const result=output.find((x)=>/optimised\.gif$/i.test(x.name)) || output[0];
    return smallerOrOriginal(file, new Blob([await result.arrayBuffer()], {type:'image/gif'}));
  }
  function checkAnimation(name,w,h,frames) {
    if(frames>200) throw new Error(`${name}: アニメーションは200フレームまでです。`);
    if(w*h*frames>24_000_000) throw new Error(`${name}: アニメーション合計2,400万画素までです。`);
  }

  async function stripJpeg(file) {
    const a=await bytesView(file), chunks=[a.subarray(0,2)]; let p=2, ok=false;
    if(a[0]!==0xff||a[1]!==0xd8)return file;
    while(p<a.length) {
      const start=p; if(a[p++]!==0xff){return file;}
      while(p<a.length&&a[p]===0xff)p++;
      if(p>=a.length)return file;
      const marker=a[p++];
      if(marker===0xda){chunks.push(a.subarray(start)); ok=true; break;}
      if(marker===0xd9){chunks.push(a.subarray(start,p)); ok=true; break;}
      if(marker>=0xd0&&marker<=0xd7||marker===0x01){chunks.push(a.subarray(start,p));continue;}
      if(p+2>a.length)return file;
      const len=(a[p]<<8)|a[p+1], end=p+len;
      if(end>a.length||len<2)return file;
      const payload=ascii(a,p+2,Math.min(32,len-2));
      const exif=marker===0xe1&&payload.startsWith('Exif\0\0');
      const isXmp=marker===0xe1&&(payload.startsWith('http://ns.adobe.com/xap/1.0/')||payload.startsWith('http://ns.adobe.com/xmp/'));
      const remove=state.stripMeta&&(marker===0xfe||marker===0xed||isXmp);
      if(state.stripMeta&&exif){const kept=orientationOnlyExif(a.subarray(p+2,end));if(kept)chunks.push(jpegSegment(0xe1,kept));}
      else if(!remove)chunks.push(a.subarray(start,end));
      p=end;
    }
    if(!ok)return file;
    const out=new Uint8Array(chunks.reduce((n,c)=>n+c.length,0));let at=0;for(const c of chunks){out.set(c,at);at+=c.length;}
    return smallerOrOriginal(file, blobFrom(out,'image/jpeg'));
  }
  function jpegSegment(marker,payload){const out=new Uint8Array(payload.length+4);out[0]=0xff;out[1]=marker;out[2]=(payload.length+2)>>8;out[3]=(payload.length+2)&255;out.set(payload,4);return out;}
  function orientationOnlyExif(payload){
    if(ascii(payload,0,6)!=='Exif\0\0'||payload.length<14)return null;
    const t=payload.subarray(6),little=ascii(t,0,2)==='II';if(!little&&ascii(t,0,2)!=='MM')return null;
    const view=new DataView(t.buffer,t.byteOffset,t.byteLength),u16=(o)=>view.getUint16(o,little),u32=(o)=>view.getUint32(o,little);
    if(u16(2)!==42)return null;const ifd=u32(4);if(ifd+2>t.length)return null;const count=u16(ifd);let orient=null;
    for(let i=0;i<count;i++){const p=ifd+2+i*12;if(p+12>t.length)break;if(u16(p)===0x0112){orient=t.slice(p,p+12);break;}}
    if(!orient)return null;
    const cleanTiff=new Uint8Array(26);cleanTiff.set(t.subarray(0,8));new DataView(cleanTiff.buffer).setUint32(4,8,little);new DataView(cleanTiff.buffer).setUint16(8,1,little);cleanTiff.set(orient,10);new DataView(cleanTiff.buffer).setUint32(22,0,little);
    const out=new Uint8Array(6+cleanTiff.length);out.set(payload.subarray(0,6));out.set(cleanTiff,6);return out;
  }
  async function stripWebp(file) {
    const a=await bytesView(file);if(ascii(a,0,4)!=='RIFF'||ascii(a,8,4)!=='WEBP')return file;
    const declared=u32(a,4); if(8+declared>a.length)return file;
    const chunks=[];let p=12, vp8x=null;
    while(p+8<=a.length && p<12+declared){const size=u32(a,p+4),end=p+8+size+(size&1);if(end>a.length)return file;const type=ascii(a,p,4);if(type==='VP8X')vp8x=a.subarray(p,end);chunks.push({type,data:a.subarray(p,end)});p=end;}
    if(!chunks.length)return file;
    const kept=state.stripMeta?chunks.filter(c=>c.type!=='EXIF'&&c.type!=='XMP '):chunks;
    if(vp8x&&state.stripMeta&&kept.some(c=>c.type==='VP8X')){const v=vp8x.slice();v[8]&=~0x0c;kept[kept.findIndex(c=>c.type==='VP8X')].data=v;}
    const length=12+kept.reduce((n,c)=>n+c.data.length,0),out=new Uint8Array(length);out.set([82,73,70,70]);new DataView(out.buffer).setUint32(4,length-8,true);out.set([87,69,66,80],8);let at=12;for(const c of kept){out.set(c.data,at);at+=c.data.length;}
    return smallerOrOriginal(file,blobFrom(out,'image/webp'));
  }
  async function tidySvg(file) {
    let text=await file.text();
    // Preserve text nodes and whitespace-sensitive SVG content; only remove XML comments.
    text=text.replace(/<!--[\s\S]*?-->/g,'').trim();
    return smallerOrOriginal(file,new Blob([text],{type:'image/svg+xml'}));
  }
  async function manualReencode(file) {
    const img=await UI.loadImageFromFile(file),w=img.naturalWidth,h=img.naturalHeight;
    if(w*h>16_000_000)throw new Error('1枚1,600万画素まで: '+file.name);
    UI.assertCanvasSafe(w,h);const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;canvas.getContext('2d').drawImage(img,0,0);
    let mime=file.type||'image/jpeg';if(!/^image\/(jpeg|png|webp)$/.test(mime))mime='image/jpeg';
    // Browser JPEG/WebP encoders accept quality rather than a reduction strength.
    // Reverse the reference slider direction while retaining its 1–100 scale.
    const quality = Math.max(0.01, (101 - state.strength) / 100);
    let out=await UI.canvasToBlob(canvas,mime,quality);
    // Canvas PNG ignores quality; follow keep-mode oxipng so small PNGs still shrink like the reference.
    if(mime==='image/png'){
      const tmp=new File([out], file.name.replace(/\.webp$/i,'.png').replace(/\.jpe?g$/i,'.png'), {type:'image/png'});
      out=await optimisePng(tmp);
    }
    return smallerOrOriginal(file,out);
  }
  async function isApng(file) {
    const data = await bytesView(file);
    if (ascii(data, 0, 8) !== '\x89PNG\r\n\x1a\n') return false;
    for (let p = 8; p + 12 <= data.length;) {
      const length = ((data[p] << 24) | (data[p+1] << 16) | (data[p+2] << 8) | data[p+3]) >>> 0;
      const type = ascii(data, p + 4, 4);
      if (type === 'acTL') return true;
      p += 12 + length;
      if (type === 'IEND') break;
    }
    return false;
  }
  async function slimFile(file) {
    // Canvas only exposes an APNG's still fallback image. Keep the animation and
    // apply the lossless stream optimizer until a frame-aware palette encoder is used.
    if(await isApng(file))return optimisePng(file);
    if(state.mode==='manual')return manualReencode(file);
    if(/\.svg$/i.test(file.name)||file.type==='image/svg+xml')return tidySvg(file);
    if(/\.gif$/i.test(file.name)||file.type==='image/gif')return optimiseGif(file);
    if(/\.apng$/i.test(file.name)||file.type==='image/apng')return optimisePng(file);
    if(/\.png$/i.test(file.name)||file.type==='image/png')return optimisePng(file);
    if(/\.jpe?g$/i.test(file.name)||file.type==='image/jpeg')return stripJpeg(file);
    if(/\.webp$/i.test(file.name)||file.type==='image/webp')return stripWebp(file);
    // HEIC/HEIF decoding is for previews/manual mode; keep mode preserves its original encoding.
    return file;
  }

  async function run(selectedOnly = false) {
    state.mode=document.getElementById('mode').value;state.strength=+document.getElementById('q').value;state.stripMeta=document.getElementById('strip').checked;
    Store.setSetting('slim.settings.v2',{strength:state.strength,mode:state.mode});state.abort=false;
    const prev=document.getElementById('prev');state.results.forEach(r=>(r.previewUrls||[]).forEach(URL.revokeObjectURL));prev.innerHTML='';state.results=[];
    let animatedPx=0,totalBytes=0;for(const it of state.items)totalBytes+=it.file.size;
    if(state.items.length>20)throw new Error('最大20枚までです。');if(totalBytes>100*MiB)throw new Error('合計100MBを超えます。');
    const chosen=state.items.map((it,i)=>({it,i})).filter(({it})=>!selectedOnly||it.selected);
    if(!chosen.length){document.getElementById('status').textContent='処理する画像を選んでください。';return;}
    for(let k=0;k<chosen.length;k++){
      if(state.abort)break;const {it,i}=chosen[k],file=it.file;document.getElementById('status').textContent=`処理中 ${k+1}/${chosen.length}`;
      try{
        if(file.size>20*MiB)throw new Error(`${file.name}: 1ファイル20MBまで`);
        const data=await bytesView(file);let w=0,h=0,frames=1,decoded=null;
        if(/\.gif$/i.test(file.name)||file.type==='image/gif'){const info=gifInfo(data);if(info){w=info.w;h=info.h;frames=info.frames;checkAnimation(file.name,w,h,frames);}}
        else if(ascii(data,0,8)==='\x89PNG\r\n\x1a\n'){w=new DataView(data.buffer,data.byteOffset).getUint32(16);h=new DataView(data.buffer,data.byteOffset).getUint32(20);let controls=0;for(let p=8;p+12<=data.length;){const n=((data[p]<<24)|(data[p+1]<<16)|(data[p+2]<<8)|data[p+3])>>>0;const type=ascii(data,p+4,4);if(type==='fcTL')controls++;p+=12+n;if(type==='IEND')break;}if(controls)frames=controls;if(frames>1)checkAnimation(file.name,w,h,frames);}
        else {decoded=await UI.loadImageFromFile(file);w=decoded.naturalWidth;h=decoded.naturalHeight;}
        if(w*h>16_000_000)throw new Error(`${file.name}: 1枚1,600万画素まで`);
        if(frames>1)animatedPx+=w*h*frames;
        if(animatedPx>24_000_000)throw new Error('アニメーション画像の合計2,400万画素までです。');
        const out=await slimFile(file),ext=(file.name.match(/\.([^.]+)$/)?.[1]||'png').toLowerCase();
        const name=`${String(state.results.length+1).padStart(2,'0')}-${file.name.replace(/\.[^.]+$/,'')}-compressed.${ext}`;
        state.results.push({name,blob:out,before:file.size,after:out.size});
        const previewBlob=UI.isHeicFile(file)&&(decoded?.sourceBlob)?decoded.sourceBlob:out;
        const beforeUrl=URL.createObjectURL(file),afterUrl=URL.createObjectURL(previewBlob),rate=Math.max(0,((1-out.size/file.size)*100)).toFixed(1);state.results[state.results.length-1].previewUrls=[beforeUrl,afterUrl];
        const fig=document.createElement('figure'),caption=document.createElement('figcaption'),button=document.createElement('button'),compare=document.createElement('div');compare.className='compare-view';
        const before=document.createElement('img'),after=document.createElement('img');before.src=beforeUrl;after.src=afterUrl;before.alt='圧縮前';after.alt='圧縮後';
        const animated=/gif|apng/i.test(file.type||file.name);
        if(animated){compare.classList.add('compare-animated');const left=document.createElement('div'),right=document.createElement('div');left.className=right.className='compare-side';left.append('圧縮前',before);right.append('圧縮後',after);compare.append(left,right);}
        else {const layer=document.createElement('div');layer.className='compare-after';layer.append(after);const fitOverlay=()=>{after.style.width=`${compare.clientWidth}px`;after.style.height=`${before.clientHeight}px`;};before.onload=fitOverlay;after.onload=fitOverlay;const slider=document.createElement('input');slider.type='range';slider.min='0';slider.max='100';slider.value='50';slider.setAttribute('aria-label','比較位置');slider.oninput=()=>layer.style.width=`${slider.value}%`;compare.append(before,layer,slider);requestAnimationFrame(fitOverlay);}
        caption.append(`${name}: ${UI.formatBytes(file.size)} → ${UI.formatBytes(out.size)}（-${rate}%） `);button.type='button';button.className='btn';button.textContent='この画像を保存';button.dataset.i=String(state.results.length-1);caption.append(button);fig.append(compare,caption);prev.append(fig);
      }catch(e){UI.toast(e.message||String(e),'danger');}
    }
    prev.querySelectorAll('[data-i]').forEach(b=>b.onclick=()=>{const r=state.results[+b.dataset.i];UI.downloadBlob(r.blob,r.name);});
    document.getElementById('zip').disabled=!state.results.length;document.getElementById('status').textContent=state.abort?'中止':`完了 ${state.results.length} 件`;
  }
  function renderFiles(){const host=document.getElementById('file-list');host.replaceChildren();state.items.forEach(it=>{const label=document.createElement('label');label.className='file-choice';const box=document.createElement('input');box.type='checkbox';box.checked=!!it.selected;box.onchange=()=>it.selected=box.checked;label.append(box,document.createTextNode(it.file.name));host.append(label);});}
  function wire(){const dz=document.getElementById('dz');UI.setupDropzone(dz,{onFiles:addFiles});document.getElementById('pick').onclick=()=>dz.querySelector('input').click();document.getElementById('pickDir').onclick=()=>{const i=document.createElement('input');i.type='file';i.webkitdirectory=true;i.multiple=true;i.onchange=()=>addFiles([...i.files]);i.click();};document.addEventListener('paste',e=>{const fs=[...(e.clipboardData?.files||[])];if(fs.length)addFiles(fs);});document.getElementById('q').oninput=e=>document.getElementById('qv').textContent=e.target.value;document.getElementById('run').onclick=()=>run(false).catch(e=>UI.toast(e.message||String(e),'danger'));document.getElementById('runSelected').onclick=()=>run(true).catch(e=>UI.toast(e.message||String(e),'danger'));document.getElementById('abort').onclick=()=>state.abort=true;document.getElementById('zip').onclick=()=>UI.zipAndDownload(state.results.map(r=>({name:r.name,blob:r.blob})),'slimmed.zip');}
  function addFiles(files){let sum=state.items.reduce((a,b)=>a+b.file.size,0);for(const f of files){if(state.items.length>=20){UI.toast('最大20枚までです。','danger');break;}if(f.size>20*MiB){UI.toast(`${f.name}: 1ファイル20MBまで`,'danger');continue;}if(sum+f.size>100*MiB){UI.toast('合計100MBを超えます。','danger');break;}state.items.push({file:f,selected:true});sum+=f.size;}document.getElementById('count').textContent=`${state.items.length} / 20`;renderFiles();}
  render();
})();
