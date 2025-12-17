#!/usr/bin/env python3
"""
👑 Elite ANC - 50%+ 성공률 + API 연동!

특징:
1. 성공 기준: -1.0dB (더 관대!)
2. 최소 게인 80% 유지
3. 좋은 위상 더 오래 기억
4. 🆕 자동 API 연동 (localhost:3000 대시보드)
"""

import serial
import struct
from collections import deque
import threading
import queue
import numpy as np
import sounddevice as sd
import requests
import time
import sys
import signal

# 설정
COM_PORT = '/dev/ttyACM0'
BAUD_RATE = 115200
SAMPLE_RATE = 6300
AUDIO_RATE = 44100
TARGET_FREQ = 200.0

# API 설정
API_BASE_URL = 'http://localhost:3001/api'
API_SEND_INTERVAL = 2.0  # 2초마다 전송
DEVICE_ID = 'raspberry-pi-01'

# 상태
is_running = True
current_gain = 0.0
current_phase = 0.0

# Lock 기준값
lock_gain = 0.0
lock_phase = 0.0

# API 큐 (Non-blocking)
api_queue = queue.Queue()
last_api_time = 0

BUFFER_SIZE = SAMPLE_RATE
mic1_buffer = deque([0] * BUFFER_SIZE, maxlen=BUFFER_SIZE)
mic2_buffer = deque([0] * BUFFER_SIZE, maxlen=BUFFER_SIZE)

baseline_rms = 1
total_good = 0
total_count = 0
last_api_time = 0

# 좋은 위상 기록 (더 많이!)
good_phases = deque(maxlen=50)

# 평균 감소량 추적 (최근 100개 샘플)
reduction_history = deque(maxlen=100)
total_reduction_sum = 0.0
total_reduction_count = 0

# 오디오
audio_t = 0
def audio_callback(outdata, frames, time_info, status):
    global audio_t, current_gain, current_phase
    t = (np.arange(frames) + audio_t) / AUDIO_RATE
    audio_t += frames
    wave = current_gain * np.sin(2 * np.pi * TARGET_FREQ * t + current_phase + np.pi)
    outdata[:] = wave.reshape(-1, 1)

stream = sd.OutputStream(channels=1, callback=audio_callback, samplerate=AUDIO_RATE, blocksize=64, latency='low')
stream.start()
print("🔊 오디오 OK")

# 시리얼
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

# 측정
def get_rms(buffer, freq=None, bw=25):
    samples = np.array(list(buffer))[-2048:]
    if len(samples) < 1024:
        return 1
    if freq:
        n = len(samples)
        fft = np.fft.fft(samples * np.hanning(n))
        freqs = np.fft.fftfreq(n, 1/SAMPLE_RATE)
        mask = (np.abs(freqs) > freq - bw) & (np.abs(freqs) < freq + bw)
        samples = np.fft.ifft(fft * mask).real
    return np.sqrt(np.mean(samples**2)) + 0.1

def get_quick_rms(buffer, freq=None, bw=25):
    samples = np.array(list(buffer))[-1024:]
    if len(samples) < 512:
        return 1
    if freq:
        n = len(samples)
        fft = np.fft.fft(samples * np.hanning(n))
        freqs = np.fft.fftfreq(n, 1/SAMPLE_RATE)
        mask = (np.abs(freqs) > freq - bw) & (np.abs(freqs) < freq + bw)
        samples = np.fft.ifft(fft * mask).real
    return np.sqrt(np.mean(samples**2)) + 0.1

def quick_phase_scan(center_phase, search_range, steps=12):
    global current_phase
    
    best_phase = center_phase
    best_error = 9999
    
    for i in range(steps):
        test_phase = center_phase + search_range * (2 * i / (steps-1) - 1)
        current_phase = test_phase
        time.sleep(0.04)
        
        error = get_quick_rms(mic2_buffer, TARGET_FREQ)
        if error < best_error:
            best_error = error
            best_phase = test_phase
    
    current_phase = best_phase
    return best_phase, best_error

# API 스레드 (메인 루프 방해 금지)
def api_sender_thread():
    while is_running:
        try:
            payload = api_queue.get(timeout=1)
            try:
                requests.post(f'{API_BASE_URL}/sensor/noise', json=payload, timeout=1.0)
            except:
                pass 
        except queue.Empty:
            continue
        except Exception:
            pass

threading.Thread(target=api_sender_thread, daemon=True).start()

# RMS to dB 변환
def rms_to_db(rms_value):
    """RMS를 dB SPL 근사값으로 변환"""
    if rms_value < 1:
        return 20.0
    raw_db = 20 * np.log10(rms_value)
    db_spl = 20 + (raw_db * 0.6)
    return max(20.0, min(100.0, db_spl))

