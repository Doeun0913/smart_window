# 🔊 ANC System with IoT Dashboard Integration

Active Noise Cancellation 시스템과 Smart Home IoT 대시보드 연동

## 📋 개요

이 시스템은 라즈베리파이 Pico에서 두 개의 마이크로 소음을 측정하고,
실시간으로 노이즈 캔슬링을 수행하면서 데이터를 IoT 대시보드로 전송합니다.

### 구성요소

1. **Pico (main.py)**: 2채널 마이크 데이터 수집 및 시리얼 전송
2. **PC/라즈베리파이 (anc_with_api.py)**: ANC 처리 및 API 전송
3. **백엔드 (localhost:3001)**: 데이터 저장 (PostgreSQL)
4. **프론트엔드 (localhost:3000)**: 대시보드 시각화

## 🚀 설치 및 실행

### 1. Python 패키지 설치

```bash
cd /home/user/smart-home-iot/iot-monitoring/anc_system
pip install -r requirements.txt
```

### 2. 백엔드 서버 실행 (필수)

```bash
cd /home/user/smart-home-iot/iot-monitoring/backend
node server.js
```

### 3. 프론트엔드 실행 (선택)

```bash
cd /home/user/smart-home-iot/iot-monitoring/frontend/iot-dashboard
npm start
```

### 4. ANC 시스템 실행

```bash
cd /home/user/smart-home-iot/iot-monitoring/anc_system
python anc_with_api.py
```

## 🎮 조작 방법

| 키 | 기능 |
|---|---|
| ↑/↓ | 게인 조절 (+/- 0.01) |
| ←/→ | 위상 조절 (+/- 0.05 rad) |
| W/E | 주파수 조절 (+/- 0.1 Hz) |
| A | 자동 주파수 탐지 |
| T | ANC 시작/중지 토글 |
| S | API 전송 활성화/비활성화 |

## 📊 데이터 흐름

```
[Pico]              [PC/Pi]                    [Backend]         [Dashboard]
Mic1 + Mic2  ---->  anc_with_api.py  ---->  /api/sensor/noise  ---->  소음 차트
(Serial)            (HTTP POST)              (PostgreSQL)         (실시간 표시)
```

## 🔧 설정

### COM 포트 변경

`anc_with_api.py` 파일에서:
```python
# Windows
COM_PORT = 'COM4'

# Linux/Raspberry Pi
COM_PORT = '/dev/ttyACM0'
```

### API 서버 주소 변경

```python
# 같은 컴퓨터
API_BASE_URL = 'http://localhost:3001/api'

# 라즈베리파이 IP
API_BASE_URL = 'http://192.168.1.100:3001/api'
```

### 전송 주기 변경

```python
API_SEND_INTERVAL = 2.0  # 초 단위
```

## 📈 API 엔드포인트

### POST /api/sensor/noise

소음 데이터를 저장합니다.

**Request Body:**
```json
{
  "original_db": 65.5,
  "cancelled_db": 42.3,
  "device_id": "raspberry-pi-01"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": 123,
    "device_id": "raspberry-pi-01",
    "original_db": 65.5,
    "cancelled_db": 42.3,
    "reduction_db": 23.2,
    "recorded_at": "2024-12-16T12:00:00.000Z"
  }
}
```

## 🐛 문제 해결

### 1. API 연결 실패
- 백엔드 서버가 실행 중인지 확인
- `curl http://localhost:3001/api/health` 로 테스트

### 2. 시리얼 연결 실패
- Pico가 연결되어 있는지 확인
- COM 포트 번호 확인 (장치 관리자 또는 `ls /dev/tty*`)

### 3. 대시보드에 데이터가 안 보임
- 백엔드 콘솔에서 데이터 수신 로그 확인
- 브라우저 새로고침 (Ctrl+F5)

## 📝 Pico 코드 (main.py)

라즈베리파이 Pico에 업로드할 코드:

```python
import machine
import sys
import struct

mic1 = machine.ADC(28)
mic2 = machine.ADC(27)

while True:
    val1 = mic1.read_u16()
    val2 = mic2.read_u16()
    packet = struct.pack('>HH', val1, val2)
    sys.stdout.buffer.write(packet)
```

## 📜 라이선스

MIT License
