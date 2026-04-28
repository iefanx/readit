# ReadIt Text-to-Speech PWA

ReadIt is a premium, on-device text-to-speech Progressive Web App. It parses PDFs, DOCX, and text files locally and reads them aloud using incredibly high-quality ONNX AI models running entirely in your browser's WebAssembly/WebGPU. No data is ever sent to a server.

## Features
- **100% Local Inference**: Complete privacy.
- **PWA Ready**: Installable on Desktop/Android/iOS with native Share Sheet handling.
- **Background Playback**: Hooks into your OS's Media Session API to keep playing while your screen is locked.
- **Silky Smooth Progress Tracking**: Calculates specific characters and glides a progress bar perfectly smoothly with the audio.
- **Offline Capable**: Dynamic Service Worker caching means your downloaded voices work forever without internet.

## Getting Started

1. **Install Dependencies**: 
   ```bash
   npm install
   ```
2. **Download AI Models (Required)**: 
   Because the AI models are massive, they are excluded from this repository. You must download the ONNX voice models and place them inside `public/assets/onnx/`.
   - Ensure the directory contains `.onnx` and `.wasm` files (e.g., `vector_estimator.onnx`, `vocoder.onnx`).
3. **Run the Development Server**:
   ```bash
   npm run dev
   ```
4. Open `http://localhost:5173/` in your browser.
