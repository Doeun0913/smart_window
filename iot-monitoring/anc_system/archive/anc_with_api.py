#!/usr/bin/env python3
"""
Smart Home IoT - ANC (Active Noise Cancellation) System
실시간 소음 측정 및 API 전송 기능 포함

마이크 데이터를 데시벨로 변환하여 IoT 모니터링 시스템에 전송합니다.
"""

import serial
import struct
import matplotlib.pyplot as plt
import matplotlib.animation as animation
from collections import deque, Counter
import threading
import numpy as np
import sounddevice as sd
import time
import requests
import json

# ==========================================
# 1. 시스템 설정
# ==========================================
COM_PORT = '/dev/ttyACM1'       # 포트 번호 확인 필요 (라즈베리파이에서는 '/dev/ttyACM0' 등)
BAUD_RATE = 115200
SAMPLE_RATE = 6300
FFT_SAMPLES = 6300

# API 설정 - 라즈베리파이 IP 또는 localhost
API_BASE_URL = 'http://localhost:3001/api'  # 백엔드 서버 주소
API_SEND_INTERVAL = 2.0  # 2초마다 API로 데이터 전송

MAX_SAMPLES = 150       
TARGET_FREQ = 198.2     # 목표 주파수

# dB 계산용 기준값 (16비트 ADC 최대값 기준)
DB_REFERENCE = 32768.0  # 16비트 ADC 중간값

# ==========================================
# 2. 제어 변수
# ==========================================
w_gain = 0.0
w_phase = 0.0

is_running_anc = False
baseline_noise = 1e-6

# 기본 게인 (처음 시작할 때만 사용됨)
FIXED_GAIN = 0.03

# API 전송 관련
last_api_send_time = 0
api_send_enabled = True

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
data_mic1 = deque([0] * int(MAX_SAMPLES), maxlen=int(MAX_SAMPLES))
data_mic2 = deque([0] * int(MAX_SAMPLES), maxlen=int(MAX_SAMPLES))

fft_buffer = deque([0] * FFT_SAMPLES, maxlen=FFT_SAMPLES)
error_buffer_signed = deque([0] * int(SAMPLE_RATE * 0.5), maxlen=int(SAMPLE_RATE * 0.5))

# 원본 소음용 버퍼 (Mic1)
original_buffer_signed = deque([0] * int(SAMPLE_RATE * 0.5), maxlen=int(SAMPLE_RATE * 0.5))

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
                original_buffer_signed.append(v1)  # 원본 소음도 저장
        except:
            break

t = threading.Thread(target=read_serial, daemon=True)
t.start()

# ==========================================
# 5. RMS 및 dB 측정 함수
# ==========================================
def get_rms_noise():
    """에러 마이크 (Mic2) RMS 측정"""
    samples = np.array(list(error_buffer_signed))
    if len(samples) == 0: return 0
    return np.sqrt(np.mean(samples**2)) + 1e-6

def get_original_rms():
    """원본 마이크 (Mic1) RMS 측정"""
    samples = np.array(list(original_buffer_signed))
    if len(samples) == 0: return 0
    return np.sqrt(np.mean(samples**2)) + 1e-6

def rms_to_db(rms_value):
    """
    RMS 값을 데시벨(dB SPL 근사치)로 변환
    
    ADC 값을 실제 dB SPL로 변환하려면 마이크 감도 보정이 필요하지만,
    여기서는 상대적인 dB 값을 사용합니다.
    
    일반적인 실내 소음 레벨:
    - 조용한 방: 30-40 dB
    - 일반 대화: 60-70 dB
    - 시끄러운 환경: 80-90 dB
    """
    if rms_value < 1:
        return 0.0
    
    # 16비트 ADC 기준 dB 계산 (0-96 dB 범위)
    # 실제 SPL과 매핑하기 위해 오프셋 조정
    raw_db = 20 * np.log10(rms_value / 1.0)
    
    # ADC 값을 실제 dB SPL 범위로 매핑 (대략적인 보정)
    # RMS 100 -> 약 30dB, RMS 10000 -> 약 80dB
    db_spl = 20 + (raw_db * 0.6)  # 스케일 조정
    
    # 합리적인 범위로 클램핑
    return max(20.0, min(120.0, db_spl))

