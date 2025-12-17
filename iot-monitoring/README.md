# 🏠 Smart Home IoT Monitoring System

라즈베리파이 기반 스마트 홈 환경 모니터링 시스템

## 📋 프로젝트 개요

실시간 환경 센서 데이터를 수집하고 웹 대시보드로 모니터링하는 통합 IoT 시스템입니다.

### ✨ 주요 기능

- 🌡️ **온습도 모니터링**: DHT22 센서로 실시간 온도/습도 측정
- 🔊 **소음 측정**: 환경 소음 측정 및 노이즈 캔슬링 효과 분석
- 🌫️ **미세먼지 모니터링**: PM2.5/PM10 농도 실시간 측정
- 💡 **PLDC 조명 제어**: 원격 조명 ON/OFF 제어
- 📊 **데이터 시각화**: 24시간 데이터 그래프 및 통계
- 🔔 **스마트 알림**: 임계값 초과시 자동 알림
- 🌐 **실시간 업데이트**: WebSocket 기반 실시간 데이터 동기화

## 🏗️ 시스템 구조

```
┌─────────────────────┐      ┌─────────────────────┐      ┌─────────────────────┐
│   Raspberry Pi      │────▶│   Backend API       │────▶│   PostgreSQL        │
│   + Sensors         │      │   (Node.js/Express) │      │   Database          │
│   (Python)          │      │   + WebSocket       │      │                     │
└─────────────────────┘      └─────────────────────┘      └─────────────────────┘
                                     │
                                     ▼
                            ┌─────────────────────┐
                            │   React Web App     │
                            │   (Frontend)        │
                            │   + Tailwind CSS    │
                            └─────────────────────┘
```

## 📁 프로젝트 구조

```
smart-home-iot/
├── database/
│   └── schema.sql          # PostgreSQL 스키마
├── backend/
│   ├── server.js           # Express API 서버
│   └── package.json        # 백엔드 의존성
├── frontend/
│   ├── App.jsx             # React 메인 앱
│   └── package.json        # 프론트엔드 의존성
├── raspberry-pi/
│   └── sensor_collector.py # 센서 데이터 수집 스크립트
├── .env.example            # 환경변수 예시
└── README.md
```

## 🚀 설치 및 실행

### ⚡ 빠른 시작 (start.sh 스크립트 사용)

프로젝트에 포함된 `start.sh` 스크립트를 사용하면 모든 모듈을 쉽게 시작할 수 있습니다.

```bash
# 프로젝트 폴더로 이동
cd /home/user/smart-home-iot/iot-monitoring

# 스크립트 실행 권한 부여 (최초 1회)
chmod +x start.sh
```

#### 🎯 주요 명령어

| 명령어 | 설명 |
|--------|------|
| `./start.sh all` | 🚀 **전체 시스템 시작** (Backend + Frontend) |
| `./start.sh backend` | 백엔드 서버만 시작 (포트 3001) |
| `./start.sh frontend` | 프론트엔드만 시작 (포트 3000) |
| `./start.sh sensor` | 라즈베리파이 센서 수집 시작 |
| `./start.sh pdlc` | PDLC 제스처 제어 시작 |
| `./start.sh db-init` | 데이터베이스 초기화 (schema.sql 실행) |
| `./start.sh install` | 모든 의존성 설치 (Backend + Frontend + Python) |
| `./start.sh stop` | 모든 프로세스 종료 |
| `./start.sh status` | 시스템 상태 확인 |
| `./start.sh help` | 도움말 표시 |

#### 📋 전체 시스템 시작 순서 (권장)

```bash
# 1. 의존성 설치 (최초 1회)
./start.sh install

# 2. 데이터베이스 초기화 (최초 1회)
./start.sh db-init

# 3. 전체 시스템 시작 (Backend + Frontend)
./start.sh all

# 4. (선택) 센서 수집 시작 (라즈베리파이에서 실행)
./start.sh sensor

# 5. (선택) PDLC 제스처 제어 시작
./start.sh pdlc
```

#### 🔗 접속 URL

- **Dashboard (프론트엔드)**: http://localhost:3000
- **API (백엔드)**: http://localhost:3001/api
- **WebSocket**: ws://localhost:3001

#### 🛑 시스템 종료

```bash
./start.sh stop
```

---

### 📖 수동 설치 및 실행 (상세)

### 1️⃣ 데이터베이스 설정

```bash
# PostgreSQL 설치 (Ubuntu/Debian)
sudo apt-get update
sudo apt-get install postgresql postgresql-contrib

# 데이터베이스 생성
sudo -u postgres createdb iot_monitoring

# 스키마 적용
sudo -u postgres psql -d iot_monitoring -f database/schema.sql
# 안될 시에
cat /home/user/smart-home-iot/iot-monitoring/database/schema.sql | sudo -u postgres psql -d iot_monitoring
```

### 2️⃣ 백엔드 서버 설정

```bash
cd /home/user/smart-home-iot/iot-monitoring/backend

# 의존성 설치
# NodeSource 저장소 추가 (Node.js 20 LTS)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -

# Node.js 및 npm 설치
sudo apt install -y nodejs

# 설치 확인
node -v
npm -v

# 환경변수 설정
cp ../.env.example .env
# .env 파일 수정 (데이터베이스 정보 입력)

# npm 다운
npm install

# 서버 실행
npm start

# 개발 모드 (자동 재시작)
npm run dev
```

### 3️⃣ 프론트엔드 설정

```bash
# React 앱 생성
npx create-react-app iot-dashboard
cd iot-dashboard

# 필요한 패키지 설치
npm install recharts lucide-react

# Tailwind CSS 설치
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

**tailwind.config.js 수정:**
```javascript
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {},
  },
  plugins: [],
}
```

**src/index.css 맨 위에 추가:**
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

```bash
# App.jsx 파일 복사
cp ../frontend/App.jsx src/App.jsx

