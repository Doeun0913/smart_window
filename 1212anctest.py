import serial
import struct
import matplotlib.pyplot as plt
import matplotlib.animation as animation
from collections import deque
import threading
import numpy as np
import sounddevice as sd

# ==========================================
# 1. 설정 (본인 환경에 맞게 수정)
# ==========================================
COM_PORT = 'COM4'      # ★포트 확인 필수★
BAUD_RATE = 115200
MAX_SAMPLES = 200      # 데이터 개수
TARGET_FREQ = 100      # ★목표 주파수 (Hz)★

# ANC 제어 변수 (전역 변수)
user_amp = 0.0         # 소리 크기 (0.0 ~ 1.0)
user_phase = 0.0       # 위상 (타이밍)

# ==========================================
# 2. 오디오 출력 (노트북 -> 앰프)
# ==========================================
# 이 부분은 그래프와 완전히 따로 놉니다 (방해 X)
def audio_callback(outdata, frames, time_info, status):
    global user_phase, user_amp
    
    # 시간 흐름 계산
    t = (np.arange(frames) + audio_callback.t) / 44100
    audio_callback.t += frames
    
    # 사인파 생성 (ANC 핵심)
    wave = user_amp * np.sin(2 * np.pi * TARGET_FREQ * t + user_phase)
    outdata[:] = wave.reshape(-1, 1)

audio_callback.t = 0
# 오디오 시작
stream = sd.OutputStream(channels=1, callback=audio_callback, samplerate=44100)
stream.start()

# ==========================================
# 3. 데이터 저장소 (Deque) - 님 코드 그대로
# ==========================================
data_mic1 = deque([0] * MAX_SAMPLES, maxlen=MAX_SAMPLES)
data_mic2 = deque([0] * MAX_SAMPLES, maxlen=MAX_SAMPLES)

# ==========================================
# 4. 시리얼 읽기 (쓰레드) - 님 코드 그대로 + 안전장치
# ==========================================
def read_serial():
    try:
        ser = serial.Serial(COM_PORT, BAUD_RATE)
        ser.reset_input_buffer() # ★시작 전 찌꺼기 데이터 제거 (중요)★
        print(f"✅ {COM_PORT} 연결 성공! 그래프 창을 클릭하세요.")
    except Exception as e:
        print(f"❌ 연결 실패: {e}")
        return

    while True:
        try:
            if ser.in_waiting >= 4:
                packet = ser.read(4)
                val1, val2 = struct.unpack('>HH', packet)
                
                # 데이터 변환
                data_mic1.append(val1 - 32768)
                data_mic2.append(val2 - 32768)
        except:
            break

t = threading.Thread(target=read_serial, daemon=True)
t.start()

# ==========================================
# 5. 그래프 & 키보드 컨트롤
# ==========================================
fig, ax = plt.subplots(figsize=(10, 6))
line1, = ax.plot([], [], label='Noise (Mic 1)', color='red', linewidth=1)
line2, = ax.plot([], [], label='Result (Mic 2)', color='blue', linewidth=1)

ax.set_ylim(-40000, 40000)
ax.set_xlim(0, MAX_SAMPLES)
ax.set_title("ANC Real-time Control")
ax.legend(loc='upper right')
ax.grid(True)

# ★ 키보드 입력 (그래프 창 클릭 필수) ★
def on_key_press(event):
    global user_amp, user_phase
    
    if event.key == 'up':    user_amp = min(1.0, user_amp + 0.05)
    if event.key == 'down':  user_amp = max(0.0, user_amp - 0.05)
    if event.key == 'left':  user_phase -= 0.1
    if event.key == 'right': user_phase += 0.1

fig.canvas.mpl_connect('key_press_event', on_key_press)

def update(frame):
    # 님 코드 방식 그대로 사용 (가장 빠름)
    line1.set_ydata(data_mic1)
    line1.set_xdata(range(len(data_mic1)))
    
    line2.set_ydata(data_mic2)
    line2.set_xdata(range(len(data_mic2)))
    
    # 상태 표시
    ax.set_xlabel(f"GAIN: {user_amp:.2f} | PHASE: {user_phase:.1f} rad", fontsize=12, color='green')
    
    return line1, line2

# 실행
ani = animation.FuncAnimation(fig, update, interval=20, blit=False)
plt.show()

# 종료
stream.stop()
stream.close()
