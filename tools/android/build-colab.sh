#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
test -s dist/index.html

# Cài bộ công cụ Linux trong phiên Colab và tái sử dụng khi build lại.
export JAVA_HOME=/content/temurin21
export ANDROID_HOME=/content/android-sdk
export ANDROID_SDK_ROOT="$ANDROID_HOME"
node_dir=/content/midnight-node22
if [[ ! -x "$JAVA_HOME/bin/jlink" ]]; then
  mkdir -p "$JAVA_HOME"
  curl -fLsS --retry 2 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.8%2B9/OpenJDK21U-jdk_x64_linux_hotspot_21.0.8_9.tar.gz' |
    tar -xz --strip-components=1 -C "$JAVA_HOME"
fi
if [[ ! -x "$node_dir/bin/node" ]]; then
  mkdir -p "$node_dir"
  curl -fLsS --retry 2 'https://nodejs.org/dist/v22.21.1/node-v22.21.1-linux-x64.tar.xz' |
    tar -xJ --strip-components=1 -C "$node_dir"
fi
export PATH="$JAVA_HOME/bin:$node_dir/bin:$PATH"

sdk="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
if [[ ! -x "$sdk" ]]; then
  sdk_tmp="$(mktemp -d)"
  curl -fLsS --retry 2 'https://dl.google.com/android/repository/commandlinetools-linux-15859902_latest.zip' -o "$sdk_tmp/tools.zip"
  unzip -q "$sdk_tmp/tools.zip" -d "$sdk_tmp"
  mkdir -p "$ANDROID_HOME/cmdline-tools"
  mv "$sdk_tmp/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
fi
if [[ ! -d "$ANDROID_HOME/platforms/android-36" || ! -x "$ANDROID_HOME/build-tools/36.0.0/apksigner" ]]; then
  # Khôi phục bộ SDK đã được người dùng chấp thuận cho quy trình Colab.
  (set +o pipefail; yes | "$sdk" --licenses >/dev/null)
  "$sdk" 'platforms;android-36' 'build-tools;36.0.0' 'platform-tools'
fi

# Tạo vỏ Android từ bản dist đi cùng gói nguồn và áp cấu hình toàn màn hình.
npm install --no-audit --no-fund @capacitor/core@8 @capacitor/cli@8 @capacitor/android@8
cat >capacitor.config.json <<'JSON'
{"appId":"com.spdatdd.midnightexpressway","appName":"Midnight Expressway","webDir":"dist"}
JSON
if [[ ! -d android ]]; then npx cap add android; fi
cp tools/android/MainActivity.java android/app/src/main/java/com/spdatdd/midnightexpressway/MainActivity.java
npx cap sync android
(cd android && bash ./gradlew --no-daemon assembleDebug)

# Kiểm tra chữ ký và bảo đảm APK chứa đủ các GLB tối ưu của bản web.
apk=android/app/build/outputs/apk/debug/app-debug.apk
"$ANDROID_HOME/build-tools/36.0.0/apksigner" verify "$apk"
python3 - "$apk" <<'PY'
from pathlib import Path
from zipfile import ZipFile
import sys

with ZipFile(sys.argv[1]) as apk:
    entries = set(apk.namelist())
    assets = [Path('dist/index.html'), *Path('dist/assets/models-optimized').glob('*.glb')]
    for file in assets:
        entry = 'assets/public/' + file.relative_to('dist').as_posix()
        assert entry in entries and apk.read(entry) == file.read_bytes(), entry
    assert not any(name.startswith('assets/public/assets/models/') for name in entries)
    print(f'Đã xác minh {len(assets)-1} GLB và trang game trong APK.')
PY