# 앱 실행
npm start
```

### 4️⃣ 라즈베리파이 설정

# raspberry-pi 폴더로 이동
cd /home/user/smart-home-iot/iot-monitoring/raspberry-pi

# 가상환경 활성화 (매번 실행 전에)
source venv/bin/activate

# Python 스크립트 실행
python (your_script)sensor_collector.py

# 가상환경 비활성화 (작업 끝날 때)
deactivate

```bash
# 필요한 라이브러리 설치
pip3 install requests
pip3 install adafruit-circuitpython-dht
pip3 install adafruit-circuitpython-pm25
pip3 install RPi.GPIO

# sensor_collector.py 설정 수정
# CONFIG['API_BASE_URL'] = 'http://서버IP:3001/api'
# CONFIG['SIMULATION_MODE'] = False  # 실제 센서 사용시

# 센서 수집 스크립트 실행
python3 sensor_collector.py
```

## 🔌 하드웨어 연결

### GPIO 핀 연결도

```
Raspberry Pi 4
┌──────────────────┐
│ GPIO 4   ────────│──── DHT22 Data Pin
│ GPIO 18  ────────│──── PLDC Relay Control
│ SDA (GPIO 2) ────│──── PM2.5 SDA
│ SCL (GPIO 3) ────│──── PM2.5 SCL
│ 3.3V     ────────│──── Sensor VCC
│ GND      ────────│──── Sensor GND
└──────────────────┘
```

## 📡 API 엔드포인트

### 센서 데이터 조회

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/current` | 현재 센서 상태 |
| GET | `/api/temperature-humidity?hours=24` | 온습도 히스토리 |
| GET | `/api/noise?minutes=60` | 소음 데이터 |
| GET | `/api/air-quality?hours=24` | 미세먼지 히스토리 |

### PLDC 제어

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/pldc/status` | PLDC 상태 조회 |
| POST | `/api/pldc/control` | PLDC 상태 변경 `{state: true/false}` |

### 센서 데이터 저장 (라즈베리파이용)

| Method | Endpoint | Body |
|--------|----------|------|
| POST | `/api/sensor/temperature-humidity` | `{temperature, humidity}` |
| POST | `/api/sensor/noise` | `{original_db, cancelled_db}` |
| POST | `/api/sensor/air-quality` | `{pm25, pm10}` |

### 알림

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/alerts?resolved=false` | 활성 알림 조회 |
| POST | `/api/alerts/:id/resolve` | 알림 해결 |

## ⚙️ 환경변수 (.env)

```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=iot_monitoring
DB_USER=postgres
DB_PASSWORD=your_password

# Server
PORT=3001
CORS_ORIGIN=http://localhost:3000
```

## 🐛 문제 해결

### PostgreSQL 연결 오류
```bash
sudo nano /etc/postgresql/14/main/pg_hba.conf
# local all all md5로 변경
sudo systemctl restart postgresql
```

### 라즈베리파이 GPIO 권한 오류
```bash
sudo usermod -a -G gpio $USER
# 재로그인 필요
```

## 🛠️ 기술 스택

- **Frontend**: React 18, Tailwind CSS, Recharts, Lucide React
- **Backend**: Node.js, Express.js, PostgreSQL, WebSocket
- **Hardware**: Raspberry Pi 4, Python 3, Adafruit Libraries

## 📝 라이선스

MIT License


1) 백엔드 살아있는지
curl http://localhost:3001/api/health
정상: {"status":"healthy"...} / 비정상: 서버 먼저 올리기 (cd /home/user/smart-home-iot/iot-monitoring/backend && npm start 혹은 node server.js)
2) DHT11 수집 확인 (라즈베리 파이에서)
실행: cd /home/user/smart-home-iot/iot-monitoring/raspberry-pi && sudo -E python3 dht_to_db.py
기대 로그: 🌡️ 24.0°C | 💧 45.0% | WS✅
안 보이면:
배선: DHT11 → 3.3V / GND / 데이터는 GPIO4(D4, 물리 7)
패키지: pip3 install adafruit-circuitpython-dht
간헐 오류면 센서 지연: 5회 시도 후 실패 메시지 확인
3) PDLC 제어 확인 (웹 토글 동작 테스트)
라즈베리 파이에서 동기화 스크립트 켜두기:
cd /home/user/smart-home-iot/iot-monitoring/raspberry-pi && sudo -E python3 pdlc_sync.py
대시보드에서 버튼 토글 → 파이 콘솔에 📡 WebSocket: PDLC 상태 변경 수신과 💡 PDLC ON/OFF가 찍히는지 확인.
대시보드 상단 Live 불빛이 빨간/Offline이면 WebSocket 문제 → 백엔드/포트 3001 확인.
4) PDLC 직접 강제 테스트 (CLI)
cd /home/user/smart-home-iot/iot-monitoring/raspberry-pi && sudo -E python3 pdlc_cli.py on
OFF: ... pdlc_cli.py off
여기서도 GPIO가 안 움직이면 하드웨어/권한/라이브러리 이슈.
5) 라즈베리 파이 GPIO 권한/라이브러리
Pi5이면 sudo apt install -y python3-lgpio 후 재시도.
공통: pip3 install gpiozero websocket-client requests
실행은 sudo로 해야 GPIO 접근 가능.
6) DEVICE_ID 맞춤
프런트/백엔드/파이 모두 raspberry-pi-01로 맞춰져 있습니다. 변경했으면 세 군데 동일하게 통일하세요.
7) DB 적재 확인(선택)
curl "http://localhost:3001/api/temperature-humidity/latest?limit=5" 로 새 데이터가 쌓이는지 확인.