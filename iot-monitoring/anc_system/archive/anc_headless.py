#!/usr/bin/env python3
"""
Smart Home IoT - ANC System (Headless Mode)
라즈베리파이에서 모니터 없이 백그라운드로 실행 가능

사용법:
  python3 anc_headless.py          # 일반 실행
  python3 anc_headless.py &        # 백그라운드 실행
  nohup python3 anc_headless.py &  # SSH 종료 후에도 계속 실행
"""

import serial
import struct
from collections import deque, Counter
import threading
import numpy as np
import sounddevice as sd
import time
import requests
import signal
import sys

# ==========================================
# 1. 시스템 설정
# ==========================================
# 라즈베리파이에서는 보통 /dev/ttyACM0 또는 /dev/ttyUSB0
COM_PORT = '/dev/ttyACM1'
BAUD_RATE = 115200
SAMPLE_RATE = 6300
FFT_SAMPLES = 6300

# API 설정
API_BASE_URL = 'http://localhost:3001/api'
API_SEND_INTERVAL = 2.0  # 2초마다 전송
DEVICE_ID = 'raspberry-pi-01'

MAX_SAMPLES = 150       
TARGET_FREQ = 198.2

# ==========================================
# 2. 제어 변수
# ==========================================
w_gain = 0.0
w_phase = 0.0

is_running_anc = False
is_running = True  # 프로그램 실행 상태
baseline_noise = 1e-6
# 게인 설정 (0.0 ~ 1.0, 높을수록 출력 강함)
# 진동자/스피커가 약하면 이 값을 높이세요
FIXED_GAIN = 0.15  # 기본: 0.15 (범위: 0.05 ~ 0.5)

last_api_send_time = 0

# ==========================================
# 3. 오디오 출력 (SoundDevice)
# ==========================================
def audio_callback(outdata, frames, time_info, status):
    global w_phase, w_gain, TARGET_FREQ
    
    t = (np.arange(frames) + audio_callback.t) / 44100
    audio_callback.t += frames
    
    wave = w_gain * np.sin(2 * np.pi * TARGET_FREQ * t + w_phase)
    outdata[:] = wave.reshape(-1, 1)

audio_callback.t = 0

try:
    stream = sd.OutputStream(channels=1, callback=audio_callback, samplerate=44100, blocksize=512)
    stream.start()
    print("🔊 오디오 출력 초기화 성공")
except Exception as e:
    print(f"⚠️ 오디오 출력 실패: {e}")
    print("   스피커가 연결되어 있는지 확인하세요")
    stream = None

# ==========================================
# 4. 데이터 버퍼
# ==========================================
fft_buffer = deque([0] * FFT_SAMPLES, maxlen=FFT_SAMPLES)
error_buffer_signed = deque([0] * int(SAMPLE_RATE * 0.5), maxlen=int(SAMPLE_RATE * 0.5))
original_buffer_signed = deque([0] * int(SAMPLE_RATE * 0.5), maxlen=int(SAMPLE_RATE * 0.5))

# ==========================================
# 5. 시리얼 통신 (Pico에서 데이터 수신)
# ==========================================
def read_serial():
    global is_running
    
    while is_running:
        try:
            ser = serial.Serial(COM_PORT, BAUD_RATE, timeout=1)
            ser.reset_input_buffer()
            print(f"✅ {COM_PORT} 연결 성공!")
            
            while is_running:
                if ser.in_waiting >= 4:
                    packet = ser.read(4)
                    val1, val2 = struct.unpack('>HH', packet)
                    v1 = val1 - 32768
                    v2 = val2 - 32768
                    
                    fft_buffer.append(v1)
                    error_buffer_signed.append(v2)
                    original_buffer_signed.append(v1)
                    
        except serial.SerialException as e:
            print(f"❌ 시리얼 연결 실패: {e}")
            print("   5초 후 재시도...")
            time.sleep(5)
        except Exception as e:
            print(f"❌ 시리얼 오류: {e}")
            time.sleep(5)

# ==========================================
# 6. RMS 및 dB 계산
# ==========================================
def get_rms_noise():
    samples = np.array(list(error_buffer_signed))
    if len(samples) == 0: return 1e-6
    return np.sqrt(np.mean(samples**2)) + 1e-6

def get_original_rms():
    samples = np.array(list(original_buffer_signed))
    if len(samples) == 0: return 1e-6
    return np.sqrt(np.mean(samples**2)) + 1e-6

def rms_to_db(rms_value):
    if rms_value < 1:
        return 20.0
    raw_db = 20 * np.log10(rms_value / 1.0)
    db_spl = 20 + (raw_db * 0.6)
    return max(20.0, min(120.0, db_spl))

# ==========================================
# 7. API 전송
# ==========================================
def send_noise_data():
    global last_api_send_time
    
    current_time = time.time()
    if current_time - last_api_send_time < API_SEND_INTERVAL:
        return
    
    try:
        original_rms = get_original_rms()
        cancelled_rms = get_rms_noise()
        
        original_db = rms_to_db(original_rms)
        cancelled_db = rms_to_db(cancelled_rms)
        
        payload = {
            'original_db': round(original_db, 2),
            'cancelled_db': round(cancelled_db, 2),
            'device_id': DEVICE_ID
        }
        
        response = requests.post(
            f'{API_BASE_URL}/sensor/noise',
            json=payload,
            timeout=2.0
        )
        
        if response.status_code == 200:
            reduction = original_db - cancelled_db
            print(f"📡 [{time.strftime('%H:%M:%S')}] 원본={original_db:.0f}dB → 상쇄={cancelled_db:.0f}dB (감소: {reduction:.1f}dB)")
        
        last_api_send_time = current_time
        
    except requests.exceptions.ConnectionError:
        print(f"⚠️ [{time.strftime('%H:%M:%S')}] API 연결 실패")
        last_api_send_time = current_time
    except Exception as e:
        last_api_send_time = current_time

