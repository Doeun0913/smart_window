# ANC System Configuration
# 이 파일을 환경에 맞게 수정하세요

# Serial Port 설정
# Windows: COM4, COM5 등
# Linux/Raspberry Pi: /dev/ttyACM0, /dev/ttyUSB0 등
COM_PORT = "/dev/ttyACM0"

# API 서버 설정
# 같은 라즈베리파이에서 실행 시: http://localhost:3001/api
# 다른 컴퓨터에서 실행 시: http://라즈베리파이IP:3001/api
API_BASE_URL = "http://localhost:3001/api"

# 데이터 전송 주기 (초)
API_SEND_INTERVAL = 2.0

# 디바이스 ID (백엔드에서 식별용)
DEVICE_ID = "raspberry-pi-01"

# 오디오 설정
SAMPLE_RATE = 6300
TARGET_FREQ = 198.2

# ADC 설정 (Pico의 16비트 ADC)
ADC_BITS = 16
ADC_MAX = 65535
ADC_MID = 32768
