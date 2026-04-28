import { get, set, keys, del } from 'idb-keyval';

const PREFIX = 'st_doc_';

/**
 * Document object structure:
 * {
 *   id: string (timestamp + random),
 *   title: string,
 *   text: string,
 *   coverImage: string (data URL),
 *   lastReadChunk: number,
 *   dateAdded: number (timestamp)
 * }
 */

export async function saveDocument(doc) {
    if (!doc.id) {
        doc.id = PREFIX + Date.now() + '_' + Math.floor(Math.random() * 1000);
    }
    if (!doc.dateAdded) {
        doc.dateAdded = Date.now();
    }
    if (typeof doc.lastReadChunk !== 'number') {
        doc.lastReadChunk = 0;
    }
    await set(doc.id, doc);
    return doc.id;
}

export async function getDocument(id) {
    return await get(id);
}

export async function getAllDocuments() {
    const allKeys = await keys();
    const docKeys = allKeys.filter(k => typeof k === 'string' && k.startsWith(PREFIX));
    
    const docs = await Promise.all(docKeys.map(k => get(k)));
    
    // Sort by most recently added/read first (could add lastAccessed field later)
    return docs.sort((a, b) => b.dateAdded - a.dateAdded);
}

export async function deleteDocument(id) {
    await del(id);
}

export async function updateDocumentProgress(id, chunkIndex) {
    const doc = await get(id);
    if (doc) {
        doc.lastReadChunk = chunkIndex;
        await set(id, doc);
    }
}

export async function saveAudioChunk(docId, chunkIndex, voiceId, chunkData) {
    const key = `st_audio_${docId}_${chunkIndex}_${voiceId}`;
    await set(key, chunkData);
}

export async function getAudioChunk(docId, chunkIndex, voiceId) {
    const key = `st_audio_${docId}_${chunkIndex}_${voiceId}`;
    return await get(key);
}

export async function deleteDocumentFull(docId) {
    // Delete the document itself
    await del(docId);
    
    // Scan and delete all audio chunks
    const allKeys = await keys();
    const chunkKeys = allKeys.filter(k => k.toString().startsWith(`st_audio_${docId}_`));
    
    // Delete chunks in parallel
    await Promise.all(chunkKeys.map(k => del(k)));
}
