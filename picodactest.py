from machine import I2S, Pin
import array
import math
import time

# ==========================================
# 1. DAC 설정 (PCM5102 등)
# ==========================================
# 핀 설정 (원하는 대로 변경 가능)
SCK_PIN = Pin(10)  # BCK
WS_PIN = Pin(11)   # LCK / LRC
SD_PIN = Pin(12)   # DIN / DATA

# I2S 초기화 (표준 오디오 규격)
audio_out = I2S(
    0,
    sck=SCK_PIN,
    ws=WS_PIN,
    sd=SD_PIN,
    mode=I2S.TX,
    bits=16,
    format=I2S.MONO, # 진동자 하나면 MONO
    rate=22050,      # 샘플링 레이트
    ibuf=2000        # 버퍼 크기
)

# ==========================================
# 2. 소리 만들기 (Sine Wave)
# ==========================================
def make_tone(freq, rate):
    # 1주기 동안의 샘플 개수
    samples_per_cycle = rate // freq
    buffer = array.array("h", [0] * samples_per_cycle)
    
    # 16비트(-32768 ~ 32767) 범위로 사인파 생성
    volume = 32000 # 최대 볼륨에 가까움
    
    for i in range(samples_per_cycle):
        buffer[i] = int(volume * math.sin(2 * math.pi * i / samples_per_cycle))
        
    return buffer

# 200Hz 소리 데이터 생성
tone_data = make_tone(200, 22050)

print("🔊 DAC 테스트 시작! (I2S Mode)")
print("진동자가 부드럽고 강하게 울려야 합니다.")

# ==========================================
# 3. 재생 (무한 반복)
# ==========================================
try:
    while True:
        # 버퍼에 있는 데이터를 DAC로 전송 (하드웨어가 알아서 함)
        audio_out.write(tone_data)

except KeyboardInterrupt:
    audio_out.deinit()
    print("종료")
