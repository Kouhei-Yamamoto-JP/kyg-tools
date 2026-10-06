(function (global) {
  const NAV = [
    { href: '/image-workbench/', label: '形式とサイズ' },
    { href: '/image-slim/', label: '軽量化' },
    { href: '/mark-images/', label: '透かしを重ねる' },
    { href: '/image-tiles/', label: '切り分け' },
    { href: '/photo-metadata/', label: '撮影データを見る' },
    { href: '/clip-gif/', label: 'GIFを作る' },
    { href: '/post-panels/', label: '連続画像を作る' },
    { href: '/post-panels-space/', label: '余白つき2枚' },
  ];

  function currentPath() {
    let p = location.pathname;
    if (!p.endsWith('/')) {
      const i = p.lastIndexOf('/');
      p = p.slice(0, i + 1) || '/';
    }
    return p;
  }

  function mountNav(selector) {
    const host = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!host) return;
    const nav = document.createElement('nav');
    nav.className = 'tool-nav';
    nav.setAttribute('aria-label', '画像・動画ツール');
    const cur = currentPath();
    NAV.forEach((item) => {
      const a = document.createElement('a');
      a.href = item.href;
      a.textContent = item.label;
      if (cur === item.href || cur.startsWith(item.href)) a.setAttribute('aria-current', 'page');
      nav.appendChild(a);
    });
    host.replaceWith(nav);
  }

  function ensureToastHost() {
    let host = document.querySelector('.toast-host');
    if (!host) {
      host = document.createElement('div');
      host.className = 'toast-host';
      host.setAttribute('aria-live', 'polite');
      document.body.appendChild(host);
    }
    return host;
  }

  function toast(message, type = '') {
    const host = ensureToastHost();
    const el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.textContent = message;
    host.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  function formatBytes(n) {
    if (!Number.isFinite(n)) return '-';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function canvasPixelLimit() {
    return isIOS() ? 16_000_000 : 67_200_000;
  }

  function assertCanvasSafe(w, h) {
    const px = w * h;
    const limit = canvasPixelLimit();
    if (px > limit) {
      throw new Error(
        isIOS()
          ? 'iOSブラウザの描画上限を超えるため処理できません。PC環境でお試しください。'
          : `画素数上限（${limit.toLocaleString()}）を超えています。`
      );
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  async function zipAndDownload(files, zipName) {
    if (!global.JSZip) throw new Error('ZIPライブラリを読み込めませんでした。');
    const zip = new JSZip();
    const used = new Map();
    for (const f of files) {
      let name = f.name;
      const base = name.replace(/(\.[^.]+)?$/, '');
      const ext = (name.match(/(\.[^.]+)$/) || [''])[0];
      let n = used.get(name) || 0;
      if (n > 0) {
        name = `${base}_(${n})${ext}`;
      }
      used.set(f.name, n + 1);
      zip.file(name, f.blob);
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(blob, zipName);
  }

  function uniqueName(name, existing) {
    if (!existing.has(name)) {
      existing.add(name);
      return name;
    }
    const m = name.match(/^(.*?)(\.[^.]+)?$/);
    const base = m[1];
    const ext = m[2] || '';
    let i = 1;
    let candidate;
    do {
      candidate = `${base}_(${i})${ext}`;
      i += 1;
    } while (existing.has(candidate));
    existing.add(candidate);
    return candidate;
  }

  function setupDropzone(el, { onFiles, acceptDir = false } = {}) {
    if (!el) return;
    const input = el.querySelector('input[type="file"]');
    const open = () => input && input.click();
    el.addEventListener('click', (e) => {
      if (e.target.closest('button, a, label')) return;
      open();
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    });
    el.setAttribute('tabindex', '0');
    el.setAttribute('role', 'button');
    ;['dragenter', 'dragover'].forEach((ev) => {
      el.addEventListener(ev, (e) => {
        e.preventDefault();
        el.classList.add('dragover');
      });
    });
    ;['dragleave', 'drop'].forEach((ev) => {
      el.addEventListener(ev, (e) => {
        e.preventDefault();
        el.classList.remove('dragover');
      });
    });
    el.addEventListener('drop', (e) => {
      const files = [...(e.dataTransfer?.files || [])];
      if (files.length && onFiles) onFiles(files);
    });
    if (input) {
      if (acceptDir) input.setAttribute('webkitdirectory', '');
      input.addEventListener('change', () => {
        const files = [...(input.files || [])];
        if (files.length && onFiles) onFiles(files);
        input.value = '';
      });
    }
  }

  function imageFromBlob(blob, name = '') {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        img.sourceBlob = blob;
        img.sourceName = name;
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('画像を読み込めませんでした: ' + name));
      };
      img.src = url;
    });
  }

  let heicDecoderPromise;
  function loadHeicDecoder() {
    if (!heicDecoderPromise) heicDecoderPromise = new Promise((resolve, reject) => {
      if (global.heic2any) return resolve(global.heic2any);
      const script = document.createElement('script');
      script.src = '/assets/image-suite/vendor/heic2any.min.js';
      script.onload = () => global.heic2any ? resolve(global.heic2any) : reject(new Error('HEICデコーダを読み込めませんでした。'));
      script.onerror = () => reject(new Error('HEICデコーダを読み込めませんでした。'));
      document.head.appendChild(script);
    });
    return heicDecoderPromise;
  }

  async function loadImageFromFile(file) {
    const isHeic = /\.(heic|heif)$/i.test(file.name) || /image\/(heic|heif|heic-sequence|heif-sequence)/i.test(file.type);
    if (!isHeic) return imageFromBlob(file, file.name);
    try { return await imageFromBlob(file, file.name); } catch (_) { /* use decoder fallback */ }
    const decode = await loadHeicDecoder();
    const converted = await decode({ blob: file, toType: 'image/png' });
    const blob = Array.isArray(converted) ? converted[0] : converted;
    return imageFromBlob(blob, file.name);
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('書き出しに失敗しました。'))), type, quality);
    });
  }

  global.KygImageSuiteUI = {
    NAV,
    mountNav,
    toast,
    formatBytes,
    isIOS,
    canvasPixelLimit,
    assertCanvasSafe,
    downloadBlob,
    zipAndDownload,
    uniqueName,
    setupDropzone,
    loadImageFromFile,
    isHeicFile: (file) => /\.(heic|heif)$/i.test(file.name) || /image\/(heic|heif)/i.test(file.type),
    canvasToBlob,
  };

  document.addEventListener('DOMContentLoaded', () => {
    const slot = document.querySelector('[data-tool-nav]');
    if (slot) mountNav(slot);
  });
})(window);
