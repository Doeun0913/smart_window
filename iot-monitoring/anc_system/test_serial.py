#!/usr/bin/env python3
"""
시리얼 데이터 테스트 스크립트
Pico에서 마이크 데이터가 제대로 들어오는지 확인
"""

import serial
import struct
import time
import numpy as np

COM_PORT = '/dev/ttyACM1'
BAUD_RATE = 115200

print("=" * 50)
print("🔍 Pico 시리얼 데이터 테스트")
print("=" * 50)
print(f"포트: {COM_PORT}")
print(f"속도: {BAUD_RATE}")
print("=" * 50)

try:
    ser = serial.Serial(COM_PORT, BAUD_RATE, timeout=1)
    ser.reset_input_buffer()
    print("✅ 연결 성공!\n")
except Exception as e:
    print(f"❌ 연결 실패: {e}")
    exit(1)

# 데이터 수집
mic1_values = []
mic2_values = []

print("📊 5초간 데이터 수집 중...")
print("-" * 50)

start_time = time.time()
packet_count = 0

while time.time() - start_time < 5:
    if ser.in_waiting >= 4:
        packet = ser.read(4)
        val1, val2 = struct.unpack('>HH', packet)
        
        # 부호 있는 값으로 변환 (중간값 32768 기준)
        v1 = val1 - 32768
        v2 = val2 - 32768
        
        mic1_values.append(v1)
        mic2_values.append(v2)
        packet_count += 1
        
        # 100개마다 출력
        if packet_count % 100 == 0:
            print(f"   읽음: {packet_count}개 | Mic1: {v1:6d} | Mic2: {v2:6d}")

ser.close()

print("-" * 50)
print(f"\n📈 수집 결과:")
print(f"   총 패킷: {packet_count}개")
print(f"   초당 패킷: {packet_count / 5:.0f}개")

if len(mic1_values) > 0:
    mic1_arr = np.array(mic1_values)
    mic2_arr = np.array(mic2_values)
    
    print(f"\n🎤 Mic1 (원본 소음):")
    print(f"   최소: {mic1_arr.min():6d}")
    print(f"   최대: {mic1_arr.max():6d}")
    print(f"   평균: {mic1_arr.mean():6.0f}")
    print(f"   RMS:  {np.sqrt(np.mean(mic1_arr**2)):6.0f}")
    
    print(f"\n🎤 Mic2 (에러 마이크):")
    print(f"   최소: {mic2_arr.min():6d}")
    print(f"   최대: {mic2_arr.max():6d}")
    print(f"   평균: {mic2_arr.mean():6.0f}")
    print(f"   RMS:  {np.sqrt(np.mean(mic2_arr**2)):6.0f}")
    
    # dB 변환 테스트
    rms1 = np.sqrt(np.mean(mic1_arr**2)) + 1
    rms2 = np.sqrt(np.mean(mic2_arr**2)) + 1
    
    # 원래 공식
    raw_db1 = 20 * np.log10(rms1)
    raw_db2 = 20 * np.log10(rms2)
    
    print(f"\n📊 dB 변환:")
    print(f"   Mic1 raw dB: {raw_db1:.1f}")
    print(f"   Mic2 raw dB: {raw_db2:.1f}")
    
    # 값이 변하는지 확인
    if mic1_arr.max() - mic1_arr.min() < 100:
        print("\n⚠️ 경고: Mic1 값이 거의 변하지 않음!")
    if mic2_arr.max() - mic2_arr.min() < 100:
        print("\n⚠️ 경고: Mic2 값이 거의 변하지 않음!")
else:
    print("\n❌ 데이터를 받지 못했습니다!")
    print("   Pico가 제대로 연결되어 있는지 확인하세요.")

print("\n" + "=" * 50)
