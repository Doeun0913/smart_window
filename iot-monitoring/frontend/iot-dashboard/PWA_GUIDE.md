# 📱 Smart Home IoT - PWA 설치 가이드

이 앱은 Progressive Web App(PWA)으로 제작되어 모바일 기기에 앱처럼 설치할 수 있습니다!

## ✨ 주요 변경사항

### 🎨 디자인 업데이트
- ✅ **검정 배경 → 하얀 배경**: 밝고 깔끔한 라이트 테마로 변경
- ✅ **그라데이션 배경**: 부드러운 블루/인디고 그라데이션 적용
- ✅ **글래스모피즘**: 반투명 카드 디자인으로 현대적인 느낌
- ✅ **향상된 가독성**: 모든 텍스트와 아이콘을 라이트 테마에 최적화

### 📱 PWA 기능 추가
- ✅ **오프라인 지원**: 인터넷 연결 없이도 앱 실행 가능
- ✅ **홈 화면 추가**: 모바일 기기에 앱처럼 설치
- ✅ **빠른 로딩**: Service Worker를 통한 캐싱
- ✅ **푸시 알림 준비**: 알림 기능 구현 가능 (선택사항)

## 📲 모바일에 앱 설치하기

### iOS (iPhone/iPad)
1. Safari 브라우저로 앱 접속
2. 하단 공유 버튼 (□↑) 탭
3. "홈 화면에 추가" 선택
4. "추가" 버튼 탭
5. 홈 화면에 앱 아이콘이 생성됩니다!

### Android
1. Chrome 브라우저로 앱 접속
2. 우측 상단 메뉴 (⋮) 탭
3. "홈 화면에 추가" 또는 "앱 설치" 선택
4. "설치" 버튼 탭
5. 홈 화면에 앱 아이콘이 생성됩니다!

### 데스크톱 (Chrome/Edge)
1. 주소창 우측의 설치 아이콘 (⊕) 클릭
2. "설치" 버튼 클릭
3. 독립 창으로 앱이 실행됩니다!

## 🚀 개발 및 빌드

### 개발 서버 실행
```bash
cd smart-home-iot/iot-monitoring/frontend/iot-dashboard
npm start
```

### 프로덕션 빌드
```bash
npm run build
```

빌드된 파일은 `build/` 폴더에 생성됩니다.

### 프로덕션 서버에서 실행
```bash
# 빌드 후
npx serve -s build -l 3000
```

## 🔧 PWA 설정 파일

### manifest.json
- 앱 이름, 아이콘, 테마 색상 등 설정
- 위치: `public/manifest.json`

### Service Worker
- 오프라인 캐싱 및 백그라운드 동기화
- 위치: `public/service-worker.js`

### Service Worker 등록
- 자동 등록 및 업데이트 처리
- 위치: `src/serviceWorkerRegistration.js`

## 📝 주요 기능

### 실시간 모니터링
- 온습도 센서 데이터
- 소음 측정 및 노이즈 캔슬링
- 공기질 (PM2.5, PM10)
- PDLC 필름 제어

### 데이터 시각화
- 24시간 온습도 추이 차트
- 60분 소음 레벨 차트
- 24시간 미세먼지 추이 차트
- 실시간 WebSocket 연결

### 오프라인 기능
- 캐시된 데이터로 앱 실행
- 네트워크 복구 시 자동 동기화
- 오프라인 상태 표시

## 🎯 브라우저 지원

- ✅ Chrome (Android/Desktop)
- ✅ Edge (Desktop)
- ✅ Safari (iOS/macOS)
- ✅ Firefox (Android/Desktop)
- ✅ Samsung Internet

## 🔐 HTTPS 요구사항

PWA는 보안을 위해 HTTPS 연결이 필요합니다:
- 개발 환경: `localhost`는 자동으로 허용
- 프로덕션: SSL 인증서 필요 (Let's Encrypt 무료 사용 가능)

## 📊 성능 최적화

- Service Worker를 통한 정적 리소스 캐싱
- API 요청은 Network First 전략 (실시간 데이터 우선)
- 이미지 및 폰트 최적화
- Code Splitting 적용

## 🐛 문제 해결

### Service Worker가 등록되지 않을 때
```bash
# 브라우저 개발자 도구 > Application > Service Workers
# "Unregister" 후 페이지 새로고침
```

### 캐시 문제
```bash
# 브라우저 개발자 도구 > Application > Storage
# "Clear site data" 클릭
```

### 업데이트가 반영되지 않을 때
- 브라우저 캐시 삭제
- Service Worker Unregister
- 하드 리프레시 (Ctrl+Shift+R 또는 Cmd+Shift+R)

## 📚 추가 리소스

- [PWA 공식 문서](https://web.dev/progressive-web-apps/)
- [Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
- [Web App Manifest](https://developer.mozilla.org/en-US/docs/Web/Manifest)

## 💡 팁

1. **앱 업데이트**: 새 버전이 있을 때 자동으로 알림이 표시됩니다
2. **오프라인 사용**: 한 번 방문하면 오프라인에서도 앱을 열 수 있습니다
3. **빠른 접근**: 홈 화면 아이콘으로 바로 실행 가능
4. **전체 화면**: 브라우저 UI 없이 네이티브 앱처럼 실행됩니다

---

**즐거운 스마트홈 모니터링 되세요! 🏠✨**