def get_current_reduction(baseline):
    current = get_rms_noise()
    if baseline < 1e-5:
        return 0.0
    return 20 * np.log10(current / baseline)

# ==========================================
# 6. API 전송 함수
# ==========================================
def send_noise_data_to_api():
    """소음 데이터를 백엔드 API로 전송"""
    global last_api_send_time
    
    if not api_send_enabled:
        return
    
    current_time = time.time()
    if current_time - last_api_send_time < API_SEND_INTERVAL:
        return
    
    try:
        # RMS 값 계산
        original_rms = get_original_rms()
        cancelled_rms = get_rms_noise()
        
        # dB로 변환
        original_db = rms_to_db(original_rms)
        cancelled_db = rms_to_db(cancelled_rms)
        
        # API 요청 데이터
        payload = {
            'original_db': round(original_db, 2),
            'cancelled_db': round(cancelled_db, 2),
            'device_id': 'raspberry-pi-01'
        }
        
        # API 전송 (비동기적으로 처리하기 위해 timeout 설정)
        response = requests.post(
            f'{API_BASE_URL}/sensor/noise',
            json=payload,
            timeout=2.0
        )
        
        if response.status_code == 200:
            result = response.json()
            reduction_db = original_db - cancelled_db
            print(f"📡 API 전송 성공: 원본={original_db:.1f}dB, 상쇄후={cancelled_db:.1f}dB, 감소={reduction_db:.1f}dB")
        else:
            print(f"⚠️ API 전송 실패: {response.status_code}")
            
        last_api_send_time = current_time
        
    except requests.exceptions.ConnectionError:
        print("⚠️ API 서버 연결 실패 (백엔드가 실행 중인지 확인하세요)")
        last_api_send_time = current_time  # 연결 실패 시에도 타이머 리셋
    except Exception as e:
        print(f"⚠️ API 전송 오류: {e}")
        last_api_send_time = current_time

def api_sender_thread():
    """별도 스레드에서 주기적으로 API 전송"""
    while True:
        send_noise_data_to_api()
        time.sleep(0.5)  # 0.5초마다 체크 (실제 전송은 API_SEND_INTERVAL마다)

# API 전송 스레드 시작
api_thread = threading.Thread(target=api_sender_thread, daemon=True)
api_thread.start()

