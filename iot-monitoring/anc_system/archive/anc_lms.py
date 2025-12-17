#!/usr/bin/env python3
"""
🧠 실시간 적응형 LMS ANC
매 순간 게인과 위상을 조정하여 에러를 최소화

원리: 에러가 줄어드는 방향으로 계속 조정
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

# LMS 파라미터 (핵심!)
GAIN_LR = 0.002      # 게인 학습률
PHASE_LR = 0.05      # 위상 학습률
MIN_GAIN = 0.005
MAX_GAIN = 0.08
SMOOTHING = 0.3      # 이동 평균 계수

# API
API_URL = 'http://localhost:3001/api'

# ==========================================
# 상태
# ==========================================
is_running = True
current_gain = 0.02
current_phase = 0.0

BUFFER_SIZE = SAMPLE_RATE
mic1_buffer = deque([0] * BUFFER_SIZE, maxlen=BUFFER_SIZE)
mic2_buffer = deque([0] * BUFFER_SIZE, maxlen=BUFFER_SIZE)

baseline_rms = 1
last_error = 0
last_api_time = 0

# 에러 기록 (상쇄 성공 여부 판단용)
error_history = deque(maxlen=20)
success_count = 0

# ==========================================
# 오디오
# ==========================================
audio_t = 0

def audio_callback(outdata, frames, time_info, status):
    global audio_t, current_gain, current_phase
    
    t = (np.arange(frames) + audio_t) / AUDIO_RATE
    audio_t += frames
    
    # 역위상 출력 (π 추가)
    wave = current_gain * np.sin(2 * np.pi * TARGET_FREQ * t + current_phase + np.pi)
    outdata[:] = wave.reshape(-1, 1)

stream = sd.OutputStream(
    channels=1, callback=audio_callback,
    samplerate=AUDIO_RATE, blocksize=64, latency='low'
)
stream.start()
print("🔊 저지연 오디오 OK")

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
            print(f"시리얼: {e}")
            time.sleep(2)

threading.Thread(target=read_serial, daemon=True).start()

# ==========================================
# 측정
# ==========================================
def get_bandpass_rms(buffer, freq, bandwidth=20):
    """특정 주파수 대역의 RMS"""
    samples = np.array(list(buffer))[-1024:]
    if len(samples) < 512:
        return 1
    
    n = len(samples)
    fft = np.fft.fft(samples * np.hanning(n))
    freqs = np.fft.fftfreq(n, 1/SAMPLE_RATE)
    
    mask = (np.abs(freqs) > freq - bandwidth) & (np.abs(freqs) < freq + bandwidth)
    filtered = np.fft.ifft(fft * mask).real
    
    return np.sqrt(np.mean(filtered**2)) + 0.1

def get_phase_diff():
    """Mic1과 Mic2 사이의 위상 차이 추정"""
    m1 = np.array(list(mic1_buffer))[-512:]
    m2 = np.array(list(mic2_buffer))[-512:]
    
    if len(m1) < 512 or len(m2) < 512:
        return 0
    
    # 상호 상관
    corr = np.correlate(m1 - np.mean(m1), m2 - np.mean(m2), mode='full')
    lag = np.argmax(corr) - len(m1) + 1
    
    # 지연을 위상으로 변환
    phase = (lag / SAMPLE_RATE) * 2 * np.pi * TARGET_FREQ
    return phase % (2 * np.pi)

def rms_to_db(rms):
    if rms < 1: return 20.0
    return max(20.0, min(100.0, 20 + 20 * np.log10(rms) * 0.5))

# ==========================================
# 실시간 LMS 적응
# ==========================================
def run_realtime_lms():
    global current_gain, current_phase, baseline_rms, last_error, success_count
    
    print("\n" + "="*60)
    print("🧠 실시간 LMS 적응형 ANC")
    print("="*60)
    print(f"타겟: {TARGET_FREQ} Hz")
    print("="*60)
    
    time.sleep(2)
    
    # 기준 측정
    print("\n📏 기준 측정...")
    current_gain = 0
    time.sleep(1)
    baseline_rms = get_bandpass_rms(mic2_buffer, TARGET_FREQ)
    print(f"   기준 에러: {baseline_rms:.1f}")
    
    # 초기 위상 추정
    phase_diff = get_phase_diff()
    current_phase = phase_diff
    current_gain = 0.015
    
    print(f"   초기 위상: {(current_phase * 180 / np.pi):.0f}°")
    print("\n🚀 실시간 적응 시작!")
    print("-"*60)
    
    last_error = baseline_rms
    phase_direction = 1  # 위상 조정 방향
    gain_direction = 1   # 게인 조정 방향
    
    iteration = 0
    
    while is_running:
        iteration += 1
        time.sleep(0.08)  # 80ms 간격
        
        # 현재 에러 측정
        error = get_bandpass_rms(mic2_buffer, TARGET_FREQ)
        orig = get_bandpass_rms(mic1_buffer, TARGET_FREQ)
        
        reduction_db = 20 * np.log10(error / baseline_rms) if baseline_rms > 0.1 else 0
        
        # ========== LMS 적응 알고리즘 ==========
        
        # 에러 변화량
        delta_error = error - last_error
        
        if delta_error > 0:
            # 에러 증가 → 반대 방향으로 조정
            phase_direction *= -1
            if abs(delta_error) > last_error * 0.2:
                gain_direction *= -1
        
        # 위상 조정 (에러에 비례)
        phase_step = PHASE_LR * (error / baseline_rms) * phase_direction
        current_phase += phase_step
        current_phase = current_phase % (2 * np.pi)
        
        # 게인 조정 (에러가 크면 조심스럽게)
        if reduction_db < -1:
            # 잘 되고 있음 → 조금 더 증가
            current_gain += GAIN_LR * gain_direction
        elif reduction_db > 2:
            # 나빠지고 있음 → 감소
            current_gain -= GAIN_LR * 2
        else:
            # 미세 조정
            current_gain += GAIN_LR * 0.5 * gain_direction
        
        current_gain = max(MIN_GAIN, min(MAX_GAIN, current_gain))
        
        # 이동 평균으로 부드럽게
        last_error = SMOOTHING * error + (1 - SMOOTHING) * last_error
        
        # 성공 카운트
        error_history.append(reduction_db)
        if reduction_db < -2:
            success_count += 1
        
        # ========== 출력 ==========
        if iteration % 3 == 0:
            if reduction_db < -5:
                status = "🟢🟢 강력 상쇄!"
            elif reduction_db < -2:
                status = "🟢 상쇄중"
            elif reduction_db < 0:
                status = "🟡 효과중"
            else:
                status = "🔴 조정중"
            
            # 최근 성공률
            recent = list(error_history)
            if recent:
                success_rate = sum(1 for r in recent if r < -2) / len(recent) * 100
            else:
                success_rate = 0
            
            print(f"{status} | 원본:{orig:5.0f} → 에러:{error:5.0f} | "
                  f"감소: {reduction_db:+5.1f}dB | "
                  f"G:{current_gain:.3f} P:{(current_phase*180/np.pi)%360:3.0f}° | "
                  f"성공률:{success_rate:.0f}%")
        
        # API 전송
        send_api(orig, error)

def send_api(orig, err):
    global last_api_time
    if time.time() - last_api_time < 2:
        return
    try:
        requests.post(f'{API_URL}/sensor/noise', json={
            'original_db': round(rms_to_db(orig), 2),
            'cancelled_db': round(rms_to_db(err), 2),
            'device_id': 'raspberry-pi-01'
        }, timeout=1)
        last_api_time = time.time()
    except:
        pass

# ==========================================
# 종료
# ==========================================
def signal_handler(sig, frame):
    global is_running, current_gain
    print("\n\n🛑 종료...")
    current_gain = 0
    is_running = False
    time.sleep(0.3)
    stream.stop()
    
    # 결과 요약
    if error_history:
        avg = np.mean(list(error_history))
        success_rate = sum(1 for r in error_history if r < -2) / len(error_history) * 100
        print(f"\n📊 결과: 평균 {avg:+.1f}dB, 성공률 {success_rate:.0f}%")
    
    sys.exit(0)

signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

# ==========================================
# 메인
# ==========================================
if __name__ == "__main__":
    print("="*60)
    print("🧠 실시간 LMS 적응형 ANC")
    print("="*60)
    
    if len(sys.argv) > 1:
        TARGET_FREQ = float(sys.argv[1])
    
    print(f"타겟 주파수: {TARGET_FREQ} Hz")
    run_realtime_lms()
