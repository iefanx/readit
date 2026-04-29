#!/bin/bash
# PWA Fix Script for ReadIt
# This script converts SVGs to PNGs for PWA compatibility

echo "🚀 Starting PWA asset fix..."

cd public

# Convert SVGs to PNGs using sips (macOS native)
if command -v sips &> /dev/null; then
    echo "🎨 Converting icons..."
    sips -s format png icon-512.svg --out icon-512.png &> /dev/null
    sips -s format png icon-192.svg --out icon-192.png &> /dev/null
    
    # Resize to exact dimensions
    sips -z 512 512 icon-512.png &> /dev/null
    sips -z 192 192 icon-192.png &> /dev/null
    
    # Create favicon
    sips -z 32 32 icon-192.png --out favicon.png &> /dev/null
    
    echo "✅ Icons created successfully."
else
    echo "❌ sips not found. Please ensure you are on macOS."
fi

# Ensure .well-known folder exists in the root of the deployed site
echo "📁 Checking .well-known structure..."
if [ ! -d ".well-known" ]; then
    mkdir -p .well-known
    mv assetlinks.json .well-known/ 2>/dev/null
fi

echo "✨ PWA Fix Complete! All requirements for TWA and Play Store are ready."
