import { loadTextToSpeech, loadVoiceStyle, writeWavFile, chunkText } from './helper.js';
import { parseFile, generateGradientCover } from './parser.js';
import { saveDocument, getDocument, getAllDocuments, updateDocumentProgress, saveAudioChunk, getAudioChunk, deleteDocumentFull } from './db.js';

// Configuration
const ASSETS_PATH = '/assets';
const ONNX_DIR = `${ASSETS_PATH}/onnx`;
const REMOTE_ONNX_DIR = 'https://huggingface.co/Supertone/supertonic-2/resolve/main/onnx';
const VOICE_STYLES_DIR = `${ASSETS_PATH}/voice_styles`;

// Views
const homeView = document.getElementById('home-view');
const playerView = document.getElementById('player-view');

// Home DOM
const continueCarousel = document.getElementById('continue-carousel');
const btnFile = document.getElementById('btn-file');
const fileInput = document.getElementById('file-input');
const btnPaste = document.getElementById('btn-paste');
const btnLink = document.getElementById('btn-link');

// Player DOM
const backBtn = document.getElementById('back-btn');
const textInput = document.getElementById('text-input');
const readingDisplay = document.getElementById('reading-display');
const playPauseBtn = document.getElementById('play-pause-btn');
const iconPlay = document.getElementById('icon-play');
const iconPause = document.getElementById('icon-pause');
const rwBtn = document.getElementById('rw-btn');
const ffBtn = document.getElementById('ff-btn');
const voiceBtn = document.getElementById('voice-btn');
const voiceDropdown = document.getElementById('voice-dropdown');
const speedBtn = document.getElementById('speed-btn');
const speedDropdown = document.getElementById('speed-dropdown');
const menuBtn = document.getElementById('menu-btn');
const settingsMenu = document.getElementById('settings-menu');
const langSelect = document.getElementById('lang-select');
const stepsInput = document.getElementById('steps-input');
const stepsVal = document.getElementById('steps-val');
const downloadFullBtn = document.getElementById('download-full-btn');
const genStatus = document.getElementById('gen-status');
const genProgress = document.getElementById('gen-progress');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');
const loadProgress = document.getElementById('load-progress');

// State
let tts = null;
let currentVoiceStyle = null;
let currentVoiceId = 'M1';
let currentSpeed = 1.0;
let isGenerating = false;
let isGenerationComplete = false;
let currentDocId = null;

class AudioPlayer {
    constructor(sampleRate) {
        this.sampleRate = sampleRate;
        this.chunks = [];
        this.isPlaying = false;
        this.currentIndex = 0;
        this.offset = 0;
        this.source = null;
        this.playbackRate = 1.0;
        this.ctx = null;
    }

