#!/usr/bin/env python3
"""
Smart Home IoT - Adaptive ANC System
진정한 적응형 노이즈 캔슬링 시스템

특징:
1. 실시간 FFT로 소음 주파수 감지
2. LMS 알고리즘으로 게인/위상 자동 최적화
3. 에러 마이크 최소화 목표
"""

import serial
import struct
from collections import deque
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
COM_PORT = '/dev/ttyACM1'
BAUD_RATE = 115200
SAMPLE_RATE = 6300
AUDIO_SAMPLE_RATE = 44100

# API 설정
API_BASE_URL = 'http://localhost:3001/api'
API_SEND_INTERVAL = 2.0
DEVICE_ID = 'raspberry-pi-01'

# ANC 파라미터
INITIAL_GAIN = 0.0       # 시작 게인 (0으로 시작해서 점점 증가)
MAX_GAIN = 0.5           # 최대 게인
LEARNING_RATE = 0.0005   # LMS 학습률 (작을수록 안정적, 느림)
PHASE_STEP = 0.02        # 위상 미세 조정 스텝

# ==========================================
# 2. 상태 변수
# ==========================================
is_running = True
is_anc_active = False

# ANC 제어 변수
current_gain = 0.0
current_phase = 0.0
target_freq = 141.0  # 초기 타겟 주파수

# 버퍼
BUFFER_SIZE = 3150  # 0.5초 분량
original_buffer = deque([0] * BUFFER_SIZE, maxlen=BUFFER_SIZE)  # Mic1 - 원본
error_buffer = deque([0] * BUFFER_SIZE, maxlen=BUFFER_SIZE)     # Mic2 - 에러

# 통계
baseline_rms = 1.0
last_api_time = 0

# ==========================================
# 3. 오디오 출력 (역위상 사인파)
# ==========================================
audio_phase_accumulator = 0.0

def audio_callback(outdata, frames, time_info, status):
    global audio_phase_accumulator, current_gain, current_phase, target_freq
    
    if not is_anc_active or current_gain < 0.001:
        outdata.fill(0)
        return
    
    # 시간 배열 생성
    t = np.arange(frames) / AUDIO_SAMPLE_RATE
    
    # 역위상 사인파 생성 (위상을 π만큼 더해서 반전)
    # 원본 소음: sin(2πft)
    # 역위상: sin(2πft + π + 조정) = -sin(2πft + 조정)
    anti_phase = current_phase + np.pi  # 기본 180도 반전
    
    wave = current_gain * np.sin(2 * np.pi * target_freq * t + audio_phase_accumulator + anti_phase)
    
    # 위상 누적 (연속성 유지)
    audio_phase_accumulator += 2 * np.pi * target_freq * frames / AUDIO_SAMPLE_RATE
    audio_phase_accumulator = audio_phase_accumulator % (2 * np.pi)
    
    outdata[:] = wave.reshape(-1, 1)

# 오디오 스트림 시작
try:
    stream = sd.OutputStream(
        channels=1, 
        callback=audio_callback, 
        samplerate=AUDIO_SAMPLE_RATE, 
        blocksize=512
    )
    stream.start()
    print("🔊 오디오 출력 초기화 성공")
except Exception as e:
    print(f"⚠️ 오디오 출력 실패: {e}")
    stream = None

# ==========================================
# 4. 시리얼 통신
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
                    
                    # 부호 있는 값으로 변환
                    v1 = val1 - 32768  # Mic1: 원본 소음
                    v2 = val2 - 32768  # Mic2: 에러 (상쇄 후)
                    
                    original_buffer.append(v1)
                    error_buffer.append(v2)
                    
        except Exception as e:
            print(f"❌ 시리얼 오류: {e}")
            time.sleep(3)

# ==========================================
# 5. 신호 분석 함수
# ==========================================
def get_rms(buffer):
    """RMS 계산"""
    samples = np.array(list(buffer))
    if len(samples) == 0:
        return 1.0
    return np.sqrt(np.mean(samples**2)) + 1.0

def rms_to_db(rms):
    """RMS를 dB로 변환"""
    if rms < 1:
        return 20.0
    raw_db = 20 * np.log10(rms)
    return max(20.0, min(100.0, 20 + raw_db * 0.5))

