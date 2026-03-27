const STORAGE_KEY = 'soundboard-recordings-v1';

const soundNameInput = document.getElementById('soundName');
const recordBtn = document.getElementById('recordBtn');
const stopBtn = document.getElementById('stopBtn');
const clearAllBtn = document.getElementById('clearAllBtn');
const micStatus = document.getElementById('micStatus');
const countStatus = document.getElementById('countStatus');
const soundGrid = document.getElementById('soundGrid');
const emptyState = document.getElementById('emptyState');
const template = document.getElementById('soundCardTemplate');
const installBtn = document.getElementById('installBtn');

let mediaRecorder = null;
let currentStream = null;
let currentChunks = [];
let deferredPrompt = null;
let playingAudio = null;

function loadSounds() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveSounds(sounds) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sounds));
}

function formatDate(ts) {
  return new Date(ts).toLocaleString('nl-NL', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function approximateSizeFromDataUrl(dataUrl) {
  const base64Part = dataUrl.split(',')[1] || '';
  return Math.round((base64Part.length * 3) / 4 / 1024);
}

function bytesToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(',');
  const mime = /data:(.*?);base64/.exec(header)?.[1] || 'audio/webm';
  const bytes = atob(base64);
  const array = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) array[i] = bytes.charCodeAt(i);
  return new Blob([array], { type: mime });
}

function stopAllPlayback() {
  if (playingAudio) {
    playingAudio.pause();
    playingAudio.currentTime = 0;
    playingAudio = null;
  }
}

function updateCountLabel() {
  const sounds = loadSounds();
  countStatus.textContent = `${sounds.length} sound${sounds.length === 1 ? '' : 's'}`;
}

function renderSounds() {
  const sounds = loadSounds();
  soundGrid.innerHTML = '';
  emptyState.style.display = sounds.length ? 'none' : 'block';
  updateCountLabel();

  sounds.forEach((sound, index) => {
    const node = template.content.firstElementChild.cloneNode(true);
    const titleInput = node.querySelector('.sound-title');
    const meta = node.querySelector('.sound-meta');
    const audio = node.querySelector('audio');
    const playBtn = node.querySelector('.play-btn');
    const stopPlayBtn = node.querySelector('.stop-play-btn');
    const deleteBtn = node.querySelector('.delete-btn');
    const downloadBtn = node.querySelector('.download-btn');

    titleInput.value = sound.name || `Sound ${index + 1}`;
    meta.textContent = `${formatDate(sound.createdAt)} • ${sound.sizeKb} KB`;

    const blob = dataUrlToBlob(sound.dataUrl);
    const objectUrl = URL.createObjectURL(blob);
    audio.src = objectUrl;

    titleInput.addEventListener('change', () => {
      const soundsNow = loadSounds();
      soundsNow[index].name = titleInput.value.trim() || `Sound ${index + 1}`;
      saveSounds(soundsNow);
      renderSounds();
    });

    playBtn.addEventListener('click', async () => {
      stopAllPlayback();
      playingAudio = audio;
      try {
        await audio.play();
      } catch (err) {
        alert('Afspelen mislukte. Safari doet soms alsof gebruiksgemak een misdaad is.');
      }
    });

    stopPlayBtn.addEventListener('click', () => {
      if (playingAudio === audio) playingAudio = null;
      audio.pause();
      audio.currentTime = 0;
    });

    deleteBtn.addEventListener('click', () => {
      const soundsNow = loadSounds();
      soundsNow.splice(index, 1);
      saveSounds(soundsNow);
      if (playingAudio === audio) playingAudio = null;
      URL.revokeObjectURL(objectUrl);
      renderSounds();
    });

    downloadBtn.addEventListener('click', () => {
      const a = document.createElement('a');
      const safeName = (sound.name || `sound-${index + 1}`).replace(/[^\w\-]+/g, '_');
      const ext = blob.type.includes('mp4') ? 'm4a' : (blob.type.includes('ogg') ? 'ogg' : 'webm');
      a.href = objectUrl;
      a.download = `${safeName}.${ext}`;
      a.click();
    });

    audio.addEventListener('ended', () => {
      if (playingAudio === audio) playingAudio = null;
    });

    soundGrid.appendChild(node);
  });
}

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia) {
    alert('Je browser ondersteunt geen microfoonopname.');
    return;
  }

  try {
    currentStream = await navigator.mediaDevices.getUserMedia({ audio: true });

    const preferredTypes = [
      'audio/mp4',
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus'
    ];
    const mimeType = preferredTypes.find(type => window.MediaRecorder && MediaRecorder.isTypeSupported(type)) || '';

    mediaRecorder = new MediaRecorder(currentStream, mimeType ? { mimeType } : undefined);
    currentChunks = [];

    mediaRecorder.ondataavailable = event => {
      if (event.data && event.data.size > 0) currentChunks.push(event.data);
    };

    mediaRecorder.onstop = async () => {
      const type = mediaRecorder.mimeType || 'audio/webm';
      const blob = new Blob(currentChunks, { type });
      const dataUrl = await bytesToDataUrl(blob);
      const sounds = loadSounds();
      const trimmedName = soundNameInput.value.trim();
      sounds.unshift({
        id: crypto.randomUUID(),
        name: trimmedName || `Sound ${sounds.length + 1}`,
        createdAt: Date.now(),
        sizeKb: approximateSizeFromDataUrl(dataUrl),
        dataUrl
      });
      saveSounds(sounds);
      soundNameInput.value = '';
      renderSounds();
      cleanupRecorder();
      micStatus.textContent = 'Opname opgeslagen';
    };

    mediaRecorder.start();
    recordBtn.disabled = true;
    stopBtn.disabled = false;
    micStatus.textContent = 'Bezig met opnemen...';
  } catch (err) {
    console.error(err);
    alert('Microfoon openen mislukte. Geef toegang in Safari-instellingen en probeer opnieuw.');
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
  stopBtn.disabled = true;
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  } else {
    cleanupRecorder();
  }
}

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
