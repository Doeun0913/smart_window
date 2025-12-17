#!/usr/bin/env python3
"""
🎧 ANC 실시간 추적 + DB 저장/프론트엔드 전송
- 원본 스크립트에 DB 전송 기능 추가 (dht_to_db.py 참고)
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

# ==========================================
# 1. 시스템 설정
# ==========================================
COM_PORT = 'COM4'
BAUD_RATE = 115200
SAMPLE_RATE = 6300
FFT_SAMPLES = 6300

MAX_SAMPLES = 200
TARGET_FREQ = 200.0

# API/DB 설정 (dht_to_db.py 스타일)
API_CONFIG = {
    'BASE_URL': 'http://localhost:3001/api',
    'DEVICE_ID': 'raspberry-pi-01',
    'SEND_INTERVAL': 1.0,  # 초
    'TIMEOUT': 5,
}

# ==========================================
# 2. 제어 변수
# ==========================================
w_gain = 0.0
w_phase = 0.0

is_running_anc = False
baseline_noise = 1e-6

# 고정 게인
FIXED_GAIN = 0.11

# ==========================================
# 3. 오디오 출력
# ==========================================
def audio_callback(outdata, frames, time_info, status):
    global w_phase, w_gain, TARGET_FREQ
    
    t = (np.arange(frames) + audio_callback.t) / 44100
    audio_callback.t += frames
    
    wave = w_gain * np.sin(2 * np.pi * TARGET_FREQ * t + w_phase)
    outdata[:] = wave.reshape(-1, 1)


audio_callback.t = 0
stream = sd.OutputStream(channels=1, callback=audio_callback, samplerate=44100, blocksize=512)
stream.start()

# ==========================================
# 4. 데이터 수집
# ==========================================
data_mic1 = deque([0] * MAX_SAMPLES, maxlen=MAX_SAMPLES)
data_mic2 = deque([0] * MAX_SAMPLES, maxlen=MAX_SAMPLES)
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
# 5. RMS/ dB 유틸
# ==========================================
def get_rms_noise():
    samples = np.array(list(error_buffer_signed))
    return np.sqrt(np.mean(samples**2)) + 1e-6


def rms_to_db(rms_val: float) -> float:
    """RMS → dBFS → 대략적인 dB SPL (anc_processor.py 동일 로직)"""
    if rms_val <= 0:
        return 0.0
    db = 20 * np.log10(rms_val / 32768.0) + 94  # 0 dBFS ≈ 94 dB SPL 가정
    return float(max(0.0, min(120.0, db)))


def get_current_reduction(baseline):
    current = get_rms_noise()
    if baseline < 1e-5:
        return 0.0
    return 20 * np.log10(current / baseline)


# ==========================================
# 5-1. DB 전송 (백엔드 → 프론트 실시간 브로드캐스트)
# ==========================================
noise_payload_lock = threading.Lock()
latest_noise_payload = {
    'original_db': 0.0,
    'cancelled_db': 0.0,
    'device_id': API_CONFIG['DEVICE_ID'],
}
last_send_ts = 0.0


def send_noise_to_db(payload: dict) -> bool:
    """소음 데이터를 백엔드에 전송해 DB 저장 & 프론트 실시간 전파"""
    try:
        res = requests.post(
            f"{API_CONFIG['BASE_URL']}/sensor/noise",
            json=payload,
            timeout=API_CONFIG['TIMEOUT'],
        )
        if res.status_code == 200 and res.json().get('success'):
            return True
        print(f"⚠️ 전송 실패: status={res.status_code} body={res.text}")
    except requests.exceptions.ConnectionError:
        print("⚠️ 서버 연결 실패 - 백엔드 실행 여부 확인 필요")
    except Exception as e:
        print(f"⚠️ 전송 에러: {e}")
    return False


def noise_sender_loop():
    """1초 간격으로 최신 dB 데이터를 서버로 전송 (논블로킹)"""
    global last_send_ts
    while True:
        time.sleep(0.2)
        now = time.time()
        if now - last_send_ts < API_CONFIG['SEND_INTERVAL']:
            continue
        
        with noise_payload_lock:
            payload = latest_noise_payload.copy()
        
        # 유효 데이터 여부 확인
        if payload['original_db'] <= 0 and payload['cancelled_db'] <= 0:
            continue
        
        if send_noise_to_db(payload):
            last_send_ts = now
            # 너무 많은 로그를 막기 위해 성공 시 로그는 생략


noise_sender_thread = threading.Thread(target=noise_sender_loop, daemon=True)
noise_sender_thread.start()

# ==========================================
# 6. 실시간 추적 ANC (증폭 즉시 대응)
# ==========================================
def run_tracking_anc():
    global w_phase, w_gain, is_running_anc, baseline_noise
    
    print("\n⚡ [Real-time Tracking ANC] 시작")
    print("   - 고정 게인 0.11")
    print("   - 목표: -4dB 안정적 감소")
    print("   - 0.5초마다 위상 미세 조정")
    
    # 1. 기준 소음 측정
    w_gain = 0.0
    time.sleep(0.7)
    baseline_noise = get_rms_noise()
    print(f"📢 기준 소음: {int(baseline_noise)}")
    
    # 첫 전송을 위해 초기 dB 세팅
    update_noise_payload(baseline_noise, baseline_noise)
    
    # 성공 기준: -4dB 감소 (0.63배)
    success_threshold = baseline_noise * 0.63  # -4dB
    
    while is_running_anc:
        print(f"\n🔄 새로운 사이클 시작")
        
        # --- Phase 1: 빠른 위상 스캔 ---
        w_gain = FIXED_GAIN
        
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
        
        # --- Phase 3: 고정 ---
        w_phase = best_phase
        time.sleep(0.5)
        
        locked_noise = get_rms_noise()
        reduction_db = 20 * np.log10(locked_noise / baseline_noise)
        
        print(f"🔒 고정: Phase={best_phase:.2f}, RMS={int(locked_noise)} ({reduction_db:.1f}dB)")
        
        # DB 전송 업데이트
        update_noise_payload(baseline_noise, locked_noise)
        
        # 실패 처리
        if locked_noise > success_threshold:
            print(f"   ⚠️ 효과 부족. 재시도...")
            time.sleep(0.3)
            continue
        
        print(f"   ✅ 성공!")
        
        # --- Phase 4: 실시간 모니터링 ---
        last_check = time.time()
        check_interval = 0.5  # 0.5초마다 체크
        
        # 임계값
        maintain_threshold = locked_noise * 1.10  # +0.8dB까지 허용
        warning_threshold = locked_noise * 1.15   # +1.2dB 경고
        amplify_threshold = locked_noise * 1.30   # +2.3dB면 재스캔
        
        consecutive_warnings = 0
        
        while is_running_anc:
            current_noise = get_rms_noise()
            
            # DB 전송용 최신 값 갱신
            update_noise_payload(baseline_noise, current_noise)
            
            # 즉각 대응 1: 심각한 증폭
            if current_noise > amplify_threshold:
                print(f"🚨 심각한 증폭! {int(current_noise)} > {int(amplify_threshold)} 재스캔")
                break
            
            # 즉각 대응 2: 경고 임계값
            if current_noise > warning_threshold:
                consecutive_warnings += 1
                if consecutive_warnings >= 3:
                    print(f"⚠️ 3회 경고 누적. 재스캔")
                    break
            else:
                consecutive_warnings = 0
            
            # 정기 미세 조정 (0.5초마다)
            if time.time() - last_check > check_interval:
                old_noise = current_noise
                
                # 5개 위상 테스트
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
                
                # 2% 이상 개선되면 적용
                if new_noise < old_noise * 0.98:
                    w_phase = test_phases[best_idx] % (2 * np.pi)
                    improvement = 20 * np.log10(new_noise / old_noise)
                    print(f"🔧 미세 조정: {improvement:.2f}dB (Phase: {w_phase:.2f})")
                else:
                    w_phase = test_phases[2]  # 중심 유지
                
                last_check = time.time()
            
            time.sleep(0.08)
    
    w_gain = 0.0
    print("\n🛑 ANC 종료.")


# 최신 RMS를 dB로 변환해 전송 스레드가 읽도록 업데이트
def update_noise_payload(original_rms: float, cancelled_rms: float):
    with noise_payload_lock:
        latest_noise_payload.update({
            'original_db': rms_to_db(original_rms),
            'cancelled_db': rms_to_db(cancelled_rms),
            'device_id': API_CONFIG['DEVICE_ID'],
        })


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
# 7. 시각화 및 제어
# ==========================================
fig, ax = plt.subplots(figsize=(10, 6))
line1, = ax.plot([], [], label='Input (Mic 1)', color='red', alpha=0.5)
line2, = ax.plot([], [], label='Output (Mic 2)', color='blue', linewidth=1.5)

ax.set_ylim(-40000, 40000)
ax.set_xlim(0, MAX_SAMPLES)
ax.set_title("ANC: Fast Tracking (Fixed Gain 0.11)")
ax.legend(loc='upper right')
ax.grid(True)


def on_key_press(event):
    global w_gain, w_phase, TARGET_FREQ, is_running_anc
    
    if event.key == 'up':    w_gain = min(0.20, w_gain + 0.01)
    if event.key == 'down':  w_gain = max(0.0, w_gain - 0.01)
    if event.key == 'left':  w_phase -= 0.05
    if event.key == 'right': w_phase += 0.05
    if event.key == 'w': TARGET_FREQ += 0.1
    if event.key == 'e': TARGET_FREQ -= 0.1
    
    if event.key == 'a':
        threading.Thread(target=run_auto_freq_detect, daemon=True).start()
    
    # T: 추적형 ANC
    if event.key == 't':
        if is_running_anc:
            is_running_anc = False
        else:
            is_running_anc = True
            threading.Thread(target=run_tracking_anc, daemon=True).start()


fig.canvas.mpl_connect('key_press_event', on_key_press)


def update(frame):
    line1.set_ydata(data_mic1)
    line1.set_xdata(range(len(data_mic1)))
    line2.set_ydata(data_mic2)
    line2.set_xdata(range(len(data_mic2)))
    
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
                status = "🔴 WEAK/AMPLIFY"
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
    
    # DB 전송용 데이터 업데이트 (ANC 끈 상태도 현재 소음 기록)
    original_rms = baseline_noise if baseline_noise > 1e-5 else current_rms
    update_noise_payload(original_rms, current_rms)
    
    return line1, line2


ani = animation.FuncAnimation(fig, update, interval=20, blit=False)
plt.show()

stream.stop()
stream.close()