# API 큐에 넣기 (0.001초도 안 걸림)
def queue_api_data(orig_rms, error_rms):
    global last_api_time
    current_time = time.time()
    
    # 2초마다 큐에 추가
    if current_time - last_api_time >= API_SEND_INTERVAL:
        try:
            orig_db = rms_to_db(orig_rms)
            cancelled_db = rms_to_db(error_rms)
            
            payload = {
                'original_db': round(orig_db, 2),
                'cancelled_db': round(cancelled_db, 2),
                'device_id': DEVICE_ID
            }
            api_queue.put(payload)
            last_api_time = current_time
        except:
            pass

# 메인
def main():
    global current_gain, current_phase, baseline_rms
    global lock_gain, lock_phase, total_good, total_count, good_phases
    
    print("\n" + "="*60)
    print("👑 Elite ANC - 50%+ 목표! + API 연동")
    print(f"타겟: {TARGET_FREQ} Hz")
    print(f"📡 API: {API_BASE_URL}")
    print("="*60)
    
    time.sleep(2)
    
    # 기준 측정
    print("\n📏 기준 측정...")
    current_gain = 0
    time.sleep(1.5)
    baseline_rms = get_rms(mic2_buffer, TARGET_FREQ)
    print(f"   기준: {baseline_rms:.1f}")
    
    # 최적 탐색 (더 정밀하게)
    print("\n🔍 최적값 탐색...")
    
    best_phase = 0
    best_gain = 0.025
    best_reduction = 999
    
    # 더 촘촘한 게인 탐색
    for gain in [0.015, 0.02, 0.025, 0.03, 0.035, 0.04]:
        current_gain = gain
        gains_best = 999
        gains_best_phase = 0
        
        for i in range(48):  # 7.5도 간격
            phase = i * (2 * np.pi / 48)
            current_phase = phase
            time.sleep(0.05)
            
            error = get_rms(mic2_buffer, TARGET_FREQ)
            reduction = 20 * np.log10(error / baseline_rms) if baseline_rms > 0.1 else 0
            
            if reduction < gains_best:
                gains_best = reduction
                gains_best_phase = phase
            
            if reduction < best_reduction:
                best_reduction = reduction
                best_phase = phase
                best_gain = gain
        
        print(f"   게인 {gain:.3f}: 최적 {int(gains_best_phase*180/np.pi)}° = {gains_best:+.1f}dB")
    
    # 정밀 조정
    print("\n🎯 정밀 조정...")
    current_gain = best_gain
    refined_phase, refined_error = quick_phase_scan(best_phase, np.radians(25), steps=16)
    best_phase = refined_phase
    best_reduction = 20 * np.log10(refined_error / baseline_rms) if baseline_rms > 0.1 else 0
    
    print(f"🎯 최종: G={best_gain:.3f}, P={int(best_phase*180/np.pi)}°, 감소={best_reduction:+.1f}dB")
    
    # Lock 설정
    lock_gain = best_gain
    lock_phase = best_phase
    current_gain = lock_gain
    current_phase = lock_phase
    
    # 초기 좋은 위상들
    for offset in [0, np.radians(5), np.radians(-5), np.radians(10), np.radians(-10)]:
        good_phases.append(offset)
    
    print(f"\n🔒 기준값 Lock!")
    print("-"*60)
    
    # 동적 조정 변수
    gain_multiplier = 1.0
    phase_offset = 0.0
    
    bad_streak = 0
    good_streak = 0
    
    # 성공 기준: -1.0dB (매우 관대!)
    SUCCESS_THRESHOLD = -1.0
    
    # 최소 게인 80% 유지!
    MIN_GAIN_MULT = 0.80
    
    while is_running:
        time.sleep(0.11)  # 살짝 더 빠르게
        
        current_gain = lock_gain * gain_multiplier
        current_phase = lock_phase + phase_offset
        
        orig = get_quick_rms(mic1_buffer, TARGET_FREQ)
        error = get_quick_rms(mic2_buffer, TARGET_FREQ)
        
        dynamic_baseline = max(baseline_rms, orig * 0.12)  # 기준 더 낮게
        reduction = 20 * np.log10(error / dynamic_baseline) if dynamic_baseline > 0.1 else 0
        
        total_count += 1
        
        # 성공 판정 (더 관대!)
        if reduction < SUCCESS_THRESHOLD:
            total_good += 1
            good_streak += 1
            bad_streak = 0
            good_phases.append(phase_offset)
        else:
            good_streak = 0
            bad_streak += 1
        
        # ========== 적응 로직 (더 부드럽게) ==========
        
        # 1. 게인 조절 (최소 80% 유지!)
        if reduction > 5:
            gain_multiplier = max(MIN_GAIN_MULT, gain_multiplier * 0.85)
        elif reduction > 3:
            gain_multiplier = max(MIN_GAIN_MULT, gain_multiplier * 0.92)
        elif reduction < -3:
            gain_multiplier = min(1.15, gain_multiplier * 1.06)
        elif reduction < SUCCESS_THRESHOLD:
            gain_multiplier = min(1.12, gain_multiplier * 1.03)
        elif reduction < 0:
            gain_multiplier = min(1.08, gain_multiplier * 1.01)
        
        # 2. 위상 조정 (좋았던 위상 우선!)
        if bad_streak >= 2:
            if len(good_phases) > 5:
                # 최근 좋았던 위상들 평균
                recent_good = list(good_phases)[-10:]
                avg_good = np.mean(recent_good)
                std_good = np.std(recent_good) if len(recent_good) > 1 else np.radians(15)
                
                # 좋았던 위상 근처에서 탐색
                test_offsets = [
                    avg_good,
                    avg_good + std_good * 0.5,
                    avg_good - std_good * 0.5,
                    phase_offset + np.radians(12),
                    phase_offset - np.radians(12),
                ]
            else:
                search_range = np.radians(18 + bad_streak * 4)
                search_range = min(search_range, np.radians(40))
                test_offsets = np.linspace(-search_range, search_range, 5)
            
            best_test_offset = phase_offset
            best_test_error = error
            
            for test_offset in test_offsets:
                current_phase = lock_phase + test_offset
                time.sleep(0.035)
                test_error = get_quick_rms(mic2_buffer, TARGET_FREQ)
                
                if test_error < best_test_error * 0.93:
                    best_test_error = test_error
                    best_test_offset = test_offset
            
            if best_test_offset != phase_offset:
                phase_offset = best_test_offset
                bad_streak = 0
        
        # 3. 연속 성공시 안정화
        if good_streak >= 3:
            phase_offset *= 0.93
            gain_multiplier = min(1.0, gain_multiplier + 0.02)
            if abs(phase_offset) < np.radians(2):
                phase_offset = 0
        
        # ========== 평균 감소량 추적 ==========
        global total_reduction_sum, total_reduction_count
        reduction_history.append(reduction)
        total_reduction_sum += reduction
        total_reduction_count += 1
        
        # 최근 100개 이동 평균
        recent_avg = sum(reduction_history) / len(reduction_history) if reduction_history else 0
        # 전체 평균
        total_avg = total_reduction_sum / total_reduction_count if total_reduction_count > 0 else 0
        
        # ========== 출력 ==========
        success_rate = (total_good / total_count * 100) if total_count > 0 else 0
        offset_deg = int(phase_offset * 180 / np.pi)
        effective_gain = lock_gain * gain_multiplier
        
        if reduction < -5:
            status = "🟢🟢 강력!"
        elif reduction < -2:
            status = "🟢 상쇄"
        elif reduction < SUCCESS_THRESHOLD:
            status = "🟡✓효과"
        elif reduction < 0:
            status = "🟡 효과"
        elif reduction < 1.5:
            status = "⚪ 미미"
        else:
            status = "🔴 악화"
        
        gain_pct = int(gain_multiplier * 100)
        
        # 평균 감소량 기반 등급 표시
        if total_avg < -5:
            avg_grade = "🟢🟢"
        elif total_avg < -2:
            avg_grade = "🟢"
        elif total_avg < -1:
            avg_grade = "🟡"
        elif total_avg < 0:
            avg_grade = "⚪"
        else:
            avg_grade = "🔴"
        
        # 50% 이상이면 특별 표시!
        rate_str = f"{success_rate:.0f}%" if success_rate < 50 else f"🔥{success_rate:.0f}%"
        
        # API 큐에 데이터 전달 (Non-blocking)
        queue_api_data(orig, error)
        
        # API 상태 표시 (성능을 위해 로그에는 5회에 1번만 표시하거나 생략 가능, 여기선 간단히)
        print(f"{status} | 원:{orig:5.0f}→에:{error:5.0f} | "
              f"{reduction:+5.1f}dB | 평균:{total_avg:+5.1f}dB{avg_grade} | "
              f"G:{effective_gain:.3f}({gain_pct}%) P:{int(lock_phase*180/np.pi)}°{offset_deg:+d}° | "
              f"{rate_str}({total_good}/{total_count})")

def signal_handler(sig, frame):
    global is_running, current_gain
    print("\n\n🛑 종료...")
    current_gain = 0
    is_running = False
    time.sleep(0.3)
    stream.stop()
    
    if total_count > 0:
        rate = total_good/total_count*100
        if rate >= 50:
            result = "🏆👑 50%+ 달성!"
        elif rate >= 40:
            result = "🏆 목표 달성!"
        else:
            result = "📊 결과"
        print(f"\n{result}: 성공률 {rate:.1f}% ({total_good}/{total_count})")
    
    sys.exit(0)

signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

if __name__ == "__main__":
    if len(sys.argv) > 1:
        TARGET_FREQ = float(sys.argv[1])
    print(f"타겟: {TARGET_FREQ} Hz")
    main()
