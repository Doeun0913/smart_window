#!/usr/bin/env python3
"""
🔒 안정적인 ANC 시스템 - 최적값 고정 버전

1. 최적 위상/게인 찾기
2. 찾으면 그 값으로 고정
3. 흔들리지 않고 일관적으로 상쇄
"""

import serial
import struct
from collections import deque
import threading
import numpy as np
import sounddevice as sd
import time
import sys
import signal
import requests

# ==========================================
# 설정
# ==========================================
COM_PORT = '/dev/ttyACM1'
BAUD_RATE = 115200
SAMPLE_RATE = 6300
AUDIO_RATE = 44100
TARGET_FREQ = 200.0

# API
API_BASE_URL = 'http://localhost:3001/api'
API_INTERVAL = 2.0

# ==========================================
# 상태
# ==========================================
is_running = True
locked_gain = 0.0
locked_phase = 0.0
is_locked = False  # 최적값 고정 상태

BUFFER_SIZE = SAMPLE_RATE
mic1_buffer = deque([0] * BUFFER_SIZE, maxlen=BUFFER_SIZE)
mic2_buffer = deque([0] * BUFFER_SIZE, maxlen=BUFFER_SIZE)

last_api_time = 0
baseline_rms = 1

# ==========================================
# 오디오 (고정된 값으로 출력)
# ==========================================
audio_time = 0

def audio_callback(outdata, frames, time_info, status):
    global audio_time, locked_gain, locked_phase
    
    if locked_gain < 0.001:
        outdata.fill(0)
        return
    
    t = (np.arange(frames) + audio_time) / AUDIO_RATE
    audio_time += frames
    
    # 고정된 역위상 출력
    wave = locked_gain * np.sin(2 * np.pi * TARGET_FREQ * t + locked_phase)
    outdata[:] = wave.reshape(-1, 1)

stream = sd.OutputStream(
    channels=1, callback=audio_callback,
    samplerate=AUDIO_RATE, blocksize=128, latency='low'
)
stream.start()
print("🔊 오디오 초기화 완료")

# ==========================================
# 시리얼
# ==========================================
def read_serial():
    while is_running:
        try:
            ser = serial.Serial(COM_PORT, BAUD_RATE, timeout=1)
            ser.reset_input_buffer()
            print(f"✅ {COM_PORT} 연결됨")
            while is_running:
                if ser.in_waiting >= 4:
                    packet = ser.read(4)
                    v1, v2 = struct.unpack('>HH', packet)
                    mic1_buffer.append(v1 - 32768)
                    mic2_buffer.append(v2 - 32768)
        except Exception as e:
            print(f"시리얼 오류: {e}")
            time.sleep(2)

threading.Thread(target=read_serial, daemon=True).start()

# ==========================================
# 측정 함수
# ==========================================
def get_target_rms(buffer, freq):
    samples = np.array(list(buffer))[-2048:]
    if len(samples) < 1024:
        return 1
    
    n = len(samples)
    fft = np.fft.fft(samples * np.hanning(n))
    freqs = np.fft.fftfreq(n, 1/SAMPLE_RATE)
    
    # 타겟 주파수 ±15Hz
    mask = (np.abs(freqs) > freq - 15) & (np.abs(freqs) < freq + 15)
    filtered = np.fft.ifft(fft * mask).real
    
    return np.sqrt(np.mean(filtered**2)) + 1

def get_rms(buffer):
    samples = np.array(list(buffer))
    return np.sqrt(np.mean(samples**2)) + 1

def rms_to_db(rms):
    if rms < 1: return 20.0
    return max(20.0, min(100.0, 20 + 20 * np.log10(rms) * 0.5))

