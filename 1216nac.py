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
# 1. 시스템 설정
# ==========================================
COM_PORT = 'COM4'       # 포트 번호 확인 필요
BAUD_RATE = 115200
SAMPLE_RATE = 6300
FFT_SAMPLES = 6300

# ★ 에러 수정: int()로 형변환 안 해도 되게 정수로 선언
MAX_SAMPLES = 150       
TARGET_FREQ = 198.2     # 목표 주파수

# ==========================================
# 2. 제어 변수
# ==========================================
w_gain = 0.0
w_phase = 0.0

is_running_anc = False
baseline_noise = 1e-6

# 기본 게인 (처음 시작할 때만 사용됨)
FIXED_GAIN = 0.03

# ==========================================
# 3. 오디오 출력 (SoundDevice Callback)
# ==========================================
def audio_callback(outdata, frames, time_info, status):
    global w_phase, w_gain, TARGET_FREQ
    
    t = (np.arange(frames) + audio_callback.t) / 44100
    audio_callback.t += frames
    
    # 사인파 생성
    wave = w_gain * np.sin(2 * np.pi * TARGET_FREQ * t + w_phase)
    outdata[:] = wave.reshape(-1, 1)

audio_callback.t = 0
stream = sd.OutputStream(channels=1, callback=audio_callback, samplerate=44100, blocksize=512)
stream.start()

# ==========================================
# 4. 데이터 수집 (Serial Thread)
# ==========================================
# ★ 에러 수정: int(MAX_SAMPLES)로 확실하게 처리
data_mic1 = deque([0] * int(MAX_SAMPLES), maxlen=int(MAX_SAMPLES))
data_mic2 = deque([0] * int(MAX_SAMPLES), maxlen=int(MAX_SAMPLES))

fft_buffer = deque([0] * FFT_SAMPLES, maxlen=FFT_SAMPLES)
error_buffer_signed = deque([0] * int(SAMPLE_RATE * 0.5), maxlen=int(SAMPLE_RATE * 0.5))

def read_serial():
    try:
        ser = serial.Serial(COM_PORT, BAUD_RATE)
        ser.reset_input_buffer()
        print(f"✅ {COM_PORT} 연결 성공!")
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
                error_buffer_signed.append(v2)
        except:
            break

t = threading.Thread(target=read_serial, daemon=True)
t.start()

# ==========================================
# 5. RMS 측정 함수
# ==========================================
def get_rms_noise():
    samples = np.array(list(error_buffer_signed))
    if len(samples) == 0: return 0
    return np.sqrt(np.mean(samples**2)) + 1e-6

def get_current_reduction(baseline):
    current = get_rms_noise()
    if baseline < 1e-5:
        return 0.0
    return 20 * np.log10(current / baseline)

