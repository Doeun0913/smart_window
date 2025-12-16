mport machine
import sys
import time
import struct

# --- 마이크 설정 ---
# Mic 1 (기준 마이크)
mic1 = machine.ADC(26)
# Mic 2 (에러 마이크)
mic2 = machine.ADC(27)

while True:
    # 최대한 빨리 읽고 보냄
    val1 = mic1.read_u16()
    val2 = mic2.read_u16()
    packet = struct.pack('>HH', val1, val2)
    sys.stdout.buffer.write(packet)
    # sleep 없음!
