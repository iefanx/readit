import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;
import mammoth from 'mammoth';

// Generate a random gradient cover for text/docx
export function generateGradientCover(title) {
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 400;
    const ctx = canvas.getContext('2d');
    
    // Random hues
    const h1 = Math.floor(Math.random() * 360);
    const h2 = (h1 + 40 + Math.floor(Math.random() * 80)) % 360;
    
    const gradient = ctx.createLinearGradient(0, 0, 300, 400);
    gradient.addColorStop(0, `hsl(${h1}, 70%, 20%)`);
    gradient.addColorStop(1, `hsl(${h2}, 70%, 10%)`);
    
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 300, 400);
    
    // Add text overlay
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.font = 'bold 24px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Simple text wrapping for title
    const words = title.split(' ');
    let lines = [];
    let currentLine = '';
    
    for (let word of words) {
        let testLine = currentLine + word + ' ';
        let metrics = ctx.measureText(testLine);
        if (metrics.width > 260 && currentLine !== '') {
            lines.push(currentLine);
            currentLine = word + ' ';
        } else {
            currentLine = testLine;
        }
    }
    lines.push(currentLine);
    
    // Draw lines
    const startY = 200 - ((lines.length - 1) * 15);
    for (let i = 0; i < Math.min(lines.length, 5); i++) {
        ctx.fillText(lines[i].trim(), 150, startY + (i * 30));
    }
    
    return canvas.toDataURL('image/jpeg', 0.8);
}

export async function parseFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    const title = file.name.replace(/\.[^/.]+$/, "");
    
    let text = "";
    let coverImage = null;

    if (ext === 'pdf') {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        
        // Extract Cover (Page 1)
        try {
            const page = await pdf.getPage(1);
            const viewport = page.getViewport({ scale: 1.0 });
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            // Scale to reasonable thumbnail size
            const scale = Math.min(300 / viewport.width, 400 / viewport.height);
            const scaledViewport = page.getViewport({ scale });
            
            canvas.height = scaledViewport.height;
            canvas.width = scaledViewport.width;
            
            await page.render({ canvasContext: ctx, viewport: scaledViewport }).promise;
            coverImage = canvas.toDataURL('image/jpeg', 0.8);
        } catch (e) {
            console.error("Failed to generate PDF cover", e);
            coverImage = generateGradientCover(title);
        }

        // Extract Text without blocking UI
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            text += textContent.items.map(item => item.str).join(' ') + "\n\n";
            
            // Yield to main thread every 10 pages to keep UI snappy
            if (i % 10 === 0) {
                await new Promise(r => setTimeout(r, 0));
            }
        }

    } else if (ext === 'docx') {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
        text = result.value;
        coverImage = generateGradientCover(title);
    } else if (ext === 'txt' || ext === 'md') {
        text = await file.text();
        coverImage = generateGradientCover(title);
    } else {
        throw new Error("Unsupported file type");
    }

    // Clean up text (remove excessive newlines)
    text = text.replace(/\n{3,}/g, '\n\n').trim();

    return {
        title,
        text,
        coverImage
    };
}
