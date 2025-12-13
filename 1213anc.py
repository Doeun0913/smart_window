import serial
import struct
import matplotlib.pyplot as plt
import matplotlib.animation as animation
from collections import deque, Counter
import threading
import numpy as np
import sounddevice as sd
import time

# ==========================================
# 1. 설정 (아까 측정한 속도값으로 유지하세요!)
# ==========================================
COM_PORT = 'COM4'      # ★포트 확인★
BAUD_RATE = 115200

# ★아까 check_speed.py로 측정한 실제 속도를 넣으세요 (예: 6300)★
SAMPLE_RATE = 6300     
FFT_SAMPLES = 6300     # 1초치 데이터

MAX_SAMPLES = 200      # 그래프용
TARGET_FREQ = 200.0    # 초기값

user_amp = 0.0         
user_phase = 0.0       

# ==========================================
# 2. 오디오 출력
# ==========================================
def audio_callback(outdata, frames, time_info, status):
    global user_phase, user_amp, TARGET_FREQ
    t = (np.arange(frames) + audio_callback.t) / 44100 # 노트북 출력은 44100 고정 (음질 위해)
    audio_callback.t += frames
    
    # 사인파 생성
    wave = user_amp * np.sin(2 * np.pi * TARGET_FREQ * t + user_phase)
    outdata[:] = wave.reshape(-1, 1)

audio_callback.t = 0
# 노트북 스피커 출력은 44100Hz로 고품질 전송
stream = sd.OutputStream(channels=1, callback=audio_callback, samplerate=44100)
stream.start()

# ==========================================
# 3. 데이터 저장소
# ==========================================
data_mic1 = deque([0] * MAX_SAMPLES, maxlen=MAX_SAMPLES)
data_mic2 = deque([0] * MAX_SAMPLES, maxlen=MAX_SAMPLES)
fft_buffer = deque([0] * FFT_SAMPLES, maxlen=FFT_SAMPLES)
mic2_buffer_for_phase = deque([0] * int(SAMPLE_RATE * 0.5), maxlen=int(SAMPLE_RATE * 0.5)) # 0.5초 분량

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
                
                data_mic1.append(v1)
                data_mic2.append(v2)
                fft_buffer.append(v1)
                mic2_buffer_for_phase.append(abs(v2)) # 절댓값 저장 (소리 크기 계산용)
        except:
            break

t = threading.Thread(target=read_serial, daemon=True)
t.start()

# ==========================================
# 5. 스마트 기능들 (주파수 & 위상 자동화)
# ==========================================

# [기능 1] 주파수 자동 찾기
def run_auto_tune():
    global TARGET_FREQ
    print("\n🔍 주파수 분석 시작...")
    candidates = []
    
    for i in range(5):
        samples = list(fft_buffer)
        if len(samples) < FFT_SAMPLES: 
            time.sleep(0.3)
            continue
            
        fft_vals = np.fft.fft(samples)
        freqs = np.fft.fftfreq(len(samples), 1/SAMPLE_RATE)
        
        pos_freqs = freqs[:len(samples)//2]
        mags = np.abs(fft_vals)[:len(samples)//2]
        
        start_idx = int(30 * len(samples) / SAMPLE_RATE)
        peak_idx = np.argmax(mags[start_idx:]) + start_idx
        detected = pos_freqs[peak_idx]
        
        candidates.append(int(round(detected))) # 정수로 반올림
        print(f"  측정 {i+1}: {int(round(detected))} Hz")
        time.sleep(0.2)
        
    if candidates:
        most_common = Counter(candidates).most_common(1)[0][0]
        TARGET_FREQ = float(most_common)
        print(f"🎯 주파수 확정: {TARGET_FREQ} Hz")
    else:
        print("❌ 실패: 데이터 부족")

# [기능 2] ★위상 자동 튜닝 (Auto-Phase)★
def run_auto_phase():
    global user_phase
    print("\n🌊 위상(Delay) 자동 스캔 시작...")
    print("소리가 커졌다 작아졌다 할 겁니다. 기다리세요!")
    
    original_phase = user_phase
    best_phase = 0.0
    min_noise_level = 99999999.0
    
    # 0 ~ 2pi (약 6.28) 까지 0.3 단위로 훑어봄
    scan_range = np.arange(0, 2 * np.pi, 0.2) 
    
    for p in scan_range:
        user_phase = p # 위상 변경
        time.sleep(0.15) # 0.15초 대기 (반영될 때까지)
        
        # 현재 Mic 2의 평균 소음 크기 계산
        current_noise = np.mean(list(mic2_buffer_for_phase))
        
        # 더 조용한 지점을 발견하면 기록
        if current_noise < min_noise_level:
            min_noise_level = current_noise
            best_phase = p
            
        # 진행 상황 표시 (터미널)
        # print(f"Phase {p:.1f} -> Noise: {int(current_noise)}")

    # 최적의 위치로 복귀
    user_phase = best_phase
    print(f"✨ 최적 위상 발견! : {best_phase:.2f} rad (최소 소음: {int(min_noise_level)})")
    print("------------------------------------------")

# ==========================================
# 6. 그래프 & 키보드
# ==========================================
fig, ax = plt.subplots(figsize=(10, 6))
line1, = ax.plot([], [], label='Noise (Mic 1)', color='red', linewidth=1, alpha=0.5)
line2, = ax.plot([], [], label='Result (Mic 2)', color='blue', linewidth=1.5)

ax.set_ylim(-40000, 40000)
ax.set_xlim(0, MAX_SAMPLES)
ax.set_title("Fully Automated ANC System (Press 'A' then 'P')")
ax.legend(loc='upper right')
ax.grid(True)

def on_key_press(event):
    global user_amp, user_phase, TARGET_FREQ
    
    if event.key == 'up':    user_amp = min(1.0, user_amp + 0.05)
    if event.key == 'down':  user_amp = max(0.0, user_amp - 0.05)
    if event.key == 'left':  user_phase -= 0.1
    if event.key == 'right': user_phase += 0.1
    if event.key == 'w': TARGET_FREQ += 0.1
    if event.key == 'e': TARGET_FREQ -= 0.1
        
    # 자동화 키
    if event.key == 'a':
        threading.Thread(target=run_auto_tune, daemon=True).start()
        
    if event.key == 'p': # ★ Phase Auto ★
        if user_amp == 0:
            print("⚠️ 경고: 소리(Gain)가 0입니다! 'Up' 키로 소리를 먼저 키우세요!")
        else:
            threading.Thread(target=run_auto_phase, daemon=True).start()

fig.canvas.mpl_connect('key_press_event', on_key_press)

def update(frame):
    line1.set_ydata(data_mic1)
    line1.set_xdata(range(len(data_mic1)))
    line2.set_ydata(data_mic2)
    line2.set_xdata(range(len(data_mic2)))
    
    status_text = (f"FREQ: {TARGET_FREQ:.1f}Hz | "
                   f"GAIN: {user_amp:.2f} | PHASE: {user_phase:.2f}")
    ax.set_xlabel(status_text, fontsize=12, color='purple', fontweight='bold')
    return line1, line2

ani = animation.FuncAnimation(fig, update, interval=20, blit=False)
plt.show()

stream.stop()
stream.close()