# ==========================================
# 7. 실시간 추적 ANC (게인 유지 기능 적용)
# ==========================================
def run_tracking_anc():
    global w_phase, w_gain, is_running_anc, baseline_noise
    
    print("\n⚡ [Real-time Tracking ANC] 시작")
    print("   - 사용자 수동 게인 유지 모드")
    print("   - 목표: -4dB 안정적 감소")
    
    saved_user_gain = w_gain
    
    if saved_user_gain < 0.01:
        saved_user_gain = FIXED_GAIN

    print("   -> 기준 소음 측정 중 (Mute)...")
    w_gain = 0.0
    time.sleep(0.7)
    baseline_noise = get_rms_noise()
    print(f"📢 기준 소음: {int(baseline_noise)} (약 {rms_to_db(baseline_noise):.1f} dB)")
    
    w_gain = saved_user_gain
    print(f"🔊 게인 복구됨: {w_gain:.3f}")

    success_threshold = baseline_noise * 0.63
    
    while is_running_anc:
        print(f"\n🔄 스캔 사이클 시작 (현재 게인: {w_gain:.3f} 유지)")
        
        best_phase = 0.0
        min_noise = 99999999.0
        
        phase_scan = np.arange(0, 2 * np.pi, 0.15)
        
        for p in phase_scan:
            if not is_running_anc: break
            w_phase = p
            time.sleep(0.06)
            
            curr = get_rms_noise()
            if curr < min_noise:
                min_noise = curr
                best_phase = p
        
        fine_range = np.linspace(best_phase - 0.25, best_phase + 0.25, 12)
        
        for p in fine_range:
            if not is_running_anc: break
            w_phase = p % (2 * np.pi)
            time.sleep(0.06)
            
            curr = get_rms_noise()
            if curr < min_noise:
                min_noise = curr
                best_phase = p % (2 * np.pi)
        
        w_phase = best_phase
        time.sleep(0.5)
        
        locked_noise = get_rms_noise()
        reduction_db = 20 * np.log10(locked_noise / baseline_noise)
        
        print(f"🔒 고정: Phase={best_phase:.2f}, RMS={int(locked_noise)} ({reduction_db:.1f}dB)")
        
        if locked_noise > success_threshold:
            print(f"   ⚠️ 효과 부족. 재시도...")
            time.sleep(0.3)
            continue
        
        print(f"   ✅ 성공! 모니터링 시작")
        
        last_check = time.time()
        check_interval = 0.5
        
        maintain_threshold = locked_noise * 1.10
        warning_threshold = locked_noise * 1.15
        amplify_threshold = locked_noise * 1.30
        
        consecutive_warnings = 0
        
        while is_running_anc:
            current_noise = get_rms_noise()
            
            if current_noise > amplify_threshold:
                print(f"🚨 심각한 증폭! {int(current_noise)} > {int(amplify_threshold)} -> 재스캔")
                break
            
            if current_noise > warning_threshold:
                consecutive_warnings += 1
                if consecutive_warnings >= 3:
                    print(f"⚠️ 3회 경고 누적 -> 재스캔")
                    break
            else:
                consecutive_warnings = 0
            
            if time.time() - last_check > check_interval:
                old_noise = current_noise
                
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
                
                if new_noise < old_noise * 0.98:
                    w_phase = test_phases[best_idx] % (2 * np.pi)
                    improvement = 20 * np.log10(new_noise / old_noise)
                    print(f"🔧 미세 조정: {improvement:.2f}dB (Phase: {w_phase:.2f})")
                else:
                    w_phase = test_phases[2]
                
                last_check = time.time()
            
            time.sleep(0.08)
    
    w_gain = 0.0
    print("\n🛑 ANC 종료.")

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
# 8. 시각화 및 키보드 제어
# ==========================================
fig, ax = plt.subplots(figsize=(10, 6))
line1, = ax.plot([], [], label='Input (Mic 1)', color='red', alpha=0.5)
line2, = ax.plot([], [], label='Output (Mic 2)', color='blue', linewidth=1.5)

ax.set_ylim(-40000, 40000)
ax.set_xlim(0, MAX_SAMPLES)
ax.set_title("ANC: User Gain Control Mode + IoT Dashboard")
ax.legend(loc='upper right')
ax.grid(True)

def on_key_press(event):
    global w_gain, w_phase, TARGET_FREQ, is_running_anc, api_send_enabled
    
    # 게인 조절
    if event.key == 'up':    w_gain = min(0.50, w_gain + 0.01)
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
    
    # API 전송 토글 (S 키)
    if event.key == 's':
        api_send_enabled = not api_send_enabled
        status = "활성화" if api_send_enabled else "비활성화"
        print(f"📡 API 전송: {status}")

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
    
    # dB 값 계산
    original_db = rms_to_db(get_original_rms())
    cancelled_db = rms_to_db(get_rms_noise())
    
    api_status = "📡 ON" if api_send_enabled else "📡 OFF"
    
    info_text = (f"FREQ: {TARGET_FREQ:.1f}Hz | GAIN: {w_gain:.3f} | PHASE: {w_phase:.2f}\n"
                 f"[{status}]  Reduction: {db_change:.1f}dB | 원본: {original_db:.0f}dB | 상쇄: {cancelled_db:.0f}dB | {api_status}")
    
    ax.set_xlabel(info_text, fontsize=11, color=col, fontweight='bold')
    return line1, line2

ani = animation.FuncAnimation(fig, update, interval=20, blit=False)

print("\n" + "="*60)
print("🎮 조작 방법:")
print("   ↑/↓: 게인 조절 | ←/→: 위상 조절")
print("   W/E: 주파수 조절 | A: 자동 주파수 탐지")
print("   T: ANC 토글 | S: API 전송 토글")
print("="*60)
print(f"📡 API 서버: {API_BASE_URL}")
print(f"⏱️  전송 주기: {API_SEND_INTERVAL}초")
print("="*60 + "\n")

plt.show()

stream.stop()
stream.close()
