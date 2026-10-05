(() => {
  const UI = window.KygImageSuiteUI;
  const app = document.getElementById('app');
  const state = {
    file: null, url: null,
    width: 480, fps: 10, start: 0, dur: 8, quality: 12,
    auto4mb: true, abort: false, blob: null,
  };

  function render() {
    app.innerHTML = `
      <section class="panel">
        <div class="dropzone" id="dz"><p>動画を1本追加（MP4/WebM/MOV・最大200MB）</p>
          <input type="file" accept="video/*,.mp4,.webm,.mov" hidden>
          <button type="button" class="btn" id="pick">ファイルを選ぶ</button></div>
      </section>
      <section class="panel">
        <video id="vid" controls style="width:100%;max-height:360px;background:#000;border-radius:8px"></video>
        <div class="field-row">
          <div class="field"><label>最大幅 (80〜1280)</label><input type="number" id="width" min="80" max="1280" value="480"></div>
          <div class="field"><label>FPS (1〜30)</label><input type="number" id="fps" min="1" max="30" value="10"></div>
          <div class="field"><label>開始(秒)</label><input type="number" id="start" min="0" step="0.1" value="0"></div>
          <div class="field"><label>長さ(秒)</label><input type="number" id="dur" min="0.1" max="60" step="0.1" value="8"></div>
          <div class="field"><label>品質 1〜30（小さいほど色が多い）</label><input type="number" id="quality" min="1" max="30" value="12"></div>
        </div>
        <label><input type="checkbox" id="auto4" checked> 4MB以下を目標に自動調整</label>
        <div class="actions">
          <button class="btn primary" id="run" type="button">GIFを作成</button>
          <button class="btn danger" id="abort" type="button">中止</button>
          <button class="btn" id="save" type="button" disabled>GIFを保存</button>
        </div>
        <div class="status-bar" id="status">待機中</div>
        <div class="preview-box" id="prev"></div>
      </section>`;
    wire();
  }

  function qualityToColors(q) {
    // 1 => 256, 30 => 32
    const t = (q - 1) / 29;
    return Math.round(256 - t * (256 - 32));
  }

  function seek(video, t) {
    return new Promise((resolve, reject) => {
      const onSeeked = () => { video.removeEventListener('seeked', onSeeked); resolve(); };
      video.addEventListener('seeked', onSeeked);
      video.onerror = () => reject(new Error('動画のシークに失敗しました'));
      video.currentTime = Math.min(Math.max(0, t), video.duration || t);
    });
  }

  async function encodeOnce(opts) {
    const { GIFEncoder, quantize, applyPalette } = window.GifEnc || {};
    if (!GIFEncoder) throw new Error('GIFエンコーダを読み込めませんでした');
    const video = document.getElementById('vid');
    const start = opts.start;
    const dur = opts.dur;
    const fps = opts.fps;
    const maxW = opts.width;
    const colors = qualityToColors(opts.quality);
    const end = Math.min(video.duration || start + dur, start + dur);
    const frames = [];
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let t = start;
    const dt = 1 / fps;
    while (t <= end + 1e-6) {
      if (state.abort) throw new Error('中止しました');
      await seek(video, t);
      const vw = video.videoWidth, vh = video.videoHeight;
      if (!vw) throw new Error('このブラウザでは再生できない動画です');
      if (Math.max(vw, vh) > 8192 || vw * vh > 33_600_000) throw new Error('元動画の寸法上限を超えています');
      const scale = Math.min(1, maxW / vw);
      const w = Math.max(1, Math.round(vw * scale));
      const h = Math.max(1, Math.round(vh * scale));
      UI.assertCanvasSafe(w, h);
      canvas.width = w; canvas.height = h;
      ctx.drawImage(video, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      frames.push({ w, h, data: new Uint8ClampedArray(data) });
      if (frames.length > 240) break;
      t += dt;
    }
    // pixel budget
    const px = frames.reduce((a, f) => a + f.w * f.h, 0);
    if (px > 60_000_000) throw new Error('出力合計画素の上限を超えます。FPSや長さを下げてください。');
    const gif = GIFEncoder();
    const delay = Math.round(1000 / fps);
    for (const f of frames) {
      if (state.abort) throw new Error('中止しました');
      const palette = quantize(f.data, colors);
      const index = applyPalette(f.data, palette);
      gif.writeFrame(index, f.w, f.h, { palette, delay, repeat: 0 });
    }
    gif.finish();
    return new Blob([gif.bytes()], { type: 'image/gif' });
  }

  async function run() {
    if (!state.file) return UI.toast('動画を追加してください', 'danger');
    state.abort = false;
    state.width = +document.getElementById('width').value;
    state.fps = +document.getElementById('fps').value;
    state.start = +document.getElementById('start').value;
    state.dur = +document.getElementById('dur').value;
    state.quality = +document.getElementById('quality').value;
    state.auto4mb = document.getElementById('auto4').checked;
    let opts = { ...state };
    let blob = null;
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        document.getElementById('status').textContent = `作成中…（試行 ${attempt + 1}）幅${opts.width} FPS${opts.fps} 品質${opts.quality}`;
        blob = await encodeOnce(opts);
        if (!state.auto4mb || blob.size <= 4 * 1024 * 1024) break;
        // degrade
        opts.width = Math.max(80, Math.round(opts.width * 0.85));
        opts.fps = Math.max(1, opts.fps - 2);
        opts.quality = Math.min(30, opts.quality + 4);
      }
      state.blob = blob;
      const prev = document.getElementById('prev');
      const url = URL.createObjectURL(blob);
      prev.innerHTML = `<figure><img src="${url}" alt="GIFプレビュー"><figcaption>${UI.formatBytes(blob.size)}</figcaption></figure>`;
      document.getElementById('save').disabled = false;
      document.getElementById('status').textContent = `完了 ${UI.formatBytes(blob.size)}（無音・ループ）`;
    } catch (e) {
      document.getElementById('status').textContent = e.message || String(e);
      UI.toast(e.message || String(e), 'danger');
    }
  }

  function wire() {
    const dz = document.getElementById('dz');
    UI.setupDropzone(dz, { onFiles: addFile });
    document.getElementById('pick').onclick = () => dz.querySelector('input').click();
    document.addEventListener('paste', (e) => {
      const f = [...(e.clipboardData?.files||[])].find((x)=>x.type.startsWith('video/'));
      if (f) addFile([f]);
    });
    document.getElementById('run').onclick = run;
    document.getElementById('abort').onclick = () => { state.abort = true; };
    document.getElementById('save').onclick = () => {
      if (state.blob) UI.downloadBlob(state.blob, (state.file?.name || 'clip').replace(/\.[^.]+$/, '') + '.gif');
    };
  }

  function addFile(files) {
    const f = files[0]; if (!f) return;
    if (f.size > 200 * 1024 * 1024) return UI.toast('200MBまでです', 'danger');
    if (state.url) URL.revokeObjectURL(state.url);
    state.file = f;
    state.url = URL.createObjectURL(f);
    const vid = document.getElementById('vid');
    vid.src = state.url;
  }

  render();
})();