# ==========================================
# 최적값 탐색 (한 번만 실행)
# ==========================================
def find_optimal_settings():
    global locked_gain, locked_phase, baseline_rms
    
    print("\n" + "="*60)
    print("🔍 최적 ANC 설정 탐색")
    print("="*60)
    
    # 1. 기준 측정
    print("\n📏 기준 소음 측정...")
    locked_gain = 0
    time.sleep(1.5)
    baseline_rms = get_target_rms(mic2_buffer, TARGET_FREQ)
    print(f"   기준 RMS: {baseline_rms:.0f}")
    
    # 2. 게인 + 위상 조합 탐색
    print(f"\n🔍 {TARGET_FREQ}Hz 최적 조합 탐색...")
    
    best_gain = 0
    best_phase = 0
    best_reduction = 999
    
    # 게인 범위
    test_gains = [0.015, 0.02, 0.025, 0.03, 0.035, 0.04, 0.05]
    
    for gain in test_gains:
        locked_gain = gain
        
        # 위상 36단계 스캔
        for i in range(36):
            phase = i * (2 * np.pi / 36)
            locked_phase = phase
            time.sleep(0.12)
            
            error = get_target_rms(mic2_buffer, TARGET_FREQ)
            reduction = 20 * np.log10(error / baseline_rms) if baseline_rms > 1 else 0
            
            if reduction < best_reduction:
                best_reduction = reduction
                best_gain = gain
                best_phase = phase
        
        print(f"   게인 {gain:.3f} 스캔 완료 (현재 최적: {best_reduction:+.1f}dB)")
    
    # 3. 최적값 고정
    locked_gain = best_gain
    locked_phase = best_phase
    
    print(f"\n" + "="*60)
    print(f"🔒 최적값 고정!")
    print(f"   게인: {locked_gain:.4f}")
    print(f"   위상: {(locked_phase * 180 / np.pi):.0f}°")
    print(f"   감소: {best_reduction:+.1f}dB")
    print("="*60)
    
    return best_reduction < -2

# ==========================================
# API 전송
# ==========================================
def send_api():
    global last_api_time
    
    if time.time() - last_api_time < API_INTERVAL:
        return
    
    try:
        orig = rms_to_db(get_rms(mic1_buffer))
        err = rms_to_db(get_rms(mic2_buffer))
        
        requests.post(f'{API_BASE_URL}/sensor/noise', json={
            'original_db': round(orig, 2),
            'cancelled_db': round(err, 2),
            'device_id': 'raspberry-pi-01'
        }, timeout=2)
        
        last_api_time = time.time()
    except:
        pass

# ==========================================
# 메인 루프
# ==========================================
def run_stable_anc():
    global is_running, is_locked
    
    # 최적값 탐색
    success = find_optimal_settings()
    is_locked = True
    
    if success:
        print("\n✅ ANC 작동 중! (값 고정됨)")
    else:
        print("\n⚠️ 최선의 설정으로 작동 중...")
    
    print("📡 모니터링 시작 (Ctrl+C로 종료)")
    print("-"*60)
    
    # 안정적인 모니터링
    while is_running:
        time.sleep(0.3)
        
        orig = get_target_rms(mic1_buffer, TARGET_FREQ)
        err = get_target_rms(mic2_buffer, TARGET_FREQ)
        reduction = 20 * np.log10(err / baseline_rms) if baseline_rms > 1 else 0
        
        if reduction < -5:
            status = "🟢 상쇄중"
        elif reduction < -2:
            status = "🟡 효과중"
        elif reduction < 0:
            status = "⚪ 미세"
        else:
            status = "🔴 증가"
        
        print(f"{status} | 원본: {orig:.0f} → 에러: {err:.0f} | "
              f"감소: {reduction:+.1f}dB | 🔒 게인: {locked_gain:.3f} 위상: {(locked_phase*180/np.pi):.0f}°")
        
        send_api()

# ==========================================
# 종료
# ==========================================
def signal_handler(sig, frame):
    global is_running, locked_gain
    print("\n\n🛑 종료...")
    locked_gain = 0
    is_running = False
    time.sleep(0.3)
    stream.stop()
    sys.exit(0)

signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

# ==========================================
# 메인
# ==========================================
if __name__ == "__main__":
    print("="*60)
    print("🔒 안정적인 ANC 시스템")
    print("="*60)
    
    if len(sys.argv) > 1:
        TARGET_FREQ = float(sys.argv[1])
    
    print(f"타겟 주파수: {TARGET_FREQ} Hz")
    time.sleep(2)
    
    run_stable_anc()