def api_sender_loop():
    global is_running
    while is_running:
        send_noise_data()
        time.sleep(0.5)

# ==========================================
# 8. ANC 알고리즘
# ==========================================
def run_tracking_anc():
    global w_phase, w_gain, is_running_anc, baseline_noise, is_running
    
    print("\n⚡ [ANC] 시작")
    
    saved_user_gain = w_gain if w_gain >= 0.01 else FIXED_GAIN
    
    # 기준 소음 측정
    print("   📊 기준 소음 측정 중...")
    w_gain = 0.0
    time.sleep(0.7)
    baseline_noise = get_rms_noise()
    print(f"   📢 기준: {int(baseline_noise)} RMS ({rms_to_db(baseline_noise):.0f} dB)")
    
    w_gain = saved_user_gain
    success_threshold = baseline_noise * 0.63
    
    while is_running_anc and is_running:
        print(f"\n🔄 위상 스캔 중... (게인: {w_gain:.3f})")
        
        best_phase = 0.0
        min_noise = 99999999.0
        
        # 빠른 스캔
        for p in np.arange(0, 2 * np.pi, 0.15):
            if not is_running_anc: break
            w_phase = p
            time.sleep(0.06)
            curr = get_rms_noise()
            if curr < min_noise:
                min_noise = curr
                best_phase = p
        
        # 정밀 스캔
        for p in np.linspace(best_phase - 0.25, best_phase + 0.25, 12):
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
        
        print(f"🔒 고정: Phase={best_phase:.2f}, 감소={reduction_db:.1f}dB")
        
        if locked_noise > success_threshold:
            print("   ⚠️ 효과 부족, 재시도...")
            time.sleep(0.3)
            continue
        
        print("   ✅ 성공! 모니터링 중...")
        
        # 실시간 모니터링
        last_check = time.time()
        amplify_threshold = locked_noise * 1.30
        
        while is_running_anc and is_running:
            current_noise = get_rms_noise()
            
            if current_noise > amplify_threshold:
                print("🚨 노이즈 증가 감지 → 재스캔")
                break
            
            # 미세 조정
            if time.time() - last_check > 0.5:
                test_phases = [w_phase - 0.02, w_phase, w_phase + 0.02]
                test_results = []
                
                for tp in test_phases:
                    w_phase = tp % (2 * np.pi)
                    time.sleep(0.04)
                    test_results.append(get_rms_noise())
                
                best_idx = np.argmin(test_results)
                w_phase = test_phases[best_idx] % (2 * np.pi)
                last_check = time.time()
            
            time.sleep(0.1)
    
    w_gain = 0.0
    print("\n🛑 ANC 종료")

# ==========================================
# 9. 자동 주파수 탐지
# ==========================================
def detect_frequency():
    global TARGET_FREQ
    
    print("\n🔍 주파수 분석 중...")
    candidates = []
    
    for _ in range(5):
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
# 10. 종료 처리
# ==========================================
def signal_handler(sig, frame):
    global is_running, is_running_anc
    print("\n\n🛑 종료 신호 수신...")
    is_running_anc = False
    is_running = False
    
    if stream:
        stream.stop()
        stream.close()
    
    print("👋 프로그램 종료")
    sys.exit(0)

signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

# ==========================================
# 11. 메인 실행
# ==========================================
def main():
    global is_running_anc, w_gain
    
    print("=" * 60)
    print("🏠 Smart Home IoT - ANC System (Headless Mode)")
    print("=" * 60)
    print(f"📡 API 서버: {API_BASE_URL}")
    print(f"🔌 시리얼 포트: {COM_PORT}")
    print(f"🎵 타겟 주파수: {TARGET_FREQ} Hz")
    print("=" * 60)
    
    # 스레드 시작
    serial_thread = threading.Thread(target=read_serial, daemon=True)
    serial_thread.start()
    
    api_thread = threading.Thread(target=api_sender_loop, daemon=True)
    api_thread.start()
    
    # 시리얼 연결 대기
    print("\n⏳ Pico 연결 대기 중...")
    time.sleep(3)
    
    # 주파수 탐지
    detect_frequency()
    
    # ANC 자동 시작
    print("\n🚀 ANC 자동 시작...")
    w_gain = FIXED_GAIN
    is_running_anc = True
    
    anc_thread = threading.Thread(target=run_tracking_anc, daemon=True)
    anc_thread.start()
    
    # 상태 모니터링 루프
    print("\n📊 상태 모니터링 시작 (Ctrl+C로 종료)")
    print("-" * 60)
    
    while is_running:
        time.sleep(10)
        
        original_db = rms_to_db(get_original_rms())
        cancelled_db = rms_to_db(get_rms_noise())
        reduction = original_db - cancelled_db
        
        status = "🟢 ACTIVE" if is_running_anc else "⚫ OFF"
        print(f"[{time.strftime('%H:%M:%S')}] {status} | "
              f"원본: {original_db:.0f}dB | 상쇄: {cancelled_db:.0f}dB | 감소: {reduction:.1f}dB")

if __name__ == "__main__":
    main()