    initCtx() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
    }

    addChunk(chunk) {
        this.chunks.push(chunk);
        if (this.isPlaying && !this.source && this.currentIndex < this.chunks.length) {
            this._playCurrent();
        }
    }

    toggle() {
        this.initCtx();
        if (this.isPlaying) {
            this.pause();
            return false;
        } else {
            this.play();
            return true;
        }
    }

    play() {
        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
        this.isPlaying = true;
        this._playCurrent();
    }

    pause() {
        this.isPlaying = false;
        if (this.source) {
            this.source.onended = null;
            this.source.stop();
            const elapsedRealTime = this.ctx.currentTime - this.startTime;
            const elapsedAudioTime = elapsedRealTime * this.playbackRate;
            this.offset += elapsedAudioTime;
            this.source = null;
        }
    }

    seek(deltaSeconds) {
        const wasPlaying = this.isPlaying;
        if (this.isPlaying) this.pause();
        
        this.offset += deltaSeconds;
        
        while (this.offset < 0 && this.currentIndex > 0) {
            this.currentIndex--;
            this.offset += this.chunks[this.currentIndex].duration;
        }
        if (this.offset < 0) {
            this.currentIndex = 0;
            this.offset = 0;
        }

        while (this.currentIndex < this.chunks.length && this.offset >= this.chunks[this.currentIndex].duration) {
            this.offset -= this.chunks[this.currentIndex].duration;
            this.currentIndex++;
        }

        if (this.currentIndex >= this.chunks.length) {
            this.currentIndex = this.chunks.length - 1;
            if (this.currentIndex < 0) this.currentIndex = 0;
            if (this.chunks.length > 0) {
                this.offset = this.chunks[this.currentIndex].duration - 0.1;
            } else {
                this.offset = 0;
            }
        }

        if (this.chunks.length > 0) {
            this._highlight(this.chunks[this.currentIndex]?.chunkIndex || 0);
        }

        if (wasPlaying) {
            this.play();
        }
        
        // Media session status
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = "paused";
        releaseWakeLock();
    }

    setSpeed(speed) {
        this.playbackRate = speed;
        if (this.isPlaying && this.source) {
            this.source.playbackRate.value = speed;
        }
    }

    _playCurrent() {
        if (!this.isPlaying) return;
        if (this.currentIndex >= this.chunks.length) {
            this.source = null;
            if (isGenerationComplete) {
                this.isPlaying = false;
                updatePlayPauseIcon(false);
                this.currentIndex = 0;
                this.offset = 0;
                if ('mediaSession' in navigator) navigator.mediaSession.playbackState = "none";
                releaseWakeLock();
            }
            if (this.rafId) cancelAnimationFrame(this.rafId);
            return;
        }

        const chunk = this.chunks[this.currentIndex];
        
        const audioBuffer = this.ctx.createBuffer(1, chunk.wav.length, this.sampleRate);
        audioBuffer.getChannelData(0).set(chunk.wav);

        this.source = this.ctx.createBufferSource();
        this.source.buffer = audioBuffer;
        this.source.playbackRate.value = this.playbackRate;
        this.source.connect(this.ctx.destination);
        
        this.source.onended = () => {
            this.currentIndex++;
            this.offset = 0;
            this.source = null;
            
            // Save progress
            if (currentDocId) {
                updateDocumentProgress(currentDocId, chunk.chunkIndex + 1);
            }

            this._playCurrent();
        };

        this.startTime = this.ctx.currentTime;
        
        let startOffset = this.offset;
        if (startOffset < 0) startOffset = 0;
        if (startOffset > audioBuffer.duration) startOffset = audioBuffer.duration;
        
        this.source.start(0, startOffset);
        
        requestWakeLock();
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = "playing";
        
        // Smooth Progress Bar
        if (this.rafId) cancelAnimationFrame(this.rafId);
        const updateProgress = () => {
            if (!this.isPlaying || !this.source) return;
            const elapsed = (this.ctx.currentTime - this.startTime) * this.playbackRate;
            let progress = Math.min(1, elapsed / chunk.duration);
            if (chunk.totalChars) {
                const currentChars = chunk.startChar + (progress * chunk.chunkChars);
                const pct = (currentChars / chunk.totalChars) * 100;
                document.getElementById('read-progress-fill').style.width = `${pct}%`;
            }
            this.rafId = requestAnimationFrame(updateProgress);
        };
        this.rafId = requestAnimationFrame(updateProgress);

        this._highlight(chunk.chunkIndex);
    }

    _highlight(index) {
        document.querySelectorAll('.text-chunk').forEach(el => el.classList.remove('active'));
        const el = document.getElementById(`chunk-${index}`);
        if (el) {
            el.classList.add('active');
            
            // Smart scroll: only scroll if it goes off screen
            const rect = el.getBoundingClientRect();
            const isInViewport = (
                rect.top >= 80 &&
                rect.bottom <= (window.innerHeight - 120)
            );

            if (!isInViewport) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }

    reset() {
        this.pause();
        this.chunks = [];
        this.currentIndex = 0;
        this.offset = 0;
        document.querySelectorAll('.text-chunk').forEach(el => el.classList.remove('active'));
    }
}

let player = null;

