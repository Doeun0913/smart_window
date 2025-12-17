"""
🎧 Pico 자립형 단일톤 ANC (MicroPython)
- 노트북 없이 Pico 단독으로 1개 주파수(피드백) 상쇄
- 마이크: GP26(ADC0), 스피커/앰프 입력: GP0 PWM

주의:
- 단일 주파수(기본 200 Hz)용 간이 ANC입니다.
- PWM → RC 필터 → 앰프 입력이 권장됩니다.
- 충분한 성능이 필요하면 RP2040 C/C++ SDK 기반 펌웨어를 고려하세요.
"""

import math
import time
from machine import ADC, PWM, Pin

# =============================
# 설정값
# =============================
SAMPLE_RATE = 8000          # ADC 샘플링 (Hz)
BLOCK_SIZE = 256            # Goertzel 블록 크기
TARGET_FREQ = 200.0         # 상쇄 대상 주파수 (Hz)

PWM_PIN = 0                 # GP0 → 앰프
ADC_PIN = 26                # GP26 → 마이크

MAX_GAIN = 0.3              # PWM 진폭 상한 (0.0~0.5 권장)
MIN_GAIN = 0.02
PHASE_SMOOTH = 0.2          # 위상 보정 스무딩 계수
GAIN_SMOOTH = 0.1           # 게인 보정 스무딩 계수

# =============================
# 하드웨어 초기화
# =============================
adc = ADC(ADC_PIN)
pwm = PWM(Pin(PWM_PIN))
pwm.freq(250_000)           # 고주파 PWM
pwm.duty_u16(32768)         # 중앙 (무음)

# LED 상태 표시 (빌트인)
led = Pin("LED", Pin.OUT)

# =============================
# DDS 파형 발생기
# =============================
SINE_LEN = 256
sine_table = [int(32768 + 32767 * math.sin(2 * math.pi * i / SINE_LEN)) for i in range(SINE_LEN)]

phase_acc = 0.0
phase_step = TARGET_FREQ / 250_000 * SINE_LEN  # PWM 주파수 기준
phase_offset = 0.0
gain = 0.1

def output_pwm():
    global phase_acc
    phase_acc = (phase_acc + phase_step) % SINE_LEN
    idx = int((phase_acc + phase_offset) % SINE_LEN)
    sample = sine_table[idx]
    # 게인 적용 (0~1 스케일)
    centered = sample - 32768
    scaled = int(32768 + centered * gain)
    scaled = max(0, min(65535, scaled))
    pwm.duty_u16(scaled)

# =============================
# Goertzel 계산
# =============================
def goertzel(samples, target_freq, sample_rate):
    k = int(0.5 + (BLOCK_SIZE * target_freq) / sample_rate)
    omega = (2.0 * math.pi * k) / BLOCK_SIZE
    coeff = 2.0 * math.cos(omega)
    q0 = q1 = q2 = 0.0
    for s in samples:
        q0 = coeff * q1 - q2 + s
        q2 = q1
        q1 = q0
    real_part = q1 - q2 * math.cos(omega)
    imag_part = q2 * math.sin(omega)
    magnitude = math.sqrt(real_part * real_part + imag_part * imag_part) / len(samples)
    phase = math.atan2(imag_part, real_part)
    return magnitude, phase

# =============================
# 메인 루프
# =============================
def main():
    global phase_offset, gain

    print("🎧 Pico standalone ANC start")
    print(f"TARGET={TARGET_FREQ}Hz  SAMPLE_RATE={SAMPLE_RATE}  BLOCK={BLOCK_SIZE}")

    sample_interval_us = int(1_000_000 / SAMPLE_RATE)
    buf = [0] * BLOCK_SIZE
    led_timer = time.ticks_ms()

    while True:
        # 1) 샘플 수집
        for i in range(BLOCK_SIZE):
            t0 = time.ticks_us()
            raw = adc.read_u16()
            buf[i] = raw - 32768  # center
            output_pwm()          # DDS 업데이트
            # 타이밍 보정
            elapsed = time.ticks_diff(time.ticks_us(), t0)
            if elapsed < sample_interval_us:
                time.sleep_us(sample_interval_us - elapsed)

        # 2) 대상 주파수 성분 분석 (마이크)
        mag, phase = goertzel(buf, TARGET_FREQ, SAMPLE_RATE)

        # 3) 위상/게인 보정 (피드백 기반 단일톤)
        # 목표: 마이크에서 본 대상 성분을 180도 반대로 출력
        desired_phase = (phase + math.pi) % (2 * math.pi)
        # 현재 오프셋을 desired 쪽으로 스무딩
        phase_diff = (desired_phase - (phase_offset * (2 * math.pi / SINE_LEN)))
        # wrap to [-pi, pi]
        while phase_diff > math.pi:
            phase_diff -= 2 * math.pi
        while phase_diff < -math.pi:
            phase_diff += 2 * math.pi
        phase_offset += (phase_diff * PHASE_SMOOTH) * (SINE_LEN / (2 * math.pi))
        phase_offset %= SINE_LEN

        # 게인 추정: 마이크 크기 반비례로 조정 (간이)
        target_gain = max(MIN_GAIN, min(MAX_GAIN, 0.05 / (mag / 1000 + 1e-6)))
        gain = gain * (1 - GAIN_SMOOTH) + target_gain * GAIN_SMOOTH

        # 4) 모니터링 로그 (1초 간격)
        if time.ticks_diff(time.ticks_ms(), led_timer) > 1000:
            led.toggle()
            led_timer = time.ticks_ms()
            rms = math.sqrt(sum(x * x for x in buf) / len(buf))
            print("mag={:.1f}  phase={:.2f}  gain={:.3f}  rms={:.1f}".format(
                mag, phase, gain, rms
            ))


if __name__ == "__main__":
    main()

