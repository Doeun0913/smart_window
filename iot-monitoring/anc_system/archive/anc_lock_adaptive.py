#!/usr/bin/env python3
"""
🔒⚡ Lock-On + Adaptive ANC

기준값은 고정하되, 에러가 커지면 위상을 미세 조정!
- Lock 모드: 기본 게인/위상 유지
- Micro-Adjust: 에러 증가시 ±15도 범위에서 위상 미세조정
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
is_locked = False

BUFFER_SIZE = SAMPLE_RATE
mic1_buffer = deque([0] * BUFFER_SIZE, maxlen=BUFFER_SIZE)
mic2_buffer = deque([0] * BUFFER_SIZE, maxlen=BUFFER_SIZE)

baseline_rms = 1
total_good = 0
total_count = 0

# 미세조정 파라미터
PHASE_ADJUST_RANGE = np.radians(20)  # ±20도 범위
PHASE_STEP = np.radians(3)           # 3도씩 조정
phase_offset = 0.0  # lock_phase 기준 오프셋

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

# 측정 - 더 정밀한 밴드패스
def get_rms(buffer, freq=None, bw=20):
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

# 빠른 측정 (최근 샘플만)
def get_quick_rms(buffer, freq=None, bw=20):
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

# 메인
def main():
    global current_gain, current_phase, baseline_rms, is_locked
    global lock_gain, lock_phase, total_good, total_count, phase_offset
    
    print("\n" + "="*60)
    print("🔒⚡ Lock-On + Micro-Adjust ANC")
    print(f"타겟: {TARGET_FREQ} Hz")
    print("="*60)
    
    time.sleep(2)
    
    # 기준
    print("\n📏 기준 측정...")
    current_gain = 0
    time.sleep(1.5)
    baseline_rms = get_rms(mic2_buffer, TARGET_FREQ)
    print(f"   기준: {baseline_rms:.1f}")
    
    # 최적 탐색
    print("\n🔍 최적값 탐색...")
    
    best_phase = 0
    best_gain = 0.03
    best_reduction = 999
    
    # 정밀 탐색
    for gain in [0.015, 0.02, 0.025, 0.03, 0.035, 0.04, 0.045, 0.05, 0.055, 0.06]:
        current_gain = gain
        gains_best = 999
        gains_best_phase = 0
        
        for i in range(72):  # 5도 간격
            phase = i * (2 * np.pi / 72)
            current_phase = phase
            time.sleep(0.08)
            
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
    
    print(f"\n🎯 전체 최적: G={best_gain:.3f}, P={int(best_phase*180/np.pi)}°, 감소={best_reduction:+.1f}dB")
    
    # LOCK 기준 설정
    lock_gain = best_gain
    lock_phase = best_phase
    phase_offset = 0.0
    current_gain = lock_gain
    current_phase = lock_phase
    is_locked = True
    
    print(f"\n🔒 기준값 Lock!")
    print("-"*60)
    
    # 에러 기록 (이동평균)
    error_history = deque(maxlen=10)
    good_streak = 0
    bad_streak = 0
    
    # 모니터링 + 미세조정
    while is_running:
        time.sleep(0.15)
        
        # 현재 값 (Lock 기준 + 오프셋)
        current_gain = lock_gain
        current_phase = lock_phase + phase_offset
        
        # 측정
        orig = get_quick_rms(mic1_buffer, TARGET_FREQ)
        error = get_quick_rms(mic2_buffer, TARGET_FREQ)
        reduction = 20 * np.log10(error / baseline_rms) if baseline_rms > 0.1 else 0
        
        error_history.append(error)
        avg_error = np.mean(error_history) if len(error_history) > 0 else error
        
        total_count += 1
        
        # 성공 판정
        if reduction < -2:
            total_good += 1
            good_streak += 1
            bad_streak = 0
        else:
            good_streak = 0
            bad_streak += 1
        
        # --- 미세조정 로직 ---
        
        # 연속 3번 이상 나쁘면 위상 미세조정
        if bad_streak >= 3 and abs(phase_offset) < PHASE_ADJUST_RANGE:
            # 위상 조금씩 변경해서 테스트
            test_offsets = [phase_offset + PHASE_STEP, phase_offset - PHASE_STEP]
            best_test_offset = phase_offset
            best_test_error = error
            
            for test_offset in test_offsets:
                if abs(test_offset) > PHASE_ADJUST_RANGE:
                    continue
                    
                current_phase = lock_phase + test_offset
                time.sleep(0.1)
                test_error = get_quick_rms(mic2_buffer, TARGET_FREQ)
                
                if test_error < best_test_error:
                    best_test_error = test_error
                    best_test_offset = test_offset
            
            if best_test_offset != phase_offset:
                phase_offset = best_test_offset
                bad_streak = 0  # 조정했으니 리셋
        
        # 계속 좋으면 원점으로 천천히 복귀
        elif good_streak >= 10 and abs(phase_offset) > 0.01:
            # 원점 방향으로 천천히
            phase_offset *= 0.8
            if abs(phase_offset) < 0.01:
                phase_offset = 0
        
        # --- 출력 ---
        success_rate = (total_good / total_count * 100) if total_count > 0 else 0
        offset_deg = int(phase_offset * 180 / np.pi)
        
        if reduction < -5:
            status = "🟢🟢 강력!"
        elif reduction < -2:
            status = "🟢 상쇄"
        elif reduction < 0:
            status = "🟡 효과"
        else:
            status = "⚪ 대기"
        
        # 미세조정 표시
        adjust_str = f"±{abs(offset_deg)}°" if offset_deg != 0 else "0°"
        
        print(f"{status} | 원본:{orig:5.0f}→에러:{error:5.0f} | "
              f"감소:{reduction:+5.1f}dB | "
              f"🔒G:{lock_gain:.3f} P:{int(lock_phase*180/np.pi)}°{adjust_str:>4} | "
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
