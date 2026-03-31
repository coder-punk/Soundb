const STORAGE_KEY = 'soundboard-recordings-v1';
const CARD_COLORS = ['purple', 'green', 'olive', 'blue', 'brown', 'teal', 'rose'];

const soundNameInput = document.getElementById('soundName');
const recordBtn     = document.getElementById('recordBtn');
const stopBtn       = document.getElementById('stopBtn');
const clearAllBtn   = document.getElementById('clearAllBtn');
const micStatus     = document.getElementById('micStatus');
const countStatus   = document.getElementById('countStatus');
const soundGrid     = document.getElementById('soundGrid');
const emptyState    = document.getElementById('emptyState');
const template      = document.getElementById('soundCardTemplate');
const installBtn    = document.getElementById('installBtn');

let mediaRecorder  = null;
let currentStream  = null;
let currentChunks  = [];
let deferredPrompt = null;
let playingAudio   = null;
let playingCard    = null;

/* ── Storage helpers ──────────────────────────── */

function loadSounds() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}

function saveSounds(sounds) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sounds));
}

/* ── Utilities ────────────────────────────────── */

function formatTime(secs) {
  if (!isFinite(secs) || isNaN(secs)) return '00:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function approximateSizeFromDataUrl(dataUrl) {
  const base64Part = dataUrl.split(',')[1] || '';
  return Math.round((base64Part.length * 3) / 4 / 1024);
}

function bytesToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror   = reject;
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(',');
  const mime  = /data:(.*?);base64/.exec(header)?.[1] || 'audio/webm';
  const bytes = atob(base64);
  const array = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) array[i] = bytes.charCodeAt(i);
  return new Blob([array], { type: mime });
}

/* ── Playback control ─────────────────────────── */

function stopAllPlayback() {
  if (playingAudio) {
    playingAudio.pause();
    playingAudio.currentTime = 0;
    playingAudio = null;
  }
  if (playingCard) {
    playingCard.classList.remove('is-playing');
    playingCard = null;
  }
}

function updateCountLabel() {
  const n = loadSounds().length;
  countStatus.textContent = `${n} sound${n === 1 ? '' : 's'}`;
}

/* ── Render ───────────────────────────────────── */

function renderSounds() {
  const sounds = loadSounds();
  soundGrid.innerHTML = '';
  emptyState.style.display = sounds.length ? 'none' : 'block';
  updateCountLabel();

  sounds.forEach((sound, index) => {
    const node        = template.content.firstElementChild.cloneNode(true);
    const titleInput  = node.querySelector('.sound-title');
    const audio       = node.querySelector('audio');
    const loopBtn     = node.querySelector('.loop-btn');
    const downloadBtn = node.querySelector('.download-btn');
    const deleteBtn   = node.querySelector('.delete-btn');
    const timeElapsed = node.querySelector('.time-elapsed');
    const timeRemain  = node.querySelector('.time-remaining');
    const progressBar = node.querySelector('.card-progress-bar');

    node.dataset.color = CARD_COLORS[index % CARD_COLORS.length];
    titleInput.value   = sound.name || `Sound ${index + 1}`;

    const blob      = dataUrlToBlob(sound.dataUrl);
    const objectUrl = URL.createObjectURL(blob);
    audio.src       = objectUrl;

    /* ── Title editing (don't trigger card click) */
    titleInput.addEventListener('click',     e => e.stopPropagation());
    titleInput.addEventListener('mousedown', e => e.stopPropagation());
    titleInput.addEventListener('touchstart', e => e.stopPropagation(), { passive: true });

    titleInput.addEventListener('change', () => {
      const soundsNow = loadSounds();
      soundsNow[index].name = titleInput.value.trim() || `Sound ${index + 1}`;
      saveSounds(soundsNow);
    });

    /* ── Card click = play / stop ─────────────── */
    node.addEventListener('click', async (e) => {
      if (e.target.closest('.icon-btn') || e.target.closest('input')) return;

      if (playingAudio === audio) {
        // Stop current sound
        audio.pause();
        audio.currentTime = 0;
        node.classList.remove('is-playing');
        playingAudio = null;
        playingCard  = null;
      } else {
        stopAllPlayback();
        playingAudio = audio;
        playingCard  = node;
        node.classList.add('is-playing');
        try {
          await audio.play();
        } catch {
          node.classList.remove('is-playing');
          playingAudio = null;
          playingCard  = null;
          alert('Afspelen mislukte. Controleer microfoontoegang of probeer een andere browser.');
        }
      }
    });

    /* ── Time updates ─────────────────────────── */
    audio.addEventListener('loadedmetadata', () => {
      timeRemain.textContent = `-${formatTime(audio.duration)}`;
    });

    audio.addEventListener('timeupdate', () => {
      const elapsed  = audio.currentTime;
      const duration = audio.duration || 0;
      timeElapsed.textContent = formatTime(elapsed);
      timeRemain.textContent  = `-${formatTime(duration - elapsed)}`;
      if (duration > 0) progressBar.style.width = `${(elapsed / duration) * 100}%`;
    });

    audio.addEventListener('ended', () => {
      node.classList.remove('is-playing');
      if (playingAudio === audio) { playingAudio = null; playingCard = null; }
      timeElapsed.textContent = '00:00';
      timeRemain.textContent  = `-${formatTime(audio.duration || 0)}`;
      progressBar.style.width = '0%';
      audio.currentTime       = 0;
    });

    /* ── Loop toggle ──────────────────────────── */
    loopBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      audio.loop = !audio.loop;
      loopBtn.classList.toggle('active', audio.loop);
    });

    /* ── Download ─────────────────────────────── */
    downloadBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const a        = document.createElement('a');
      const safeName = (sound.name || `sound-${index + 1}`).replace(/[^\w\-]+/g, '_');
      const ext      = blob.type.includes('mp4') ? 'm4a' : (blob.type.includes('ogg') ? 'ogg' : 'webm');
      a.href         = objectUrl;
      a.download     = `${safeName}.${ext}`;
      a.click();
    });

    /* ── Delete ───────────────────────────────── */
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const soundsNow = loadSounds();
      soundsNow.splice(index, 1);
      saveSounds(soundsNow);
      if (playingAudio === audio) { playingAudio = null; playingCard = null; }
      URL.revokeObjectURL(objectUrl);
      renderSounds();
    });

    soundGrid.appendChild(node);
  });
}