def detect_dominant_frequency():
    """FFT로 지배 주파수 감지"""
    samples = np.array(list(original_buffer))
    if len(samples) < 1024:
        return None
    
    # 윈도우 적용
    windowed = samples[-2048:] * np.hanning(min(len(samples[-2048:]), 2048))
    
    # FFT
    fft_result = np.fft.fft(windowed)
    freqs = np.fft.fftfreq(len(windowed), 1/SAMPLE_RATE)
    magnitudes = np.abs(fft_result)[:len(windowed)//2]
    freqs = freqs[:len(windowed)//2]
    
    # 30Hz 이상에서 피크 찾기
    start_idx = int(30 * len(windowed) / SAMPLE_RATE)
    if start_idx >= len(magnitudes):
        return None
    
    peak_idx = np.argmax(magnitudes[start_idx:]) + start_idx
    
    if peak_idx < len(freqs):
        return abs(freqs[peak_idx])
    return None

def get_correlation():
    """원본과 에러 신호의 상관계수 계산 (위상 정보)"""
    orig = np.array(list(original_buffer))[-512:]
    err = np.array(list(error_buffer))[-512:]
    
    if len(orig) < 512 or len(err) < 512:
        return 0.0
    
    # 정규화
    orig = orig - np.mean(orig)
    err = err - np.mean(err)
    
    if np.std(orig) < 1 or np.std(err) < 1:
        return 0.0
    
    # 상관계수
    corr = np.correlate(orig, err, mode='same')
    return np.max(corr) / (len(orig) * np.std(orig) * np.std(err) + 1)

# ==========================================
# 6. 적응형 ANC 알고리즘
# ==========================================
def adaptive_anc():
    """
    LMS (Least Mean Squares) 기반 적응형 ANC
    
    목표: 에러 마이크(Mic2)의 RMS를 최소화
    
    알고리즘:
    1. 에러 신호를 모니터링
    2. 에러가 줄어들면 현재 방향 유지
    3. 에러가 늘어나면 반대 방향으로 조정
    """
    global current_gain, current_phase, target_freq, baseline_rms, is_anc_active
    
    print("\n" + "="*60)
    print("🎯 적응형 ANC 시작")
    print("="*60)
    
    # 1. 주파수 감지
    print("🔍 주파수 분석 중...")
    time.sleep(1)
    
    for _ in range(5):
        detected = detect_dominant_frequency()
        if detected and 30 < detected < 500:
            target_freq = detected
            break
        time.sleep(0.2)
    
    print(f"🎵 타겟 주파수: {target_freq:.1f} Hz")
    
    # 2. 기준 소음 측정 (ANC 꺼진 상태)
    print("📊 기준 소음 측정 중...")
    current_gain = 0.0
    is_anc_active = False
    time.sleep(1)
    
    baseline_rms = get_rms(error_buffer)
    baseline_db = rms_to_db(baseline_rms)
    print(f"📢 기준 소음: {baseline_rms:.0f} RMS ({baseline_db:.0f} dB)")
    
    # 3. ANC 활성화
    is_anc_active = True
    current_gain = 0.01  # 작게 시작
    current_phase = 0.0
    
    print("\n🚀 ANC 활성화!")
    print("-"*60)
    
    # 이전 에러값 (비교용)
    prev_error_rms = baseline_rms
    
    # 최적값 기록
    best_gain = current_gain
    best_phase = current_phase
    best_error = baseline_rms
    
    # 적응 루프
    iteration = 0
    stable_count = 0
    
    while is_running and is_anc_active:
        iteration += 1
        time.sleep(0.1)  # 100ms 간격
        
        # 현재 에러 측정
        current_error_rms = get_rms(error_buffer)
        original_rms = get_rms(original_buffer)
        
        # 감소량 계산
        if baseline_rms > 1:
            reduction_db = 20 * np.log10(current_error_rms / baseline_rms)
        else:
            reduction_db = 0
        
        # ===== 적응 알고리즘 =====
        
        # 에러가 줄어들었는가?
        if current_error_rms < prev_error_rms:
            # 좋아지고 있음 -> 같은 방향으로 계속
            stable_count += 1
            
            # 최적값 업데이트
            if current_error_rms < best_error:
                best_error = current_error_rms
                best_gain = current_gain
                best_phase = current_phase
            
            # 게인 천천히 증가 (에러가 줄어들고 있으므로)
            if current_gain < MAX_GAIN:
                current_gain += LEARNING_RATE * 2
                current_gain = min(current_gain, MAX_GAIN)
        
        elif current_error_rms > prev_error_rms * 1.05:
            # 나빠지고 있음 (5% 이상 증가)
            stable_count = 0
            
            # 게인이 너무 높으면 줄이기
            if current_gain > 0.02:
                current_gain -= LEARNING_RATE * 3
                current_gain = max(0.01, current_gain)
            
            # 위상 조정
            current_phase += PHASE_STEP
            if current_phase > 2 * np.pi:
                current_phase -= 2 * np.pi
        
        else:
            # 비슷함 -> 위상 미세 조정
            # 상관관계에 따라 위상 조정
            corr = get_correlation()
            
            if corr > 0.1:
                # 양의 상관 -> 위상 더 밀기
                current_phase += PHASE_STEP * 0.5
            elif corr < -0.1:
                # 음의 상관 -> 위상 반대로
                current_phase -= PHASE_STEP * 0.5
            
            current_phase = current_phase % (2 * np.pi)
        
        prev_error_rms = current_error_rms
        
        # ===== 상태 출력 (10회마다) =====
        if iteration % 10 == 0:
            orig_db = rms_to_db(original_rms)
            err_db = rms_to_db(current_error_rms)
            
            if reduction_db < -2:
                status = "🟢 효과 있음"
            elif reduction_db < 0:
                status = "🟡 미세 효과"
            else:
                status = "🔴 조정 중"
            
            print(f"[{iteration:4d}] {status} | "
                  f"원본: {orig_db:.0f}dB | 에러: {err_db:.0f}dB | "
                  f"감소: {reduction_db:+.1f}dB | "
                  f"게인: {current_gain:.3f} | 위상: {current_phase:.2f}")
        
        # ===== 성공 시 안정화 =====
        if stable_count > 30:  # 3초간 안정적
            print(f"\n✅ 안정화됨! 최적값 유지")
            print(f"   게인: {current_gain:.3f}, 위상: {current_phase:.2f}")
            print(f"   소음 감소: {reduction_db:.1f} dB")
            
            # 모니터링 모드로 전환
            monitoring_mode()
            stable_count = 0
    
    is_anc_active = False
    current_gain = 0.0
    print("\n🛑 ANC 종료")

def monitoring_mode():
    """
    안정화 후 모니터링 모드
    변화 감지 시 재조정
    """
    global current_gain, current_phase, is_anc_active
    
    print("📊 모니터링 모드...")
    
    stable_error = get_rms(error_buffer)
    check_count = 0
    
    while is_running and is_anc_active:
        time.sleep(0.5)
        check_count += 1
        
        current_error = get_rms(error_buffer)
        
        # 에러가 50% 이상 증가하면 재조정
        if current_error > stable_error * 1.5:
            print("⚠️ 소음 변화 감지, 재조정 시작...")
            return  # 적응 루프로 복귀
        
        # 10초마다 상태 출력
        if check_count % 20 == 0:
            orig_db = rms_to_db(get_rms(original_buffer))
            err_db = rms_to_db(current_error)
            reduction = 20 * np.log10(current_error / baseline_rms) if baseline_rms > 1 else 0
            
            print(f"[모니터링] 원본: {orig_db:.0f}dB | 에러: {err_db:.0f}dB | "
                  f"감소: {reduction:+.1f}dB")

# ==========================================
# 7. API 전송
# ==========================================
def send_to_api():
    global last_api_time
    
    while is_running:
        time.sleep(0.5)
        
        if time.time() - last_api_time < API_SEND_INTERVAL:
            continue
        
        try:
            orig_rms = get_rms(original_buffer)
            err_rms = get_rms(error_buffer)
            
            orig_db = rms_to_db(orig_rms)
            err_db = rms_to_db(err_rms)
            
            payload = {
                'original_db': round(orig_db, 2),
                'cancelled_db': round(err_db, 2),
                'device_id': DEVICE_ID
            }
            
            response = requests.post(
                f'{API_BASE_URL}/sensor/noise',
                json=payload,
                timeout=2.0
            )
            
            if response.status_code == 200:
                reduction = orig_db - err_db
                print(f"📡 API: 원본={orig_db:.0f}dB → 상쇄={err_db:.0f}dB "
                      f"(감소: {reduction:+.1f}dB)")
            
            last_api_time = time.time()
            
        except:
            last_api_time = time.time()

# ==========================================
# 8. 메인
# ==========================================
def signal_handler(sig, frame):
    global is_running, is_anc_active
    print("\n\n🛑 종료 신호...")
    is_anc_active = False
    is_running = False
    if stream:
        stream.stop()
        stream.close()
    sys.exit(0)

signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

def main():
    global is_anc_active
    
    print("="*60)
    print("🏠 Smart Home IoT - Adaptive ANC System")
    print("="*60)
    print(f"📡 API: {API_BASE_URL}")
    print(f"🔌 포트: {COM_PORT}")
    print("="*60)
    
    # 스레드 시작
    threading.Thread(target=read_serial, daemon=True).start()
    threading.Thread(target=send_to_api, daemon=True).start()
    
    print("\n⏳ Pico 연결 대기 중...")
    time.sleep(2)
    
    # 메인 ANC 루프
    while is_running:
        is_anc_active = True
        adaptive_anc()
        time.sleep(1)

if __name__ == "__main__":
    main()