// Wake Lock
let wakeLock = null;
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator && !wakeLock) {
            wakeLock = await navigator.wakeLock.request('screen');
        }
    } catch (err) { }
}
function releaseWakeLock() {
    if (wakeLock !== null) {
        wakeLock.release().then(() => { wakeLock = null; });
    }
}

// Media Session
function setupMediaSession() {
    if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: 'Reading Document',
            artist: 'ReadIt PWA',
            artwork: [{ src: '/favicon.ico', sizes: '64x64', type: 'image/x-icon' }]
        });

        navigator.mediaSession.setActionHandler('play', () => {
            if (player && !player.isPlaying) {
                player.play();
                updatePlayPauseIcon(true);
            }
        });
        navigator.mediaSession.setActionHandler('pause', () => {
            if (player && player.isPlaying) {
                player.pause();
                updatePlayPauseIcon(false);
            }
        });
        navigator.mediaSession.setActionHandler('seekbackward', () => {
            if (player) {
                player.pause();
                player.currentIndex = Math.max(0, player.currentIndex - 1);
                player.offset = 0;
                player.play();
                updatePlayPauseIcon(true);
            }
        });
        navigator.mediaSession.setActionHandler('seekforward', () => {
            if (player) {
                player.pause();
                player.currentIndex = Math.min(player.chunks.length - 1, player.currentIndex + 1);
                player.offset = 0;
                player.play();
                updatePlayPauseIcon(true);
            }
        });
    }
}

// Initialization
async function init() {
    try {
        // Register SW
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js').catch(console.error);
            navigator.serviceWorker.addEventListener('message', async (event) => {
                if (event.data && event.data.type === 'SHARED_FILE') {
                    await handleFileSelection(event.data.file);
                }
            });
        }
        
        // Handle Launch Queue (PWA File Handlers)
        if ('launchQueue' in window) {
            window.launchQueue.setConsumer(async (launchParams) => {
                if (launchParams.files && launchParams.files.length) {
                    const fileHandle = launchParams.files[0];
                    const file = await fileHandle.getFile();
                    await handleFileSelection(file);
                }
            });
        }
        
        setupMediaSession();

        ort.env.wasm.wasmPaths = '/';
        const sessionOptions = {
            executionProviders: ['webgpu', 'wasm'],
            graphOptimizationLevel: 'all'
        };

        const { textToSpeech } = await loadTextToSpeech(ONNX_DIR, REMOTE_ONNX_DIR, sessionOptions, (name, current, total, isDownload) => {
            const loadingTitle = document.getElementById('loading-title');
            const loadingSubtext = document.getElementById('loading-subtext');
            
            if (isDownload && total > 1) {
                loadingSubtext.classList.remove('hidden');
                loadingTitle.textContent = "Downloading AI Models";
                // Byte-level download progress
                const loadedMB = (current / (1024 * 1024)).toFixed(1);
                const totalMB = (total / (1024 * 1024)).toFixed(1);
                const percent = (current / total) * 100;
                loadingText.textContent = `${name}... ${loadedMB} / ${totalMB} MB`;
                loadProgress.style.width = `${percent}%`;
            } else {
                loadingSubtext.classList.add('hidden');
                loadingTitle.textContent = "Initializing ReadIt";
                loadingText.textContent = `Loading ${name}...`;
                // Fake progress or full for loading
                if (total > 0) {
                     loadProgress.style.width = `${(current / total) * 100}%`;
                }
            }
        });

        tts = textToSpeech;
        player = new AudioPlayer(tts.sampleRate);
        await updateVoiceStyle('M1');

        await loadHomeLibrary();

        loadingOverlay.style.opacity = '0';
        setTimeout(() => loadingOverlay.style.display = 'none', 500);

    } catch (error) {
        console.error('Initialization failed:', error);
        loadingText.textContent = `Error: ${error.message}`;
        loadingText.style.color = '#ef4444';
    }
}

async function updateVoiceStyle(preset) {
    const path = `${VOICE_STYLES_DIR}/${preset}.json`;
    currentVoiceStyle = await loadVoiceStyle([path]);
    currentVoiceId = preset;
    document.querySelector('.voice-icon').textContent = preset;
    document.querySelectorAll('.v-opt').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.val === preset);
    });
}

