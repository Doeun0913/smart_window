from machine import Pin, I2S
import math
import array
import time

# ==========================================
# 1. 핀 설정 (사용자 지정: 10, 11, 12)
# ==========================================
# DAC 핀 매핑
SCK_PIN = Pin(10)  # DAC BCK
WS_PIN  = Pin(11)  # DAC LCK
SD_PIN  = Pin(12)  # DAC DIN

print("🔊 하드웨어 테스트 시작!")
print("핀 설정: BCK=GP10, LCK=GP11, DIN=GP12")

# ==========================================
# 2. I2S 초기화 (STEREO 모드)
# ==========================================
try:
    audio_out = I2S(
        0,
        sck=SCK_PIN,
        ws=WS_PIN,
        sd=SD_PIN,
        mode=I2S.TX,
        bits=16,
        format=I2S.STEREO, # 두 개 다 울리기 위해 스테레오
        rate=22050,
        ibuf=2000
    )
except Exception as e:
    print("❌ I2S 초기화 실패! 핀 번호를 확인하세요.")
    print(e)
    raise

# ==========================================
# 3. 200Hz 소리 데이터 만들기
# ==========================================
RATE = 22050
FREQ = 200
SAMPLES = int(RATE / FREQ) # 약 110개

# 16비트 최대 볼륨 (32767)에 가까운 값
VOLUME = 32000 

# 버퍼 생성 (L, R 두 채널이므로 크기는 2배)
wave_buf = array.array('h', [0] * (SAMPLES * 2))

for i in range(SAMPLES):
    # 사인파 계산
    val = int(VOLUME * math.sin(2 * math.pi * i / SAMPLES))
    
    # 왼쪽(L)과 오른쪽(R)에 똑같은 값 넣기 (Dual Mono)
    wave_buf[2*i]     = val  # Left
    wave_buf[2*i + 1] = val  # Right

print(f"🎵 200Hz 톤 재생 중... (진동자를 만져보세요)")
print("멈추려면 정지 버튼(STOP)을 누르세요.")

# ==========================================
# 4. 무한 재생
# ==========================================
try:
    while True:
        # 만들어둔 파형을 계속 쏘기
        audio_out.write(wave_buf)
        
except KeyboardInterrupt:
    print("\n테스트 종료.")
    audio_out.deinit()
