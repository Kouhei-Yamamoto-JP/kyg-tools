(() => {
  const UI = window.KygImageSuiteUI;
  const Store = window.KygImageSuiteStorage;
  const app = document.getElementById('app');
  const PRESETS = [320,480,640,800,1024,1280,1600,1920,2048,2560,3840];
  const state = {
    items: [], abort: false,
    outFmt: 'keep', resizeMode: 'original', sizePx: 1280,
    scale: 1, ai: false,
    rename: { prefix: 'img', pattern: 'prefix_num', sep: '_', start: 1, digits: 3 },
  };

  function render() {
    app.innerHTML = `
      <section class="panel">
        <div class="dropzone" id="dz"><p>画像を追加（PNG/JPG/WebP/GIF/HEIC・最大50枚）</p>
          <input type="file" accept="image/*,.heic,.heif" multiple hidden>
          <button type="button" class="btn" id="pick">ファイルを選ぶ</button></div>
        <p class="hint" id="count">0 / 50</p>
      </section>
      <section class="panel">
        <h2>出力設定</h2>
        <div class="field-row">
          <div class="field"><label>出力形式</label>
            <select id="fmt"><option value="keep">元の形式</option><option value="image/png">PNG</option>
            <option value="image/jpeg">JPG</option><option value="image/webp">WebP</option><option value="image/gif">GIF</option></select></div>
          <div class="field"><label>リサイズ</label>
            <select id="rmode">
              <option value="original">元サイズ</option>
              <option value="width">幅指定</option>
              <option value="height">高さ指定</option>
              <option value="fit">枠内に収める</option>
              <option value="x2">2倍に拡大</option>
              <option value="x4">4倍に拡大</option>
              <option value="ai2">端末内で2倍に高画質化</option>
              <option value="ai4">端末内で4倍に高画質化</option>
            </select></div>
          <div class="field"><label>サイズ(px)</label>
            <select id="preset">${PRESETS.map(p=>`<option value="${p}" ${p===1280?'selected':''}>${p}</option>`).join('')}
            </select>
            <input type="number" id="sizePx" min="1" max="12000" value="1280">
          </div>
        </div>
        <h3>自動リネーム</h3>
        <div class="field-row">
          <div class="field"><label>頭文字</label><input id="prefix" value="img"></div>
          <div class="field"><label>パターン</label>
            <select id="pattern">
              <option value="prefix_num">頭文字+連番</option>
              <option value="prefix_orig">頭文字+元ファイル名</option>
              <option value="date_prefix_num">日付+頭文字+連番</option>
              <option value="prefix_fmt_num">頭文字+形式+連番</option>
            </select></div>
          <div class="field"><label>区切り</label>
            <select id="sep"><option value="_">_</option><option value="-">-</option><option value="">なし</option></select></div>
          <div class="field"><label>開始番号</label><input type="number" id="start" min="0" value="1"></div>
          <div class="field"><label>桁数</label><input type="number" id="digits" min="1" max="6" value="3"></div>
        </div>
        <div class="actions">
          <button class="btn" id="applyName" type="button">名前規則を一覧へ反映</button>
          <button class="btn primary" id="run" type="button">変換を始める</button>
          <button class="btn" id="zip" type="button" disabled>ZIPで保存</button>
          <button class="btn danger" id="abort" type="button">中止</button>
        </div>
      </section>
      <section class="panel">
        <h2>変換リスト</h2>
        <div class="table-wrap"><table class="suite-table" id="tbl">
          <thead><tr><th>変換前</th><th>形式・寸法</th><th>容量</th><th>変換後名</th><th>状態</th><th>操作</th></tr></thead>
          <tbody></tbody>
        </table></div>
        <div class="status-bar" id="status">待機中</div>
      </section>`;
    wire();
    // restore settings
    const saved = Store.getSetting('workbench.settings');
    if (saved) {
      try {
        document.getElementById('fmt').value = saved.outFmt || 'keep';
        document.getElementById('prefix').value = saved.prefix || 'img';
      } catch {}
    }
  }

  function syncSettings() {
    state.outFmt = document.getElementById('fmt').value;
    state.resizeMode = document.getElementById('rmode').value;
    state.sizePx = +document.getElementById('sizePx').value;
    state.rename = {
      prefix: document.getElementById('prefix').value || 'img',
      pattern: document.getElementById('pattern').value,
      sep: document.getElementById('sep').value,
      start: +document.getElementById('start').value || 1,
      digits: Math.min(6, Math.max(1, +document.getElementById('digits').value || 3)),
    };
    Store.setSetting('workbench.settings', { outFmt: state.outFmt, prefix: state.rename.prefix });
  }

  function buildName(item, index, ext) {
    const r = state.rename;
    const sep = r.sep;
    const num = String(r.start + index).padStart(r.digits, '0');
    const orig = item.file.name.replace(/\.[^.]+$/, '');
    const date = new Date().toISOString().slice(0,10).replace(/-/g,'');
    let base;
    switch (r.pattern) {
      case 'prefix_orig': base = [r.prefix, orig].filter(Boolean).join(sep); break;
      case 'date_prefix_num': base = [date, r.prefix, num].filter(Boolean).join(sep); break;
      case 'prefix_fmt_num': base = [r.prefix, ext, num].filter(Boolean).join(sep); break;
      default: base = [r.prefix, num].filter(Boolean).join(sep);
    }
    return `${base}.${ext}`;
  }

  function refreshTable() {
    const tb = document.querySelector('#tbl tbody');
    tb.innerHTML = '';
    state.items.forEach((it, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${it.file.name}</td><td>${it.meta||'-'}</td><td>${UI.formatBytes(it.file.size)}</td>
        <td>${it.outName||'-'}</td><td>${it.status||'待機'}</td>
        <td>${it.blob?`<button type="button" class="btn" data-dl="${i}">保存</button>`:''}
        <button type="button" class="btn ghost" data-rm="${i}">削除</button></td>`;
      tb.appendChild(tr);
    });
    tb.querySelectorAll('[data-dl]').forEach((b) => b.onclick = () => {
      const it = state.items[+b.dataset.dl];
      UI.downloadBlob(it.blob, it.outName);
    });
    tb.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => {
      state.items.splice(+b.dataset.rm, 1); refreshTable(); document.getElementById('count').textContent = `${state.items.length} / 50`;
    });
  }

  function targetSize(img) {
    const w0 = img.naturalWidth, h0 = img.naturalHeight;
    const m = state.resizeMode;
    if (m === 'original') return { w: w0, h: h0 };
    if (m === 'x2' || m === 'ai2') return { w: w0*2, h: h0*2 };
    if (m === 'x4' || m === 'ai4') return { w: w0*4, h: h0*4 };
    const p = state.sizePx;
    if (m === 'width') return { w: p, h: Math.max(1, Math.round(h0 * (p / w0))) };
    if (m === 'height') return { w: Math.max(1, Math.round(w0 * (p / h0))), h: p };
    // fit
    const s = Math.min(p / w0, p / h0, 1);
    return { w: Math.max(1, Math.round(w0*s)), h: Math.max(1, Math.round(h0*s)) };
  }

  async function convertOne(it, index, used) {
    const img = await UI.loadImageFromFile(it.file);
    it.meta = `${img.naturalWidth}×${img.naturalHeight}`;
    const ai = state.resizeMode.startsWith('ai');
    if (ai && img.naturalWidth * img.naturalHeight > 4_200_000) {
      throw new Error('端末内高画質化は420万画素までです。先に小さくしてください。');
    }
    const { w, h } = targetSize(img);
    if (w > 12000 || h > 12000) throw new Error('1辺は12,000px以内にしてください。');
    if (w * h > 67_200_000) throw new Error('拡大後の画素数上限（6,720万）を超えます。');
    UI.assertCanvasSafe(w, h);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    if (ai) {
      // モデル未同梱時は高品質スムーズ拡大＋注記
      it.status = '高画質化（スムーズ拡大フォールバック）';
    }
    let mime = state.outFmt;
    if (mime === 'keep') {
      mime = it.file.type || 'image/png';
      if (/heic|heif/i.test(it.file.name) || /heic|heif/i.test(mime)) mime = 'image/jpeg';
      if (mime === 'image/gif') mime = 'image/png'; // still frame export as png when keep+gif decoded as still
    }
    if (mime === 'image/gif') mime = 'image/png'; // canvas gif encode not native; export png
    const blob = await UI.canvasToBlob(canvas, mime, 0.92);
    const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
    let name = buildName(it, index, ext);
    name = UI.uniqueName(name, used);
    it.outName = name;
    it.blob = blob;
    it.status = it.status || '完了';
  }

  async function run() {
    syncSettings();
    applyNames();
    state.abort = false;
    const used = new Set();
    let done = 0;
    for (let i = 0; i < state.items.length; i++) {
      if (state.abort) break;
      const it = state.items[i];
      it.status = '処理中';
      refreshTable();
      try {
        await convertOne(it, i, used);
        done++;
      } catch (e) {
        it.status = '失敗: ' + (e.message || e);
      }
      refreshTable();
      document.getElementById('status').textContent = `進捗 ${i+1}/${state.items.length}`;
    }
    document.getElementById('zip').disabled = !state.items.some((x) => x.blob);
    document.getElementById('status').textContent = state.abort ? `中止（完了 ${done}）` : `完了 ${done} 件`;
  }

  function applyNames() {
    syncSettings();
    const used = new Set();
    state.items.forEach((it, i) => {
      const extGuess = 'png';
      it.outName = UI.uniqueName(buildName(it, i, extGuess), used);
    });
    refreshTable();
  }

  function wire() {
    const dz = document.getElementById('dz');
    UI.setupDropzone(dz, { onFiles: addFiles });
    document.getElementById('pick').onclick = () => dz.querySelector('input').click();
    document.getElementById('preset').onchange = (e) => { document.getElementById('sizePx').value = e.target.value; };
    document.getElementById('applyName').onclick = applyNames;
    document.getElementById('run').onclick = run;
    document.getElementById('abort').onclick = () => { state.abort = true; };
    document.getElementById('zip').onclick = async () => {
      const files = state.items.filter((x)=>x.blob).map((x)=>({name:x.outName, blob:x.blob}));
      await UI.zipAndDownload(files, 'converted.zip');
    };
  }

  function addFiles(files) {
    for (const f of files) {
      if (state.items.length >= 50) break;
      state.items.push({ file: f, status: '待機' });
    }
    document.getElementById('count').textContent = `${state.items.length} / 50`;
    applyNames();
  }

  render();
})();
