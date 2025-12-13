import serial
import struct
import matplotlib.pyplot as plt
import matplotlib.animation as animation
from collections import deque
import threading
import numpy as np
import sounddevice as sd

# ==========================================
# 1. 설정
# ==========================================
COM_PORT = 'COM4'      # ★포트 확인★
BAUD_RATE = 115200
MAX_SAMPLES = 200      # 그래프용 (짧음)
FFT_SAMPLES = 44100    # ★자동 분석용 (1초 분량 데이터 모음)★
SAMPLE_RATE = 44100

TARGET_FREQ = 100.0    # 초기값

user_amp = 0.0         
user_phase = 0.0       

# ==========================================
# 2. 오디오 출력
# ==========================================
def audio_callback(outdata, frames, time_info, status):
    global user_phase, user_amp, TARGET_FREQ
    t = (np.arange(frames) + audio_callback.t) / SAMPLE_RATE
    audio_callback.t += frames
    
    # 주파수가 바뀌면 즉시 반영됨
    wave = user_amp * np.sin(2 * np.pi * TARGET_FREQ * t + user_phase)
    outdata[:] = wave.reshape(-1, 1)

audio_callback.t = 0
stream = sd.OutputStream(channels=1, callback=audio_callback, samplerate=SAMPLE_RATE)
stream.start()

# ==========================================
# 3. 데이터 저장소
# ==========================================
data_mic1 = deque([0] * MAX_SAMPLES, maxlen=MAX_SAMPLES)
data_mic2 = deque([0] * MAX_SAMPLES, maxlen=MAX_SAMPLES)

# ★주파수 분석을 위한 긴 버퍼 (1초 분량)★
fft_buffer = deque([0] * FFT_SAMPLES, maxlen=FFT_SAMPLES)

# ==========================================
# 4. 시리얼 읽기
# ==========================================
def read_serial():
    try:
        ser = serial.Serial(COM_PORT, BAUD_RATE)
        ser.reset_input_buffer()
        print(f"✅ {COM_PORT} 연결 성공! 하얀 창을 클릭하세요.")
    except Exception as e:
        print(f"❌ 연결 실패: {e}")
        return

    while True:
        try:
            if ser.in_waiting >= 4:
                packet = ser.read(4)
                val1, val2 = struct.unpack('>HH', packet)
                
                v1 = val1 - 32768
                v2 = val2 - 32768
                
                # 그래프용 데이터
                data_mic1.append(v1)
                data_mic2.append(v2)
                
                # ★자동 분석용 데이터에도 추가★
                fft_buffer.append(v1)
        except:
            break

t = threading.Thread(target=read_serial, daemon=True)
t.start()

# ==========================================
# 5. 자동 주파수 분석 함수 (핵심!)
# ==========================================
def auto_tune_frequency():
    global TARGET_FREQ
    print("running auto detection...")
    
    # 1. 현재 모인 데이터 가져오기 (리스트로 변환)
    samples = list(fft_buffer)
    if len(samples) < FFT_SAMPLES:
        print("데이터가 부족합니다. 잠시 후 다시 시도하세요.")
        return

    # 2. FFT (주파수 변환) 수행
    # 시간 영역 데이터 -> 주파수 영역 데이터로 변환
    fft_vals = np.fft.fft(samples)
    
    # 3. 주파수 축 생성 (0 ~ 22050Hz)
    freqs = np.fft.fftfreq(len(samples), 1/SAMPLE_RATE)
    
    # 4. 가장 큰 값(가장 시끄러운 주파수) 찾기
    # 양수 주파수 대역만 사용
    positive_freqs = freqs[:len(samples)//2]
    magnitudes = np.abs(fft_vals)[:len(samples)//2]
    
    # 0Hz(DC 성분)나 너무 낮은 노이즈는 무시 (20Hz 이상부터 검색)
    start_index = int(20 * len(samples) / SAMPLE_RATE) 
    
    peak_index = np.argmax(magnitudes[start_index:]) + start_index
    detected_freq = positive_freqs[peak_index]
    
    # 5. 적용
    TARGET_FREQ = float(detected_freq)
    print(f"🎯 자동 감지 완료! 소음 주파수: {TARGET_FREQ:.2f} Hz")

# ==========================================
# 6. 그래프 & 키보드 컨트롤
# ==========================================
fig, ax = plt.subplots(figsize=(10, 6))
line1, = ax.plot([], [], label='Noise (Mic 1)', color='red', linewidth=1, alpha=0.5)
line2, = ax.plot([], [], label='Result (Mic 2)', color='blue', linewidth=1.5)

ax.set_ylim(-40000, 40000)
ax.set_xlim(0, MAX_SAMPLES)
ax.set_title("Auto-Tuning ANC System (Press 'A' for Auto-Detect)")
ax.legend(loc='upper right')
ax.grid(True)

def on_key_press(event):
    global user_amp, user_phase, TARGET_FREQ
    
    # 기존 수동 조작
    if event.key == 'up':    user_amp = min(1.0, user_amp + 0.05)
    if event.key == 'down':  user_amp = max(0.0, user_amp - 0.05)
    if event.key == 'left':  user_phase -= 0.1
    if event.key == 'right': user_phase += 0.1
    
    # 미세 조정 (수동)
    if event.key == 'w': TARGET_FREQ += 0.1
    if event.key == 'e': TARGET_FREQ -= 0.1 # 's'키가 matplotlib 단축키랑 겹칠때가 있어서 'e'로 변경
        
    # ★ 자동 튜닝 키 ★
    if event.key == 'a':
        auto_tune_frequency()

fig.canvas.mpl_connect('key_press_event', on_key_press)

def update(frame):
    line1.set_ydata(data_mic1)
    line1.set_xdata(range(len(data_mic1)))
    line2.set_ydata(data_mic2)
    line2.set_xdata(range(len(data_mic2)))
    
    status_text = (f"FREQ: {TARGET_FREQ:.2f}Hz (Press 'A') | "
                   f"GAIN: {user_amp:.2f} | PHASE: {user_phase:.1f}")
    ax.set_xlabel(status_text, fontsize=12, color='purple', fontweight='bold')
    return line1, line2

ani = animation.FuncAnimation(fig, update, interval=20, blit=False)
plt.show()

stream.stop()
stream.close()
