#!/usr/bin/env python3
"""
🚀 Turbo ANC - 더 공격적인 적응형 ANC

핵심 개선:
1. 동적 게인: 에러가 크면 게인 감소 (악화 방지)
2. 빠른 위상 스캔: 연속 실패시 넓은 범위 재스캔
3. 이동 평균 기준: 변동하는 환경에 적응
4. 실패시 즉시 반응: bad_streak 1~2번이면 바로 조정
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

# 설정
COM_PORT = '/dev/ttyACM1'
BAUD_RATE = 115200
SAMPLE_RATE = 6300
AUDIO_RATE = 44100
TARGET_FREQ = 200.0

# 상태
is_running = True
current_gain = 0.0
current_phase = 0.0

# Lock 기준값
lock_gain = 0.0
lock_phase = 0.0

BUFFER_SIZE = SAMPLE_RATE
mic1_buffer = deque([0] * BUFFER_SIZE, maxlen=BUFFER_SIZE)
mic2_buffer = deque([0] * BUFFER_SIZE, maxlen=BUFFER_SIZE)

# 이동 평균 기준
baseline_history = deque(maxlen=50)
baseline_rms = 1

total_good = 0
total_count = 0

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

# 빠른 위상 스캔 (현재 위치 ±범위에서 최적 찾기)
def quick_phase_scan(center_phase, search_range, steps=8):
    global current_phase, current_gain
    
    best_phase = center_phase
    best_error = 9999
    
    original_gain = current_gain
    
    for i in range(steps):
        test_phase = center_phase + search_range * (2 * i / (steps-1) - 1)
        current_phase = test_phase
        time.sleep(0.05)
        
        error = get_quick_rms(mic2_buffer, TARGET_FREQ)
        if error < best_error:
            best_error = error
            best_phase = test_phase
    
    current_phase = best_phase
    return best_phase, best_error

# 메인
def main():
    global current_gain, current_phase, baseline_rms
    global lock_gain, lock_phase, total_good, total_count
    
    print("\n" + "="*60)
    print("🚀 Turbo ANC - 공격적 적응형")
    print(f"타겟: {TARGET_FREQ} Hz")
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
    best_gain = 0.03
    best_reduction = 999
    
    # 먼저 대략적인 게인 찾기
    for gain in [0.02, 0.03, 0.04, 0.05, 0.06]:
        current_gain = gain
        gains_best = 999
        gains_best_phase = 0
        
        # 10도 간격으로 빠르게 스캔
        for i in range(36):
            phase = i * (2 * np.pi / 36)
            current_phase = phase
            time.sleep(0.06)
            
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
    
    # 최적 주변에서 정밀 스캔
    print("\n🎯 정밀 조정...")
    current_gain = best_gain
    refined_phase, refined_error = quick_phase_scan(best_phase, np.radians(30), steps=16)
    best_phase = refined_phase
    best_reduction = 20 * np.log10(refined_error / baseline_rms) if baseline_rms > 0.1 else 0
    
    print(f"🎯 최종: G={best_gain:.3f}, P={int(best_phase*180/np.pi)}°, 감소={best_reduction:+.1f}dB")
    
    # Lock 설정
    lock_gain = best_gain
    lock_phase = best_phase
    current_gain = lock_gain
    current_phase = lock_phase
    
    print(f"\n🔒 기준값 Lock!")
    print("-"*60)
    
    # 동적 조정 변수
    gain_multiplier = 1.0  # 게인 배율 (0.3 ~ 1.2)
    phase_offset = 0.0     # 위상 오프셋
    
    bad_streak = 0
    good_streak = 0
    error_history = deque(maxlen=5)
    
    # 모니터링 + 적응
    while is_running:
        time.sleep(0.12)
        
        # 현재 설정
        current_gain = lock_gain * gain_multiplier
        current_phase = lock_phase + phase_offset
        
        # 측정
        orig = get_quick_rms(mic1_buffer, TARGET_FREQ)
        error = get_quick_rms(mic2_buffer, TARGET_FREQ)
        
        # 이동 평균 기준 업데이트 (ANC 꺼진 상태 추정)
        if current_gain < 0.01:
            baseline_history.append(error)
        
        # 동적 기준 (최근 원본 신호 기반)
        dynamic_baseline = max(baseline_rms, orig * 0.15)
        reduction = 20 * np.log10(error / dynamic_baseline) if dynamic_baseline > 0.1 else 0
        
        error_history.append(error)
        avg_error = np.mean(error_history)
        
        total_count += 1
        
        # 성공 판정
        if reduction < -2:
            total_good += 1
            good_streak += 1
            bad_streak = 0
        else:
            good_streak = 0
            bad_streak += 1
        
        # ========== 적응 로직 ==========
        
        # 1. 에러가 너무 크면 게인 줄이기 (악화 방지)
        if reduction > 5:  # 5dB 이상 악화
            gain_multiplier = max(0.3, gain_multiplier * 0.7)
        elif reduction > 2:  # 약간 악화
            gain_multiplier = max(0.5, gain_multiplier * 0.9)
        elif reduction < -3:  # 잘 작동
            gain_multiplier = min(1.2, gain_multiplier * 1.05)
        elif reduction < 0:  # 효과 있음
            gain_multiplier = min(1.1, gain_multiplier * 1.02)
        
        # 2. 연속 실패시 위상 빠르게 재스캔
        if bad_streak >= 2:
            # 빠른 ±20도 스캔
            search_range = np.radians(20 + bad_streak * 5)  # 실패 많을수록 넓게
            search_range = min(search_range, np.radians(60))
            
            test_offsets = np.linspace(-search_range, search_range, 5)
            best_test_offset = phase_offset
            best_test_error = error
            
            for test_offset in test_offsets:
                current_phase = lock_phase + test_offset
                time.sleep(0.04)
                test_error = get_quick_rms(mic2_buffer, TARGET_FREQ)
                
                if test_error < best_test_error * 0.9:  # 10% 이상 개선
                    best_test_error = test_error
                    best_test_offset = test_offset
            
            if best_test_offset != phase_offset:
                phase_offset = best_test_offset
                bad_streak = 0
        
        # 3. 연속 성공시 원점으로 복귀 & 게인 회복
        if good_streak >= 5:
            phase_offset *= 0.9
            gain_multiplier = min(1.0, gain_multiplier + 0.02)
            if abs(phase_offset) < np.radians(2):
                phase_offset = 0
        
        # ========== 출력 ==========
        success_rate = (total_good / total_count * 100) if total_count > 0 else 0
        offset_deg = int(phase_offset * 180 / np.pi)
        effective_gain = lock_gain * gain_multiplier
        
        if reduction < -5:
            status = "🟢🟢 강력!"
        elif reduction < -2:
            status = "🟢 상쇄"
        elif reduction < 0:
            status = "🟡 효과"
        elif reduction < 3:
            status = "⚪ 미미"
        else:
            status = "🔴 악화"
        
        gain_pct = int(gain_multiplier * 100)
        print(f"{status} | 원본:{orig:5.0f}→에러:{error:5.0f} | "
              f"감소:{reduction:+5.1f}dB | "
              f"G:{effective_gain:.3f}({gain_pct}%) P:{int(lock_phase*180/np.pi)}°{offset_deg:+d}° | "
              f"성공:{success_rate:.0f}%({total_good}/{total_count})")

def signal_handler(sig, frame):
    global is_running, current_gain
    print("\n\n🛑 종료...")
    current_gain = 0
    is_running = False
    time.sleep(0.3)
    stream.stop()
    
    if total_count > 0:
        print(f"\n📊 최종 결과: 성공률 {total_good/total_count*100:.1f}% ({total_good}/{total_count})")
    
    sys.exit(0)

signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

if __name__ == "__main__":
    if len(sys.argv) > 1:
        TARGET_FREQ = float(sys.argv[1])
    print(f"타겟: {TARGET_FREQ} Hz")
    main()
