(() => {
  const UI = window.KygImageSuiteUI;
  const app = document.getElementById('app');
  const state = { items: [], filter: '', stopped: false };
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function render() {
    app.innerHTML = `
      <section class="panel">
        <h2>1. 写真を追加</h2>
        <div class="dropzone" id="dz"><p>写真を追加（最大50枚・合計1GB）。初回の解析エンジン読込に時間がかかることがあります。</p>
          <input type="file" accept="image/*,.heic,.heif,.cr2,.cr3,.nef,.arw,.raf,.dng,.tif,.tiff" multiple hidden>
          <button type="button" class="btn" id="pick">ファイルを選ぶ</button>
          <button type="button" class="btn ghost" id="pickDir">フォルダー</button></div>
        <p class="hint">位置情報は外部地図へ送りません。画面を離れると読み取り結果は破棄されます。</p>
        <p class="hint" id="count">0 / 50</p>
      </section>
      <section class="panel">
        <h2>2. 情報を確認して保存</h2>
        <div class="field"><label>検索</label><input type="search" id="q" placeholder="タグ名・値で絞り込み"></div>
        <div class="actions">
          <label><input type="checkbox" id="selectAll"> すべて選択</label>
          <button class="btn" id="json" type="button" disabled>選択した画像をJSON保存</button>
          <button class="btn" id="csv" type="button" disabled>選択した画像をCSV保存</button>
          <button class="btn danger" id="stop" type="button">読み取りを中止</button>
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
      const groups = { カメラ: /make|model|body|camera|serial/i, 撮影日時: /date|time|subsec/i, 露出: /exposure|iso|fnumber|aperture|shutter|flash|metering/i, レンズ: /lens|focal|focus/i, 位置: /gps|latitude|longitude|altitude/i };
      const grouped = new Map();
      for (const [k,v] of entries) { const label=Object.entries(groups).find(([,re])=>re.test(k))?.[0]||'その他'; if(!grouped.has(label))grouped.set(label,[]); grouped.get(label).push([k,v]); }
      const preview = it.previewUrl || (it.previewUrl=URL.createObjectURL(it.file));
      const rowHtml = (k,v) => `<tr><td>${esc(k)}</td><td class="mono">${esc(v)}</td><td><button type="button" class="btn ghost" data-copy="${idx}|${esc(k)}">コピー</button>${/GPSLatitude|GPSLongitude/i.test(k)?` <button type="button" class="btn ghost" data-gps="${idx}|${esc(k)}">位置をコピー</button>`:''}</td></tr>`;
      box.innerHTML = `<label><input type="checkbox" data-select="${idx}" ${it.selected?'checked':''}> この写真を保存対象にする</label>
        <h3>${esc(it.file.name)}</h3><p class="hint">${UI.formatBytes(it.file.size)} · タグ ${Object.keys(it.tags).length} 件 · ${esc(it.status||'完了')}</p>
        <img class="metadata-preview" src="${preview}" alt="写真のプレビュー">
        ${it.status==='失敗'?`<button type="button" class="btn" data-retry="${idx}">もう一度読む</button>`:''}
        ${[...grouped].map(([name,rows])=>`<details open><summary>${name}（${rows.length}）</summary><div class="table-wrap"><table class="suite-table"><thead><tr><th>項目</th><th>値</th><th>操作</th></tr></thead><tbody>${rows.map(([k,v])=>rowHtml(k,v)).join('')}</tbody></table></div></details>`).join('') || '<p>撮影データは見つかりませんでした。</p>'}`;
      host.appendChild(box);
    });
    host.querySelectorAll('[data-copy]').forEach((b) => b.onclick = async () => {
      const [idx, key] = b.dataset.copy.split('|');
      const val = String(state.items[+idx].tags[key] ?? '');
      await navigator.clipboard.writeText(val);
      UI.toast('コピーしました', 'ok');
    });
    host.querySelectorAll('[data-gps]').forEach((b)=>b.onclick=async()=>{const [i,key]=b.dataset.gps.split('|');await navigator.clipboard.writeText(String(state.items[+i].tags[key]??''));UI.toast('位置の値をコピーしました（地図は開きません）。','ok');});
    host.querySelectorAll('[data-select]').forEach(b=>b.onchange=()=>{state.items[+b.dataset.select].selected=b.checked;const en=state.items.some(it=>it.selected);document.getElementById('json').disabled=document.getElementById('csv').disabled=!en;});
    host.querySelectorAll('[data-retry]').forEach(b=>b.onclick=()=>retry(+b.dataset.retry));
    const en = state.items.some(it=>it.selected);
    document.getElementById('json').disabled = !en;
    document.getElementById('csv').disabled = !en;
  }

  function selectedItems() { return state.items.filter(it=>it.selected); }
  function downloadJSON() {
    const data = selectedItems().map((it) => ({ name: it.file.name, tags: it.tags }));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    UI.downloadBlob(blob, 'photo-metadata.json');
  }

  function downloadCSV() {
    const keys = new Set();
    selectedItems().forEach((it) => Object.keys(it.tags).forEach((k) => keys.add(k)));
    const cols = ['file', ...[...keys].sort()];
    const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const lines = [cols.join(',')];
    selectedItems().forEach((it) => {
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
    document.getElementById('clear').onclick = () => { state.items.forEach(it=>it.previewUrl&&URL.revokeObjectURL(it.previewUrl)); state.items = []; renderList(); document.getElementById('count').textContent='0 / 50'; };
    document.getElementById('selectAll').onchange=e=>{state.items.forEach(it=>it.selected=e.target.checked);renderList();};
    document.getElementById('stop').onclick=()=>{state.stopped=true;UI.toast('現在の読取後に中止します。');};
    window.addEventListener('pagehide', () => { state.items.forEach(it=>it.previewUrl&&URL.revokeObjectURL(it.previewUrl)); state.items = []; });
  }

  async function addFiles(files) {
    state.stopped=false;
    let sum = state.items.reduce((a,b)=>a+b.file.size,0);
    for (const f of files) {
      if (state.items.length >= 50) break;
      if (f.size > 200*1024*1024) { UI.toast('1ファイル200MBまで','danger'); continue; }
      if (sum + f.size > 1024*1024*1024) { UI.toast('合計1GBまで','danger'); break; }
      if(state.stopped)break;
      try {
        const tags = await parseFile(f);
        state.items.push({ file: f, tags, selected:true, status:Object.keys(tags).length?'完了':'撮影データなし' });
        sum += f.size;
      } catch (e) {
        state.items.push({file:f,tags:{},selected:true,status:'失敗'});UI.toast(e.message || String(e), 'danger');
      }
    }
    document.getElementById('count').textContent = `${state.items.length} / 50`;
    renderList();
  }

  async function retry(index){const it=state.items[index];it.status='読取中';renderList();try{it.tags=await parseFile(it.file);it.status=Object.keys(it.tags).length?'完了':'撮影データなし';}catch{it.status='失敗';}renderList();}

  render();
})();
