import serial
import struct
import matplotlib.pyplot as plt
import matplotlib.animation as animation
from collections import deque
import threading

# --- 설정 ---
COM_PORT = 'COM4'      # <--- 본인 포트 번호로 수정!
BAUD_RATE = 115200
MAX_SAMPLES = 200      # 화면에 보여줄 데이터 개수 (너무 크면 느려짐)

# --- 데이터 저장소 (큐) ---
# 꽉 차면 알아서 옛날 데이터를 버리는 큐입니다.
data_mic1 = deque([0] * MAX_SAMPLES, maxlen=MAX_SAMPLES)
data_mic2 = deque([0] * MAX_SAMPLES, maxlen=MAX_SAMPLES)

# --- 시리얼 통신 연결 ---
try:
    ser = serial.Serial(COM_PORT, BAUD_RATE)
    print(f"✅ {COM_PORT} 연결 성공! 그래프 창이 뜰 때까지 잠시 기다리세요...")
except Exception as e:
    print(f"❌ 연결 실패: {e}")
    exit()

# --- 데이터 읽기 쓰레드 (백그라운드에서 계속 데이터 받기) ---
def read_serial():
    while True:
        try:
            # 4바이트(Mic1 2byte + Mic2 2byte)가 쌓이면 읽음
            if ser.in_waiting >= 4:
                packet = ser.read(4)
                val1, val2 = struct.unpack('>HH', packet)
                
                # 0~65535 데이터를 -32768 ~ +32767 로 변환 (중심점 맞추기)
                data_mic1.append(val1 - 32768)
                data_mic2.append(val2 - 32768)
        except:
            break

# 쓰레드 시작
t = threading.Thread(target=read_serial, daemon=True)
t.start()

# --- 그래프 설정 ---
fig, ax = plt.subplots()
line1, = ax.plot([], [], label='Mic 1 (GP26)', color='blue', linewidth=1)
line2, = ax.plot([], [], label='Mic 2 (GP27)', color='red', linewidth=1, alpha=0.7)

# 그래프 꾸미기
ax.set_ylim(-40000, 40000)      # Y축 범위 (소리 크기)
ax.set_xlim(0, MAX_SAMPLES)     # X축 범위 (시간)
ax.set_title("Dual Microphone Real-time Wave")
ax.legend(loc='upper right')
ax.grid(True)

# --- 애니메이션 업데이트 함수 ---
def update(frame):
    line1.set_ydata(data_mic1)
    line1.set_xdata(range(len(data_mic1)))
    
    line2.set_ydata(data_mic2)
    line2.set_xdata(range(len(data_mic2)))
    return line1, line2

# --- 실행 ---
ani = animation.FuncAnimation(fig, update, interval=10, blit=True)
plt.show()

# 종료 시 포트 닫기
ser.close()