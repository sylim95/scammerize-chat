# Scammerize.AI

문서나 이미지를 업로드하면 자동으로 요약해주는 앱입니다. <br>
웹은 Next.js로, 네이티브는 **Capacitor(Android/iOS)** 로 동작합니다. <br>
광고는 AdMob을 붙였고, 저장은 `Filesystem` / `Share` 플러그인을 사용합니다. <br>

### 실행 방법

**웹 (개발 서버)**
```
npm install
npm run dev
# http://localhost:3000
```

**Android**
```
# Capacitor 초기화/동기화
npx cap sync android

# Android 스튜디오에서 열기
npx cap open android
```

**빌드/설치:**
```
cd android
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

**iOS**
```
# Capacitor 초기화/동기화
npx cap sync ios

# Xcode에서 열기
npx cap open ios
```
<br>

- 시뮬레이터 또는 실제 기기에서 빌드 실행 가능
- App Tracking Transparency 권한 팝업이 자동으로 뜨도록 설정됨
<br><br>

### 환경 변수 (AdMob)
.env 파일에 추가:
```
# 실제 ID
NEXT_PUBLIC_ADMOB_INTERSTITIAL=ca-app-pub-xxxxxxxxxxxxxxxx/xxxxxxxxxx      
# 테스트 ID 
NEXT_PUBLIC_ADMOB_INTERSTITIAL_TEST=ca-app-pub-xxxxxxxxxxxxxxxx/xxxxxxxxxx 
```

<br>

### 주요 기능
- PDF / DOCX / PPTX / TXT / 이미지 업로드 및 요약
- 전면 광고(AdMob Interstitial) 노출
- 네이티브 저장/공유 (`Filesystem` + `Share`)