/* ── Recording ────────────────────────────────── */

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia) {
    alert('Je browser ondersteunt geen microfoonopname.');
    return;
  }
  try {
    currentStream = await navigator.mediaDevices.getUserMedia({ audio: true });

    const preferredTypes = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
    const mimeType = preferredTypes.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';

    mediaRecorder  = new MediaRecorder(currentStream, mimeType ? { mimeType } : undefined);
    currentChunks  = [];

    mediaRecorder.ondataavailable = event => {
      if (event.data && event.data.size > 0) currentChunks.push(event.data);
    };

    mediaRecorder.onstop = async () => {
      const type    = mediaRecorder.mimeType || 'audio/webm';
      const blob    = new Blob(currentChunks, { type });
      const dataUrl = await bytesToDataUrl(blob);
      const sounds  = loadSounds();
      sounds.unshift({
        id:        crypto.randomUUID(),
        name:      soundNameInput.value.trim() || `Sound ${sounds.length + 1}`,
        createdAt: Date.now(),
        sizeKb:    approximateSizeFromDataUrl(dataUrl),
        dataUrl
      });
      saveSounds(sounds);
      soundNameInput.value = '';
      renderSounds();
      cleanupRecorder();
      micStatus.innerHTML = '<span class="dot"></span> Opname opgeslagen';
      micStatus.classList.remove('active');
    };

    mediaRecorder.start();
    recordBtn.disabled = true;
    recordBtn.classList.add('is-recording');
    stopBtn.disabled   = false;
    micStatus.innerHTML = '<span class="dot"></span> Bezig met opnemen...';
    micStatus.classList.add('active');
  } catch (err) {
    console.error(err);
    alert('Microfoon openen mislukte. Geef toegang in de browserinstellingen en probeer opnieuw.');
  }
}

function cleanupRecorder() {
  if (currentStream) {
    currentStream.getTracks().forEach(track => track.stop());
    currentStream = null;
  }
  mediaRecorder = null;
  currentChunks = [];
  recordBtn.disabled = false;
  recordBtn.classList.remove('is-recording');
  stopBtn.disabled   = true;
  micStatus.classList.remove('active');
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  } else {
    cleanupRecorder();
  }
}

/* ── Event listeners ──────────────────────────── */

recordBtn.addEventListener('click', startRecording);
stopBtn.addEventListener('click', stopRecording);

clearAllBtn.addEventListener('click', () => {
  const sounds = loadSounds();
  if (!sounds.length) return;
  if (!confirm('Alle sounds verwijderen?')) return;
  stopAllPlayback();
  localStorage.removeItem(STORAGE_KEY);
  renderSounds();
});

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredPrompt = event;
  installBtn.classList.remove('hidden');
});

installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  installBtn.classList.add('hidden');
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(console.error);
  });
}

renderSounds();