# ==========================================
# 6. 실시간 추적 ANC (게인 유지 기능 적용)
# ==========================================
def run_tracking_anc():
    global w_phase, w_gain, is_running_anc, baseline_noise
    
    print("\n⚡ [Real-time Tracking ANC] 시작")
    print("   - 사용자 수동 게인 유지 모드")
    print("   - 목표: -4dB 안정적 감소")
    
    # [핵심 수정] 사용자가 설정해둔 현재 게인 값을 저장해둡니다.
    saved_user_gain = w_gain
    
    # 만약 현재 0이라면(처음 켰을 때), 기본값(FIXED_GAIN)을 사용하도록 설정
    if saved_user_gain < 0.01:
        saved_user_gain = FIXED_GAIN

    # 1. 기준 소음 측정 (정확한 측정을 위해 잠시 음소거)
    print("   -> 기준 소음 측정 중 (Mute)...")
    w_gain = 0.0
    time.sleep(0.7)
    baseline_noise = get_rms_noise()
    print(f"📢 기준 소음: {int(baseline_noise)}")
    
    # [핵심 수정] 측정이 끝났으니 사용자가 쓰던 게인으로 복구합니다.
    w_gain = saved_user_gain
    print(f"🔊 게인 복구됨: {w_gain:.3f}")

    # 성공 기준: -4dB 감소 (약 0.63배)
    success_threshold = baseline_noise * 0.63
    
    while is_running_anc:
        print(f"\n🔄 스캔 사이클 시작 (현재 게인: {w_gain:.3f} 유지)")
        
        # --- Phase 1: 빠른 위상 스캔 ---
        # (여기서 w_gain을 초기화하는 코드를 삭제했으므로, 사용자가 조절한 값이 유지됨)
        
        best_phase = 0.0
        min_noise = 99999999.0
        
        # 빠른 스캔 (0.15 라디안 간격)
        phase_scan = np.arange(0, 2 * np.pi, 0.15)
        
        for p in phase_scan:
            if not is_running_anc: break
            w_phase = p
            time.sleep(0.06)
            
            curr = get_rms_noise()
            if curr < min_noise:
                min_noise = curr
                best_phase = p
        
        # --- Phase 2: 정밀 스캔 ---
        fine_range = np.linspace(best_phase - 0.25, best_phase + 0.25, 12)
        
        for p in fine_range:
            if not is_running_anc: break
            w_phase = p % (2 * np.pi)
            time.sleep(0.06)
            
            curr = get_rms_noise()
            if curr < min_noise:
                min_noise = curr
                best_phase = p % (2 * np.pi)
        
        # --- Phase 3: 고정 (Lock) ---
        w_phase = best_phase
        time.sleep(0.5)
        
        locked_noise = get_rms_noise()
        reduction_db = 20 * np.log10(locked_noise / baseline_noise)
        
        print(f"🔒 고정: Phase={best_phase:.2f}, RMS={int(locked_noise)} ({reduction_db:.1f}dB)")
        
        # 실패 시 재스캔 (게인은 그대로 유지)
        if locked_noise > success_threshold:
            print(f"   ⚠️ 효과 부족. 재시도...")
            time.sleep(0.3)
            continue
        
        print(f"   ✅ 성공! 모니터링 시작")
        
        # --- Phase 4: 실시간 모니터링 & 미세 조정 ---
        last_check = time.time()
        check_interval = 0.5  # 0.5초마다 체크
        
        # 임계값 설정
        maintain_threshold = locked_noise * 1.10  # +0.8dB 허용
        warning_threshold = locked_noise * 1.15   # +1.2dB 경고
        amplify_threshold = locked_noise * 1.30   # +2.3dB면 즉시 재스캔
        
        consecutive_warnings = 0
        
        while is_running_anc:
            current_noise = get_rms_noise()
            
            # 1. 심각한 증폭 발생 시 -> 즉시 재스캔
            if current_noise > amplify_threshold:
                print(f"🚨 심각한 증폭! {int(current_noise)} > {int(amplify_threshold)} -> 재스캔")
                break
            
            # 2. 경고 누적 시 -> 재스캔
            if current_noise > warning_threshold:
                consecutive_warnings += 1
                if consecutive_warnings >= 3:
                    print(f"⚠️ 3회 경고 누적 -> 재스캔")
                    break
            else:
                consecutive_warnings = 0
            
            # 3. 정기 미세 조정 (Tracking)
            if time.time() - last_check > check_interval:
                old_noise = current_noise
                
                # 현재 위상 주변을 살짝 찔러봄
                test_phases = [
                    w_phase - 0.04,
                    w_phase - 0.02,
                    w_phase,
                    w_phase + 0.02,
                    w_phase + 0.04
                ]
                test_results = []
                
                for tp in test_phases:
                    w_phase = tp % (2 * np.pi)
                    time.sleep(0.04)
                    test_results.append(get_rms_noise())
                
                best_idx = np.argmin(test_results)
                new_noise = test_results[best_idx]
                
                # 2% 이상 개선되면 이동
                if new_noise < old_noise * 0.98:
                    w_phase = test_phases[best_idx] % (2 * np.pi)
                    improvement = 20 * np.log10(new_noise / old_noise)
                    print(f"🔧 미세 조정: {improvement:.2f}dB (Phase: {w_phase:.2f})")
                else:
                    w_phase = test_phases[2]  # 원래 위치 유지
                
                last_check = time.time()
            
            time.sleep(0.08)
    
    # 종료 시 게인 0 (안전)
    w_gain = 0.0
    print("\n🛑 ANC 종료.")

