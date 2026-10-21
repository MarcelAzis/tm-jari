/* =====================================================
   Penghitung Jari - Teachable Machine (model gambar)
   Folder model: ./my_model/ (model.json, weights.bin, metadata.json)
   ===================================================== */

// ---------- Pengaturan ----------
const MODEL_URL = "./my_model/";   // lokasi folder model
const CAM_SIZE = 400;              // ukuran kanvas kamera (piksel)

// Emoji untuk tiap label (sesuaikan jika label modelmu berubah)
const EMOJI_BY_LABEL = {
  "3 Jari": "🤟",
  "5 Jari": "🖐️",
};

// ---------- Variabel status ----------
let model = null;          // model Teachable Machine
let webcam = null;         // objek webcam
let labels = [];           // daftar nama kelas
let running = false;       // apakah kamera/prediksi sedang jalan
let rafId = null;          // id requestAnimationFrame
let facingMode = "user";   // "user" = kamera depan, "environment" = kamera belakang
let mirror = true;         // cermin kamera
let threshold = 0.8;       // ambang keyakinan (0 - 1)

let lastStable = null;     // label pasti terakhir (untuk menghitung)
let counts = [];           // jumlah terdeteksi per kelas

// ---------- Ambil elemen HTML ----------
const $ = (id) => document.getElementById(id);

const el = {
  viewport: $("viewport"),
  container: $("webcam-container"),
  placeholder: $("placeholder"),
  statusText: $("status-text"),
  badge: $("badge"),
  badgeEmoji: $("badge-emoji"),
  badgeLabel: $("badge-label"),
  btnStart: $("btn-start"),
  btnStop: $("btn-stop"),
  btnSwitch: $("btn-switch"),
  result: $("result"),
  resultEmoji: $("result-emoji"),
  resultLabel: $("result-label"),
  resultSub: $("result-sub"),
  bars: $("label-container"),
  threshold: $("threshold"),
  thresholdValue: $("threshold-value"),
  mirror: $("mirror"),
  counts: $("counts"),
  btnReset: $("btn-reset"),
};

// ---------- Fungsi bantu tampilan ----------
function setStatus(text, isError = false) {
  el.statusText.textContent = text;
  el.placeholder.classList.toggle("error", isError);
}

function emojiFor(label) {
  return EMOJI_BY_LABEL[label] || "✋";
}

// Buat batang keyakinan & kartu hitungan sesuai jumlah kelas
function buildUI() {
  el.bars.innerHTML = "";
  el.counts.innerHTML = "";

  labels.forEach((name, i) => {
    el.bars.insertAdjacentHTML("beforeend", `
      <div class="bar-row">
        <div class="bar-head"><span>${name}</span><span id="pct-${i}">0%</span></div>
        <div class="bar-track"><div class="bar-fill" id="fill-${i}"></div></div>
      </div>
    `);

    el.counts.insertAdjacentHTML("beforeend", `
      <div class="count-card"><b id="count-${i}">0</b><span>${name}</span></div>
    `);
  });

  counts = labels.map(() => 0);
}

function showIdle(title, sub) {
  el.result.dataset.state = "idle";
  el.resultEmoji.textContent = "✋";
  el.resultLabel.textContent = title;
  el.resultSub.textContent = sub;
  el.viewport.removeAttribute("data-class");
  el.badge.hidden = true;
}

// ---------- Memuat model (hanya sekali) ----------
async function loadModel() {
  if (model) return;
  setStatus("Memuat model...");
  model = await tmImage.load(MODEL_URL + "model.json", MODEL_URL + "metadata.json");
  labels = model.getClassLabels();
  buildUI();
}

// ---------- Menyalakan kamera ----------
async function startCamera() {
  el.btnStart.disabled = true;

  try {
    await loadModel();

    setStatus("Meminta izin kamera...");
    // Parameter ketiga = flip (cermin)
    webcam = new tmImage.Webcam(CAM_SIZE, CAM_SIZE, mirror);
    await webcam.setup({ facingMode });   // minta izin kamera
    await webcam.play();

    el.container.innerHTML = "";
    el.container.appendChild(webcam.canvas);
    el.placeholder.hidden = true;

    running = true;
    el.btnStop.disabled = false;
    el.btnSwitch.disabled = false;
    showIdle("Mencari tangan...", "Angkat tanganmu ke depan kamera");

    rafId = requestAnimationFrame(loop);
  } catch (err) {
    console.error(err);
    handleError(err);
    el.btnStart.disabled = false;
  }
}

