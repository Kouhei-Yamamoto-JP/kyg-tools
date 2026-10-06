(() => {
  const UI = window.KygImageSuiteUI;
  const app = document.getElementById('app');
  const state = { items: [], filter: '' };

  function render() {
    app.innerHTML = `
      <section class="panel">
        <div class="dropzone" id="dz"><p>写真を追加（最大50枚・合計1GB）。初回の解析エンジン読込に時間がかかることがあります。</p>
          <input type="file" accept="image/*,.cr2,.cr3,.nef,.arw,.raf,.dng,.tif,.tiff" multiple hidden>
          <button type="button" class="btn" id="pick">ファイルを選ぶ</button>
          <button type="button" class="btn ghost" id="pickDir">フォルダー</button></div>
        <p class="hint">位置情報は外部地図へ送りません。画面を離れると読み取り結果は破棄されます。</p>
        <p class="hint" id="count">0 / 50</p>
      </section>
      <section class="panel">
        <div class="field"><label>検索</label><input type="search" id="q" placeholder="タグ名・値で絞り込み"></div>
        <div class="actions">
          <button class="btn" id="json" type="button" disabled>すべてJSON保存</button>
          <button class="btn" id="csv" type="button" disabled>すべてCSV保存</button>
          <button class="btn ghost" id="clear" type="button">一覧をクリア</button>
        </div>
        <div id="list"></div>
      </section>`;
    wire();
  }

  function flatten(obj, prefix = '', out = {}) {
    if (!obj || typeof obj !== 'object') return out;
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) flatten(v, key, out);
      else out[key] = v instanceof Date ? v.toISOString() : Array.isArray(v) ? v.join(', ') : v;
    }
    return out;
  }

  async function parseFile(file) {
    if (!window.exifr) throw new Error('Exifエンジンを読み込めませんでした');
    const raw = await exifr.parse(file, { tiff: true, xmp: true, icc: false, iptc: true, gps: true, reviveValues: true }).catch(() => null);
    return flatten(raw || {});
  }

  function renderList() {
    const host = document.getElementById('list');
    const q = state.filter.trim().toLowerCase();
    host.innerHTML = '';
    state.items.forEach((it, idx) => {
      let entries = Object.entries(it.tags);
      if (q) entries = entries.filter(([k,v]) => `${k} ${v}`.toLowerCase().includes(q));
      const box = document.createElement('article');
      box.className = 'panel';
      box.innerHTML = `<h3>${it.file.name}</h3>
        <p class="hint">${UI.formatBytes(it.file.size)} · タグ ${Object.keys(it.tags).length} 件</p>
        <div class="table-wrap"><table class="suite-table"><thead><tr><th>項目</th><th>値</th><th></th></tr></thead><tbody>
        ${entries.slice(0, 200).map(([k,v]) => `<tr><td>${k}</td><td class="mono">${String(v)}</td>
          <td><button type="button" class="btn ghost" data-copy="${idx}|${k}">コピー</button></td></tr>`).join('') || '<tr><td colspan="3">該当なし／Exifなし</td></tr>'}
        </tbody></table></div>`;
      host.appendChild(box);
    });
    host.querySelectorAll('[data-copy]').forEach((b) => b.onclick = async () => {
      const [idx, key] = b.dataset.copy.split('|');
      const val = String(state.items[+idx].tags[key] ?? '');
      await navigator.clipboard.writeText(val);
      UI.toast('コピーしました', 'ok');
    });
    const en = state.items.length > 0;
    document.getElementById('json').disabled = !en;
    document.getElementById('csv').disabled = !en;
  }

  function downloadJSON() {
    const data = state.items.map((it) => ({ name: it.file.name, tags: it.tags }));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    UI.downloadBlob(blob, 'photo-metadata.json');
  }

  function downloadCSV() {
    const keys = new Set();
    state.items.forEach((it) => Object.keys(it.tags).forEach((k) => keys.add(k)));
    const cols = ['file', ...[...keys].sort()];
    const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const lines = [cols.join(',')];
    state.items.forEach((it) => {
      lines.push(cols.map((c) => esc(c === 'file' ? it.file.name : it.tags[c])).join(','));
    });
    // UTF-8 BOM for Excel
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    UI.downloadBlob(blob, 'photo-metadata.csv');
  }

  function wire() {
    const dz = document.getElementById('dz');
    UI.setupDropzone(dz, { onFiles: addFiles });
    document.getElementById('pick').onclick = () => dz.querySelector('input').click();
    document.getElementById('pickDir').onclick = () => {
      const i=document.createElement('input'); i.type='file'; i.webkitdirectory=true; i.multiple=true;
      i.onchange=()=>addFiles([...i.files]); i.click();
    };
    document.addEventListener('paste', (e) => {
      const fs=[...(e.clipboardData?.files||[])]; if(fs.length) addFiles(fs);
    });
    document.getElementById('q').oninput = (e) => { state.filter = e.target.value; renderList(); };
    document.getElementById('json').onclick = downloadJSON;
    document.getElementById('csv').onclick = downloadCSV;
    document.getElementById('clear').onclick = () => { state.items = []; renderList(); document.getElementById('count').textContent='0 / 50'; };
    window.addEventListener('pagehide', () => { state.items = []; });
  }

  async function addFiles(files) {
    let sum = state.items.reduce((a,b)=>a+b.file.size,0);
    for (const f of files) {
      if (state.items.length >= 50) break;
      if (f.size > 200*1024*1024) { UI.toast('1ファイル200MBまで','danger'); continue; }
      if (sum + f.size > 1024*1024*1024) { UI.toast('合計1GBまで','danger'); break; }
      try {
        const tags = await parseFile(f);
        state.items.push({ file: f, tags });
        sum += f.size;
      } catch (e) {
        UI.toast(e.message || String(e), 'danger');
      }
    }
    document.getElementById('count').textContent = `${state.items.length} / 50`;
    renderList();
  }

  render();
})();
