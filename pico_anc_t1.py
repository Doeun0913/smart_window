from machine import I2S, Pin
import array
import time

# -----------------------------
# 설정값
# -----------------------------
SAMPLE_RATE = 16000
SAMPLE_BITS = 16
BUFFER_LENGTH = 1024  # 입력/출력 버퍼 샘플 수

# -----------------------------
# I2S 입력 (I2S Microphone)
# -----------------------------
audio_in = I2S(
    0,
    sck=Pin(18),     # BCLK
    ws=Pin(19),      # LRCLK
    sd=Pin(20),      # DOUT from mic
    mode=I2S.RX,
    bits=SAMPLE_BITS,
    format=I2S.MONO,
    rate=SAMPLE_RATE,
    ibuf=BUFFER_LENGTH * 2
)

# -----------------------------
# I2S 출력 (PCM5102A DAC)
# -----------------------------
audio_out = I2S(
    1,
    sck=Pin(22),     # DAC BCLK
    ws=Pin(21),      # DAC LRCLK
    sd=Pin(23),      # DAC DATA
    mode=I2S.TX,
    bits=SAMPLE_BITS,
    format=I2S.MONO,
    rate=SAMPLE_RATE,
    ibuf=BUFFER_LENGTH * 2
)

# 입력/출력 버퍼
in_buf = array.array('h', [0] * BUFFER_LENGTH)
out_buf = array.array('h', [0] * BUFFER_LENGTH)

print("I2S 마이크 → 역위상 출력 시작")

while True:
  
    # 마이크에서 샘플 읽기
    num_read = audio_in.readinto(in_buf)

    if num_read > 0:

        # -------------------------------
        # 1) 역위상 생성 (반대 부호)
        # -------------------------------
        for i in range(BUFFER_LENGTH):
            out_buf[i] = -in_buf[i]   # 반대 위상

        # -------------------------------
        # 2) I2S DAC로 출력
        # -------------------------------
        audio_out.write(out_buf)

    # time.sleep() 사용하면 지연 생김 → 제거
