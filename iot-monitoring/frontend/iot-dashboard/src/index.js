import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import * as serviceWorkerRegistration from './serviceWorkerRegistration';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Service Worker 등록 (PWA 기능 활성화)
serviceWorkerRegistration.register({
  onSuccess: () => {
    console.log('✅ 앱이 오프라인에서도 작동합니다!');
  },
  onUpdate: (registration) => {
    console.log('🔄 새 버전이 있습니다. 새로고침하세요.');
    // 선택사항: 사용자에게 업데이트 알림 표시
    if (window.confirm('새 버전이 있습니다. 지금 업데이트하시겠습니까?')) {
      if (registration && registration.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
      window.location.reload();
    }
  }
});

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
