(() => {
  const UI = window.KygImageSuiteUI;
  const Store = window.KygImageSuiteStorage;
  const app = document.getElementById('app');
  const state = { items: [], mode: 'keep', quality: 75, stripMeta: true, abort: false, results: [] };

  function render() {
    app.innerHTML = `
      <section class="panel">
        <div class="dropzone" id="dz"><p>画像を追加（最大20枚・合計100MB）</p>
          <input type="file" accept="image/*,.svg" multiple hidden>
          <button type="button" class="btn" id="pick">ファイルを選ぶ</button>
          <button type="button" class="btn ghost" id="pickDir">フォルダー</button></div>
        <p class="hint" id="count">0 / 20</p>
      </section>
      <section class="panel">
        <div class="field"><label>方式</label>
          <select id="mode">
            <option value="keep">画質優先・最適化</option>
            <option value="manual">圧縮率指定（手動調整）</option>
          </select></div>
        <div class="field"><label>圧縮率 1〜100（100=高画質）: <span id="qv">75</span></label>
          <input type="range" id="q" min="1" max="100" value="75"></div>
        <label><input type="checkbox" id="strip" checked> メタデータ（Exif等）を削除して軽量化</label>
        <div class="actions">
          <button class="btn primary" id="run" type="button">すべて処理</button>
          <button class="btn danger" id="abort" type="button">中止</button>
          <button class="btn" id="zip" type="button" disabled>ZIPで保存</button>
        </div>
        <div class="status-bar" id="status">待機中</div>
        <div class="preview-box" id="prev"></div>
      </section>`;
    wire();
    const saved = Store.getSetting('slim.settings');
    if (saved?.quality) {
      document.getElementById('q').value = saved.quality;
      document.getElementById('qv').textContent = saved.quality;
      state.quality = saved.quality;
    }
  }

  async function slimFile(file) {
    // GIF/SVG: pass-through or light re-encode stills only for non-animated path
    if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) {
      let text = await file.text();
      if (state.stripMeta) text = text.replace(/<!--([\s\S]*?)-->/g, '');
      const blob = new Blob([text], { type: 'image/svg+xml' });
      return blob.size < file.size ? blob : file;
    }
    if (file.type === 'image/gif' || /\.gif$/i.test(file.name) || file.type === 'image/apng') {
      // Keep animation: without dedicated encoder, return original (寸法非変更・動き維持)
      return file;
    }
    const img = await UI.loadImageFromFile(file);
    const w = img.naturalWidth, h = img.naturalHeight;
    if (w * h > 16_000_000) throw new Error('1枚1,600万画素まで: ' + file.name);
    if (Math.max(w,h) > 12000) throw new Error('1辺12,000pxまで');
    UI.assertCanvasSafe(w, h);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    let mime = file.type || 'image/jpeg';
    if (!/^image\/(jpeg|png|webp)$/.test(mime)) mime = 'image/jpeg';
    let q = state.mode === 'keep' ? 0.92 : state.quality / 100;
    if (state.mode === 'keep' && (mime === 'image/jpeg' || mime === 'image/webp')) {
      // 画質優先: 再エンコードを抑えめ。メタ削除目的の軽い再保存
      q = 0.95;
    }
    const blob = await UI.canvasToBlob(canvas, mime, q);
    return blob.size < file.size ? blob : file;
  }

  async function run() {
    state.mode = document.getElementById('mode').value;
    state.quality = +document.getElementById('q').value;
    state.stripMeta = document.getElementById('strip').checked;
    Store.setSetting('slim.settings', { quality: state.quality, mode: state.mode });
    state.abort = false;
    const prev = document.getElementById('prev');
    prev.innerHTML = '';
    state.results = [];
    let totalPx = 0;
    for (let i = 0; i < state.items.length; i++) {
      if (state.abort) break;
      const it = state.items[i];
      document.getElementById('status').textContent = `処理中 ${i+1}/${state.items.length}`;
      try {
        if (it.file.size > 20*1024*1024) throw new Error('1ファイル20MBまで');
        const img = await UI.loadImageFromFile(it.file).catch(()=>null);
        if (img) totalPx += img.naturalWidth * img.naturalHeight;
        if (totalPx > 64_000_000) throw new Error('合計画素6,400万を超えます');
        const out = await slimFile(it.file);
        const name = it.file.name;
        state.results.push({ name, blob: out, before: it.file.size, after: out.size });
        const url = URL.createObjectURL(out);
        const rate = Math.max(0, Math.round((1 - out.size / it.file.size) * 100));
        prev.insertAdjacentHTML('beforeend', `<figure><img src="${url}" alt=""><figcaption>${name}: ${UI.formatBytes(it.file.size)} → ${UI.formatBytes(out.size)}（-${rate}%）
          <button type="button" class="btn" data-i="${state.results.length-1}">保存</button></figcaption></figure>`);
      } catch (e) {
        UI.toast(e.message || String(e), 'danger');
      }
    }
    prev.querySelectorAll('[data-i]').forEach((b) => b.onclick = () => {
      const r = state.results[+b.dataset.i];
      UI.downloadBlob(r.blob, r.name);
    });
    document.getElementById('zip').disabled = !state.results.length;
    document.getElementById('status').textContent = state.abort ? '中止' : `完了 ${state.results.length} 件`;
  }

  function wire() {
    const dz = document.getElementById('dz');
    UI.setupDropzone(dz, { onFiles: addFiles });
    document.getElementById('pick').onclick = () => dz.querySelector('input').click();
    document.getElementById('pickDir').onclick = () => {
      const i = document.createElement('input'); i.type='file'; i.webkitdirectory=true; i.multiple=true;
      i.onchange = () => addFiles([...i.files]); i.click();
    };
    document.addEventListener('paste', (e) => {
      const fs=[...(e.clipboardData?.files||[])]; if(fs.length) addFiles(fs);
    });
    document.getElementById('q').oninput = (e) => { document.getElementById('qv').textContent = e.target.value; };
    document.getElementById('run').onclick = run;
    document.getElementById('abort').onclick = () => { state.abort = true; };
    document.getElementById('zip').onclick = () => UI.zipAndDownload(state.results.map(r=>({name:r.name,blob:r.blob})), 'slimmed.zip');
  }

  function addFiles(files) {
    let sum = state.items.reduce((a,b)=>a+b.file.size,0);
    for (const f of files) {
      if (state.items.length >= 20) break;
      if (sum + f.size > 100*1024*1024) { UI.toast('合計100MBを超えます','danger'); break; }
      state.items.push({ file: f });
      sum += f.size;
    }
    document.getElementById('count').textContent = `${state.items.length} / 20`;
  }

  render();
})();