function updatePlayPauseIcon(isPlaying) {
    if (isPlaying) {
        iconPlay.classList.add('hidden');
        iconPause.classList.remove('hidden');
    } else {
        iconPlay.classList.remove('hidden');
        iconPause.classList.add('hidden');
    }
}

// UI Navigation
function showPlayerView() {
    homeView.classList.add('hidden');
    playerView.classList.remove('hidden');
}

function showHomeView() {
    playerView.classList.add('hidden');
    homeView.classList.remove('hidden');
    
    // Save raw text if modified before leaving
    if (currentDocId && !isGenerating && player.chunks.length === 0) {
        saveCurrentDocText();
    }
    
    if (player) {
        player.pause();
        updatePlayPauseIcon(false);
    }
    
    loadHomeLibrary();
}

async function saveCurrentDocText() {
    if (!currentDocId) return;
    const doc = await getDocument(currentDocId);
    if (doc) {
        const currentText = textInput.value.trim();
        if (currentText !== doc.text) {
            doc.text = currentText;
            if (!doc.title || doc.title.startsWith("Pasted Text")) {
                doc.title = currentText.substring(0, 30) + "...";
            }
            await saveDocument(doc);
        }
    }
}

// Home Library Logic
async function loadHomeLibrary() {
    continueCarousel.innerHTML = '';
    const docs = await getAllDocuments();
    
    docs.forEach(doc => {
        const card = document.createElement('div');
        card.className = 'doc-card';
        card.innerHTML = `
            <img src="${doc.coverImage}" class="doc-cover" alt="Cover">
            <div class="doc-title">${doc.title}</div>
        `;
        card.addEventListener('click', () => openDocument(doc.id));
        continueCarousel.appendChild(card);
    });
}

async function openDocument(id) {
    const doc = await getDocument(id);
    if (!doc) return;
    
    currentDocId = doc.id;
    textInput.value = doc.text;
    textInput.classList.remove('hidden');
    readingDisplay.classList.add('hidden');
    readingDisplay.innerHTML = '';
    
    player.reset();
    isGenerating = false;
    isGenerationComplete = false;
    updatePlayPauseIcon(false);
    
    // Auto-play if we have progress? Wait, let user click play.
    showPlayerView();
}

// Action Handlers
backBtn.addEventListener('click', showHomeView);

btnPaste.addEventListener('click', async () => {
    // Create empty doc
    const newDocId = await saveDocument({
        title: "Pasted Text",
        text: "",
        coverImage: generateGradientCover("Pasted Text")
    });
    await openDocument(newDocId);
});

btnFile.addEventListener('click', () => {
    fileInput.click();
});

btnLink.addEventListener('click', () => {
    alert("Direct link downloading is blocked by browsers due to CORS security. A backend proxy feature is planned for the future.");
});

async function handleFileSelection(file) {
    if (!file) return;

    loadingOverlay.style.display = 'flex';
    loadingOverlay.style.opacity = '1';
    loadingText.textContent = `Parsing ${file.name}...`;

    try {
        const parsed = await parseFile(file);
        const newDocId = await saveDocument({
            title: parsed.title,
            text: parsed.text,
            coverImage: parsed.coverImage
        });
        await openDocument(newDocId);
    } catch (err) {
        console.error(err);
        alert("Failed to parse file: " + err.message);
    } finally {
        loadingOverlay.style.opacity = '0';
        setTimeout(() => loadingOverlay.style.display = 'none', 500);
    }
}

fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    await handleFileSelection(file);
    fileInput.value = '';
});

// Dropdown Toggles
function closeAllDropdowns() {
    voiceDropdown.classList.remove('show');
    speedDropdown.classList.remove('show');
    settingsMenu.classList.remove('show');
}

document.addEventListener('click', (e) => {
    if (!e.target.closest('.player-pill') && !e.target.closest('.menu-container')) {
        closeAllDropdowns();
    }
});

voiceBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    speedDropdown.classList.remove('show');
    settingsMenu.classList.remove('show');
    voiceDropdown.classList.toggle('show');
});

speedBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    voiceDropdown.classList.remove('show');
    settingsMenu.classList.remove('show');
    speedDropdown.classList.toggle('show');
});

menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    voiceDropdown.classList.remove('show');
    speedDropdown.classList.remove('show');
    settingsMenu.classList.toggle('show');
});

// Settings & Controls
document.querySelectorAll('.v-opt').forEach(btn => {
    btn.addEventListener('click', async () => {
        await updateVoiceStyle(btn.dataset.val);
        closeAllDropdowns();
    });
});

document.querySelectorAll('.s-opt').forEach(btn => {
    btn.addEventListener('click', () => {
        currentSpeed = parseFloat(btn.dataset.val);
        speedBtn.textContent = `${currentSpeed}x`;
        document.querySelectorAll('.s-opt').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (player) player.setSpeed(currentSpeed);
        closeAllDropdowns();
    });
});

stepsInput.addEventListener('input', (e) => {
    stepsVal.textContent = e.target.value;
});

rwBtn.addEventListener('click', () => {
    if (player) player.seek(-10);
});

ffBtn.addEventListener('click', () => {
    if (player) player.seek(10);
});

playPauseBtn.addEventListener('click', () => {
    const text = textInput.value.trim();
    if (!text) return;

    if (isGenerating || player.chunks.length > 0) {
        const isPlaying = player.toggle();
        updatePlayPauseIcon(isPlaying);
    } else {
        startGenerationAndPlayback(text);
    }
});

// Click to Read
readingDisplay.addEventListener('click', (e) => {
    if (e.target.classList.contains('text-chunk')) {
        const idParts = e.target.id.split('-');
        if (idParts.length === 2) {
            const clickedIndex = parseInt(idParts[1]);
            
            // Check if player already has this chunk
            const existingChunkIdx = player.chunks.findIndex(c => c.chunkIndex === clickedIndex);
            
            if (existingChunkIdx !== -1) {
                // Seek directly to the loaded chunk
                player.pause();
                player.currentIndex = existingChunkIdx;
                player.offset = 0;
                player.play();
                updatePlayPauseIcon(true);
            } else {
                // Restart generation from this exact chunk
                const text = textInput.value.trim();
                startGenerationAndPlayback(text, clickedIndex);
            }
        }
    }
});

// Generation Logic
let abortController = null;
let currentGenerationId = 0; // Simple ID to track active generation loops

async function stopGenerationSafely() {
    if (isGenerating) {
        if (abortController) {
            abortController.abort();
            abortController = null;
        }
        // Wait for the active generation loop to naturally exit
        while (isGenerating) {
            await new Promise(r => setTimeout(r, 50));
        }
    }
}