# 주파수 자동 탐지
def run_auto_freq_detect():
    global TARGET_FREQ
    print("\n🔍 주파수 분석 중...")
    candidates = []
    for i in range(5):
        samples = list(fft_buffer)
        if len(samples) < FFT_SAMPLES:
            time.sleep(0.3)
            continue
        
        fft_vals = np.fft.fft(samples)
        freqs = np.fft.fftfreq(len(samples), 1/SAMPLE_RATE)
        mags = np.abs(fft_vals)[:len(samples)//2]
        
        start_idx = int(30 * len(samples) / SAMPLE_RATE)
        peak_idx = np.argmax(mags[start_idx:]) + start_idx
        candidates.append(int(round(freqs[peak_idx])))
        time.sleep(0.2)
    
    if candidates:
        TARGET_FREQ = float(Counter(candidates).most_common(1)[0][0])
        print(f"🎯 타겟 주파수: {TARGET_FREQ} Hz")

# ==========================================
# 7. 시각화 및 키보드 제어
# ==========================================
fig, ax = plt.subplots(figsize=(10, 6))
line1, = ax.plot([], [], label='Input (Mic 1)', color='red', alpha=0.5)
line2, = ax.plot([], [], label='Output (Mic 2)', color='blue', linewidth=1.5)

ax.set_ylim(-40000, 40000)
ax.set_xlim(0, MAX_SAMPLES)
ax.set_title("ANC: User Gain Control Mode")
ax.legend(loc='upper right')
ax.grid(True)

def on_key_press(event):
    global w_gain, w_phase, TARGET_FREQ, is_running_anc
    
    # 게인 조절 (사용자가 직접 함)
    if event.key == 'up':    w_gain = min(0.50, w_gain + 0.01) # 최대 0.5까지
    if event.key == 'down':  w_gain = max(0.0, w_gain - 0.01)
    
    # 위상 수동 조절
    if event.key == 'left':  w_phase -= 0.05
    if event.key == 'right': w_phase += 0.05
    
    # 주파수 수동 조절
    if event.key == 'w': TARGET_FREQ += 0.1
    if event.key == 'e': TARGET_FREQ -= 0.1
    
    # 자동 주파수 탐지
    if event.key == 'a':
        threading.Thread(target=run_auto_freq_detect, daemon=True).start()
    
    # ANC 토글 (T 키)
    if event.key == 't':
        if is_running_anc:
            is_running_anc = False
        else:
            is_running_anc = True
            threading.Thread(target=run_tracking_anc, daemon=True).start()

fig.canvas.mpl_connect('key_press_event', on_key_press)

def update(frame):
    # 그래프 업데이트
    line1.set_ydata(data_mic1)
    line1.set_xdata(range(len(data_mic1)))
    line2.set_ydata(data_mic2)
    line2.set_xdata(range(len(data_mic2)))
    
    # 상태 텍스트
    try:
        db_change = get_current_reduction(baseline_noise) if is_running_anc else 0.0
        
        if is_running_anc:
            if db_change < -3.0:
                status = "🟢 LOCKED"
                col = "green"
            elif db_change < -1.0:
                status = "🟡 TRACKING"
                col = "orange"
            else:
                status = "🔴 SEARCHING"
                col = "red"
        else:
            status = "⚫ OFF"
            col = "black"
    except:
        db_change = 0.0
        status = "⚫ OFF"
        col = "black"
    
    current_rms = get_rms_noise()
    info_text = (f"FREQ: {TARGET_FREQ:.1f}Hz | GAIN: {w_gain:.3f} | PHASE: {w_phase:.2f}\n"
                 f"[{status}]  Reduction: {db_change:.1f} dB | RMS: {int(current_rms)}")
    
    ax.set_xlabel(info_text, fontsize=11, color=col, fontweight='bold')
    return line1, line2

ani = animation.FuncAnimation(fig, update, interval=20, blit=False)
plt.show()

stream.stop()
stream.close()
