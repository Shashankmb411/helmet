#!/bin/bash
# build-apk.sh — One-command Android APK builder using Capacitor

echo "=========================================="
echo "  ESP32 Safety Monitor — APK Builder"
echo "=========================================="

# Check prerequisites
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Install from https://nodejs.org"
    exit 1
fi

if ! command -v java &> /dev/null; then
    echo "❌ Java not found. Install JDK 17+"
    exit 1
fi

# Step 1: Init Capacitor project
echo "📦 Setting up Capacitor..."
npm init -y
npm install @capacitor/core @capacitor/cli @capacitor/android

# Step 2: Copy config
cp capacitor.config.json ./node_modules/.temp/ 2>/dev/null || true

# Step 3: Init Capacitor
npx cap init "ESP32 Safety Monitor" com.yourname.safetymonitor --web-dir . --skip

# Step 4: Add Android platform
echo "🤖 Adding Android platform..."
npx cap add android

# Step 5: Sync web assets
echo "🔄 Syncing assets..."
npx cap sync android

# Step 6: Build APK
echo "🔨 Building APK..."
cd android
./gradlew assembleDebug

# Step 7: Output path
APK_PATH="app/build/outputs/apk/debug/app-debug.apk"
if [ -f "$APK_PATH" ]; then
    echo ""
    echo "✅ APK built successfully!"
    echo "📍 Location: android/$APK_PATH"
    echo ""
    echo "Install on phone:"
    echo "  adb install android/$APK_PATH"
else
    echo "❌ Build failed. Check Android Studio for errors."
fi