async function startGenerationAndPlayback(text, startChunkIndexOverride = null) {
    await stopGenerationSafely();
    
    // Save text to DB before generating
    await saveCurrentDocText();
    
    textInput.classList.add('hidden');
    readingDisplay.classList.remove('hidden');

    const lang = langSelect.value;
    const steps = parseInt(stepsInput.value);
    
    const maxLen = lang === 'ko' ? 120 : 300;
    const textList = chunkText(text, maxLen);
    readingDisplay.innerHTML = textList.map((t, i) => `<span id="chunk-${i}" class="text-chunk">${t}</span>`).join(' ');

    // Character offsets for smooth progress bar
    let totalChars = text.length;
    let charOffsets = [0];
    let currentCharsCount = 0;
    for (let t of textList) {
        currentCharsCount += t.length;
        charOffsets.push(currentCharsCount);
    }

    player.reset();
    isGenerating = true;
    isGenerationComplete = false;
    currentGenerationId++;
    const myGenId = currentGenerationId;
    
    genStatus.classList.add('show');
    genProgress.textContent = '0';
    updatePlayPauseIcon(true);
    player.initCtx();
    player.isPlaying = true;

    // Check if we have a saved chunkIndex to resume from
    let startChunkIndex = 0;
    if (startChunkIndexOverride !== null) {
        startChunkIndex = startChunkIndexOverride;
    } else if (currentDocId) {
        const doc = await getDocument(currentDocId);
        if (doc && doc.lastReadChunk > 0 && doc.lastReadChunk < textList.length) {
            startChunkIndex = doc.lastReadChunk;
        }
    }
    
    // Initial scroll to starting chunk
    setTimeout(() => {
        const el = document.getElementById(`chunk-${startChunkIndex}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);

    abortController = new AbortController();
    const signal = abortController.signal;

    try {
        for (let i = startChunkIndex; i < textList.length; i++) {
            if (signal.aborted || currentGenerationId !== myGenId) break;
            
            let chunkData = null;
            const currentVoiceId = document.querySelector('.v-opt.active').getAttribute('data-val');
            
            // Check Cache
            if (currentDocId) {
                const cachedWav = await getAudioChunk(currentDocId, i, currentVoiceId);
                if (cachedWav) {
                    chunkData = {
                        wav: cachedWav,
                        duration: (cachedWav.length / tts.sampleRate),
                        textChunk: textList[i],
                        chunkIndex: i,
                        totalChunks: textList.length,
                        startChar: charOffsets[i],
                        chunkChars: textList[i].length,
                        totalChars: totalChars
                    };
                }
            }
            
            // If not cached, run AI inference
            if (!chunkData) {
                chunkData = await tts.generateSingleChunk(
                    textList[i], lang, currentVoiceStyle, steps, i, textList.length, 1.05, 0.3
                );
                
                chunkData.startChar = charOffsets[i];
                chunkData.chunkChars = textList[i].length;
                chunkData.totalChars = totalChars;
                
                // Save to cache
                if (currentDocId) {
                    await saveAudioChunk(currentDocId, i, currentVoiceId, chunkData.wav);
                }
            }
            
            if (signal.aborted || currentGenerationId !== myGenId) break;
            
            player.addChunk(chunkData);
            genProgress.textContent = Math.round(((i + 1) / textList.length) * 100);
        }
    } catch (error) {
        console.error("Generation error:", error);
    } finally {
        if (currentGenerationId === myGenId) {
            isGenerating = false;
            isGenerationComplete = true;
            genStatus.classList.remove('show');
        }
    }
}

// Download Full Audio
downloadFullBtn.addEventListener('click', () => {
    if (!player || player.chunks.length === 0) {
        alert("Please generate audio first by pressing Play.");
        return;
    }

    let fullWav = [];
    player.chunks.forEach(c => {
        fullWav = [...fullWav, ...c.wav];
    });

    const wavBuffer = writeWavFile(fullWav, tts.sampleRate);
    const blob = new Blob([wavBuffer], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `readit_${Date.now()}.wav`;
    a.click();
    URL.revokeObjectURL(url);
});

// Delete Document
const deleteDocBtn = document.getElementById('delete-doc-btn');
deleteDocBtn.addEventListener('click', async () => {
    if (!currentDocId) return;
    
    const confirmDelete = confirm("Are you sure you want to delete this document and all its generated audio? This cannot be undone.");
    if (confirmDelete) {
        await deleteDocumentFull(currentDocId);
        
        // Go back to Home
        await stopGenerationSafely();
        player.reset();
        isGenerationComplete = true;
        currentDocId = null;
        textInput.value = '';
        readingDisplay.innerHTML = '';
        settingsMenu.classList.remove('show');
        
        loadDocumentsToCarousel();
        
        playerView.classList.add('hidden');
        homeView.classList.remove('hidden');
    }
});

// Close dropdowns when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.menu-container')) settingsMenu.classList.remove('show');
    if (!e.target.closest('.voice-btn') && !e.target.closest('.voice-dropdown')) voiceDropdown.classList.remove('show');
    if (!e.target.closest('.speed-btn') && !e.target.closest('.speed-dropdown')) speedDropdown.classList.remove('show');
});

// Initialize
init();
