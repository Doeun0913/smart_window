#!/usr/bin/env python3
"""
ANC 진단 및 캘리브레이션 도구
전체 위상/게인 스윕을 통해 최적 설정 찾기
"""

import serial
import struct
from collections import deque
import threading
import numpy as np
import sounddevice as sd
import time
import sys

# ==========================================
# 설정
# ==========================================
COM_PORT = '/dev/ttyACM1'
BAUD_RATE = 115200
SAMPLE_RATE = 6300
AUDIO_RATE = 44100

# ==========================================
# 상태
# ==========================================
current_gain = 0.0
current_phase = 0.0
target_freq = 141.0

BUFFER_SIZE = 3150
original_buffer = deque([0] * BUFFER_SIZE, maxlen=BUFFER_SIZE)
error_buffer = deque([0] * BUFFER_SIZE, maxlen=BUFFER_SIZE)

is_running = True

# ==========================================
# 오디오 출력
# ==========================================
phase_acc = 0.0

def audio_callback(outdata, frames, time_info, status):
    global phase_acc, current_gain, current_phase, target_freq
    
    if current_gain < 0.001:
        outdata.fill(0)
        return
    
    t = np.arange(frames) / AUDIO_RATE
    wave = current_gain * np.sin(2 * np.pi * target_freq * t + phase_acc + current_phase)
    phase_acc += 2 * np.pi * target_freq * frames / AUDIO_RATE
    phase_acc = phase_acc % (2 * np.pi)
    outdata[:] = wave.reshape(-1, 1)

stream = sd.OutputStream(channels=1, callback=audio_callback, samplerate=AUDIO_RATE, blocksize=256)
stream.start()
print("🔊 오디오 OK")

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
                    original_buffer.append(v1 - 32768)
                    error_buffer.append(v2 - 32768)
        except Exception as e:
            print(f"시리얼 오류: {e}")
            time.sleep(2)

threading.Thread(target=read_serial, daemon=True).start()

# ==========================================
# 측정
# ==========================================
def get_rms(buf):
    arr = np.array(list(buf))
    return np.sqrt(np.mean(arr**2)) + 1

def get_db(rms):
    return 20 + 20 * np.log10(max(rms, 1)) * 0.5

def detect_freq():
    samples = np.array(list(original_buffer))
    if len(samples) < 1024:
        return None
    fft = np.fft.fft(samples[-2048:])
    freqs = np.fft.fftfreq(len(samples[-2048:]), 1/SAMPLE_RATE)
    mags = np.abs(fft)[:len(fft)//2]
    start = int(30 * len(mags) * 2 / SAMPLE_RATE)
    peak = np.argmax(mags[start:]) + start
    return abs(freqs[peak]) if peak < len(freqs) else None

# ==========================================
# 메인 캘리브레이션
# ==========================================
def main():
    global current_gain, current_phase, target_freq, is_running
    
    print("\n" + "="*60)
    print("🔧 ANC 캘리브레이션 도구")
    print("="*60)
    
    time.sleep(2)
    
    # 1. 주파수 감지
    print("\n📊 주파수 분석...")
    detected = detect_freq()
    if detected and 30 < detected < 500:
        target_freq = detected
    print(f"🎵 타겟 주파수: {target_freq:.1f} Hz")
    
    # 2. 기준 측정 (무음)
    print("\n📏 기준 소음 측정 (무음)...")
    current_gain = 0
    time.sleep(1)
    baseline = get_rms(error_buffer)
    baseline_db = get_db(baseline)
    print(f"   기준 RMS: {baseline:.0f} ({baseline_db:.1f} dB)")
    
    # 3. 전체 위상 스윕
    print("\n" + "="*60)
    print("🔄 위상 스윕 (0° ~ 360°)")
    print("="*60)
    
    test_gains = [0.1, 0.2, 0.3, 0.4]
    
    best_overall_phase = 0
    best_overall_gain = 0
    best_overall_error = baseline
    
    for gain in test_gains:
        print(f"\n--- 게인: {gain} ---")
        current_gain = gain
        
        best_phase = 0
        best_error = 999999
        
        # 18단계 스윕 (20도씩)
        for i in range(18):
            phase = i * (2 * np.pi / 18)
            current_phase = phase
            time.sleep(0.15)
            
            error_rms = get_rms(error_buffer)
            change_db = 20 * np.log10(error_rms / baseline) if baseline > 1 else 0
            
            if error_rms < best_error:
                best_error = error_rms
                best_phase = phase
            
            phase_deg = int(phase * 180 / np.pi)
            bar_len = int(max(0, min(40, 20 + change_db * 2)))
            bar = "█" * bar_len
            
            if change_db < -2:
                mark = "✅"
            elif change_db < 0:
                mark = "🟡"
            else:
                mark = "🔴"
            
            print(f"  {phase_deg:3d}° | {mark} {change_db:+5.1f}dB | {bar}")
        
        best_change = 20 * np.log10(best_error / baseline) if baseline > 1 else 0
        print(f"  → 최적: {int(best_phase * 180 / np.pi)}° ({best_change:+.1f}dB)")
        
        if best_error < best_overall_error:
            best_overall_error = best_error
            best_overall_phase = best_phase
            best_overall_gain = gain
    
    # 4. 결과 출력
    print("\n" + "="*60)
    print("📊 캘리브레이션 결과")
    print("="*60)
    
    best_change_db = 20 * np.log10(best_overall_error / baseline) if baseline > 1 else 0
    
    print(f"   최적 게인: {best_overall_gain}")
    print(f"   최적 위상: {int(best_overall_phase * 180 / np.pi)}° ({best_overall_phase:.2f} rad)")
    print(f"   소음 감소: {best_change_db:+.1f} dB")
    
    if best_change_db < -3:
        print("\n✅ ANC 효과 있음! 이 설정으로 실행하세요.")
    elif best_change_db < -1:
        print("\n🟡 미세한 효과. 더 높은 게인이 필요할 수 있어요.")
    else:
        print("\n🔴 효과 없음. 다음을 확인하세요:")
        print("   - 스피커가 에러 마이크 가까이 있는지")
        print("   - 소음원이 일정한 톤인지 (랜덤 소음은 상쇄 어려움)")
        print("   - 마이크와 스피커 위치 조정")
    
    # 5. 최적값으로 실시간 테스트
    print("\n" + "="*60)
    print("🎯 최적 설정으로 실시간 테스트")
    print("="*60)
    
    current_gain = best_overall_gain
    current_phase = best_overall_phase
    
    print("Ctrl+C로 종료\n")
    
    try:
        while True:
            time.sleep(0.5)
            
            orig_rms = get_rms(original_buffer)
            err_rms = get_rms(error_buffer)
            
            orig_db = get_db(orig_rms)
            err_db = get_db(err_rms)
            change = 20 * np.log10(err_rms / baseline) if baseline > 1 else 0
            
            if change < -2:
                status = "🟢"
            elif change < 0:
                status = "🟡"
            else:
                status = "🔴"
            
            print(f"{status} 원본: {orig_db:.0f}dB | 에러: {err_db:.0f}dB | "
                  f"기준대비: {change:+.1f}dB | 게인: {current_gain:.2f}")
            
    except KeyboardInterrupt:
        print("\n\n종료")
        current_gain = 0
        is_running = False
        stream.stop()

if __name__ == "__main__":
    main()
