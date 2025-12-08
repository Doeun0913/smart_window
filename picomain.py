import machine
import sys
import time
import struct

# --- 마이크 설정 ---
# Mic 1 (기준 마이크)
mic1 = machine.ADC(26)
# Mic 2 (에러 마이크)
mic2 = machine.ADC(27)

while True:
    # 1. 두 마이크의 값을 읽습니다.
    val1 = mic1.read_u16()  # 0 ~ 65535
    val2 = mic2.read_u16()  # 0 ~ 65535
    
    # 2. 데이터를 4바이트 덩어리로 묶습니다. (Mic1 2바이트 + Mic2 2바이트)
    # '>HH'는 Big-Endian 방식으로 Unsigned Short(2byte) 두 개라는 뜻
    packet = struct.pack('>HH', val1, val2)
    
    # 3. USB로 전송
    sys.stdout.buffer.write(packet)
    
    # 너무 빠르면 그래프가 못 따라갈 수 있으니 미세한 딜레이 (필요시 조절)
    time.sleep_ms(2)
