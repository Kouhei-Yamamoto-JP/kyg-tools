(() => {
  const $ = (s) => document.querySelector(s),
    ui = KygImageSuiteUI;
  let file = null,
    engine = null,
    stopped = false;
  const fmt = (n) => ui.formatBytes(n);
  async function check(f) {
    if (!f) return;
    if (f.size > 100 * 1024 * 1024)
      return ui.toast("動画は100MB以内にしてください。", "danger");
    file = f;
    const v = $("#preview");
    v.src = URL.createObjectURL(f);
    await new Promise((r) => (v.onloadedmetadata = r));
    if (v.duration > 900) {
      file = null;
      return ui.toast("動画は15分以内にしてください。", "danger");
    }
    if (
      v.videoWidth * v.videoHeight > 8.4e6 ||
      Math.max(v.videoWidth, v.videoHeight) > 4096
    ) {
      file = null;
      return ui.toast(
        "動画は840万画素、辺4,096px以内にしてください。",
        "danger",
      );
    }
    $("#start").disabled = false;
    $("#status").textContent =
      `${f.name} · ${v.videoWidth}×${v.videoHeight}px · ${Math.floor(v.duration / 60)}分${Math.floor(v.duration % 60)}秒 · ${fmt(f.size)}`;
  }
  $("#choose").onclick = () => $("#file").click();
  $("#file").onchange = (e) => check(e.target.files[0]);
  ui.setupDropzone($("#drop"), { onFiles: (fs) => check(fs[0]) });
  async function getEngine() {
    if (engine) return engine;
    $("#status").textContent =
      "初回エンジンを読み込んでいます（約25MB）。動画は送信しません。";
    const wrapperResponse = await fetch(
      "https://unpkg.com/@ffmpeg/ffmpeg@0.11.1/dist/ffmpeg.min.js",
    );
    if (!wrapperResponse.ok)
      throw Error("処理エンジンを取得できません。通信状態をご確認ください。");
    const wrapperUrl = URL.createObjectURL(
      new Blob([await wrapperResponse.arrayBuffer()], { type: "text/javascript" }),
    );
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = wrapperUrl;
      script.onload = resolve;
      script.onerror = () => reject(Error("動画変換用ラッパーを読み込めません。"));
      document.head.append(script);
    });
    const { createFFmpeg } = FFmpeg;
    const ff = createFFmpeg({
      log: true,
      mainName: "main",
      corePath: "https://unpkg.com/@ffmpeg/core-st@0.11.1/dist/ffmpeg-core.js",
      progress: ({ ratio }) => {
        $("#progress").value = ratio;
        $("#status").textContent =
          `動画を変換しています：${Math.round(ratio * 100)}%`;
      },
      logger: ({ message }) => {
        if (message.includes("error")) $("#status").textContent = message;
      },
    });
    await ff.load();
    engine = ff;
    return ff;
  }
  $("#start").onclick = async () => {
    if (!file) return;
    stopped = false;
    $("#start").disabled = true;
    $("#cancel").disabled = false;
    $("#progress").value = 0;
    const outName = "compressed.mp4",
      input =
        "source." +
        (file.name
          .split(".")
          .pop()
          .replace(/[^a-z0-9]/gi, "") || "mp4");
    let ff;
    const begun = Date.now();
    try {
      ff = await getEngine();
      ff.FS("writeFile", input, new Uint8Array(await file.arrayBuffer()));
      const v = $("#preview"),
        max = +$("#resolution").value,
        s = Math.min(1, max / Math.max(v.videoWidth, v.videoHeight)),
        w = Math.max(2, Math.floor((v.videoWidth * s) / 2) * 2),
        h = Math.max(2, Math.floor((v.videoHeight * s) / 2) * 2),
        args = [
          "-i",
          input,
          "-map",
          "0:v:0",
          "-vf",
          `scale=${w}:${h}:force_original_aspect_ratio=decrease,fps=30`,
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          $("#quality").value,
          "-pix_fmt",
          "yuv420p",
          "-movflags",
          "+faststart",
        ];
      if ($("#audio").checked)
        args.push("-map", "0:a:0?", "-c:a", "aac", "-b:a", "128k");
      else args.push("-an");
      args.push("-t", "900", outName);
      await ff.run(...args);
      if (stopped || Date.now() - begun > 900000)
        throw Error(
          stopped ? "中止しました。" : "15分を超えたため中止しました。",
        );
      const data = ff.FS("readFile", outName),
        blob = new Blob([data], { type: "video/mp4" });
      const url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download = "compressed.mp4";
      link.textContent = `MP4を保存（${fmt(blob.size)}）`;
      const player = document.createElement("video");
      player.controls = true;
      player.src = url;
      player.style = "max-width:100%;max-height:300px";
      $("#result").replaceChildren(
        document.createTextNode(
          `元 ${fmt(file.size)} → 出力 ${fmt(blob.size)} `,
        ),
        link,
        player,
      );
      $("#status").textContent = "変換が完了しました。";
    } catch (e) {
      $("#result").replaceChildren();
      $("#status").textContent =
        e.message ||
        "変換に失敗しました。対応ブラウザと通信状態をご確認ください。";
    } finally {
      if (ff)
        try {
          ff.FS("unlink", input);
          ff.FS("unlink", outName);
        } catch {}
      $("#start").disabled = false;
      $("#cancel").disabled = true;
    }
  };
  $("#cancel").onclick = () => {
    stopped = true;
    engine?.exit();
    engine = null;
    $("#status").textContent = "中止しました。未完成の出力は破棄します。";
    $("#result").replaceChildren();
  };
})();