// ---------- Mematikan kamera ----------
async function stopCamera() {
  running = false;
  cancelAnimationFrame(rafId);

  if (webcam) {
    try { await webcam.stop(); } catch (e) { /* abaikan */ }
    webcam = null;
  }

  el.container.innerHTML = "";
  el.placeholder.hidden = false;
  setStatus("Kamera belum menyala");
  showIdle("Kamera mati", "Tekan \"Nyalakan kamera\" untuk mulai");

  el.btnStart.disabled = false;
  el.btnStop.disabled = true;
  el.btnSwitch.disabled = true;
  lastStable = null;
}

// Restart kamera (dipakai saat ganti kamera / mirror)
async function restartCamera() {
  await stopCamera();
  await startCamera();
}

// ---------- Pesan error yang mudah dipahami ----------
function handleError(err) {
  let msg = "Terjadi kesalahan: " + (err && err.message ? err.message : err);

  if (err && err.name === "NotAllowedError") {
    msg = "Izin kamera ditolak. Klik ikon gembok di address bar, izinkan kamera, lalu coba lagi.";
  } else if (err && err.name === "NotFoundError") {
    msg = "Kamera tidak ditemukan. Pastikan perangkat punya kamera yang terhubung.";
  } else if (err && err.name === "NotReadableError") {
    msg = "Kamera sedang dipakai aplikasi lain. Tutup aplikasi itu lalu coba lagi.";
  } else if (location.protocol === "file:") {
    msg = "Halaman dibuka lewat file://. Jalankan dengan Live Server di VS Code (klik kanan index.html > Open with Live Server).";
  } else if (String(err).includes("Failed to fetch") || String(err).includes("404")) {
    msg = "File model tidak ditemukan. Pastikan folder my_model berisi model.json, weights.bin, dan metadata.json.";
  }

  el.placeholder.hidden = false;
  setStatus(msg, true);
}

// ---------- Perulangan prediksi ----------
async function loop() {
  if (!running) return;
  webcam.update();       // ambil frame terbaru
  await predict();
  rafId = requestAnimationFrame(loop);
}

async function predict() {
  const prediction = await model.predict(webcam.canvas);

  // Perbarui batang keyakinan
  let best = 0;
  prediction.forEach((p, i) => {
    const pct = Math.round(p.probability * 100);
    $("pct-" + i).textContent = pct + "%";
    $("fill-" + i).style.width = pct + "%";
    if (p.probability > prediction[best].probability) best = i;
  });

  const top = prediction[best];

  if (top.probability >= threshold) {
    // Hasil pasti
    const name = top.className;
    el.result.dataset.state = "c" + best;
    el.viewport.dataset.class = best;
    el.resultEmoji.textContent = emojiFor(name);
    el.resultLabel.textContent = name;
    el.resultSub.textContent = "Keyakinan " + Math.round(top.probability * 100) + "%";

    el.badge.hidden = false;
    el.badgeEmoji.textContent = emojiFor(name);
    el.badgeLabel.textContent = name;

    // Hitung hanya saat hasil berganti (bukan tiap frame)
    if (lastStable !== best) {
      counts[best]++;
      $("count-" + best).textContent = counts[best];
      lastStable = best;
    }
  } else {
    // Belum cukup yakin
    showIdle("Belum yakin", "Dekatkan tangan dan pastikan cahaya cukup");
    lastStable = null;
  }
}

// ---------- Event tombol & pengaturan ----------
el.btnStart.addEventListener("click", startCamera);
el.btnStop.addEventListener("click", stopCamera);

el.btnSwitch.addEventListener("click", () => {
  facingMode = facingMode === "user" ? "environment" : "user";
  restartCamera();
});

el.threshold.addEventListener("input", () => {
  threshold = Number(el.threshold.value) / 100;
  el.thresholdValue.textContent = el.threshold.value + "%";
});

el.mirror.addEventListener("change", () => {
  mirror = el.mirror.checked;
  if (running) restartCamera();   // flip hanya bisa diatur saat webcam dibuat
});

el.btnReset.addEventListener("click", () => {
  counts = counts.map(() => 0);
  counts.forEach((_, i) => { $("count-" + i).textContent = 0; });
  lastStable = null;
});

// Matikan kamera saat tab ditutup
window.addEventListener("beforeunload", () => { if (webcam) webcam.stop(); });

// Tampilan awal
showIdle("Menunggu kamera", "Hasil akan muncul di sini");
