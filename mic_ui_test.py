import pyaudio
import numpy as np
import matplotlib.pyplot as plt

# ==========================================
# [설정 영역]
# ==========================================
MIC_INDEX = None       # 장치 번호 확인 후 숫자 입력 (모르면 None)
RATE = 16000           # 샘플링 레이트
CHUNK = 1024           # 한 번에 그릴 데이터 양 (크면 느려지고, 작으면 빠름)
FORMAT = pyaudio.paFloat32

# ==========================================
# [UI 초기화] Matplotlib 그래프 설정
# ==========================================
# 창 크기 설정 (가로 10인치, 세로 6인치)
fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(10, 6))
plt.subplots_adjust(hspace=0.5) # 그래프 간격 조정

# X축 데이터 (샘플 수)
x_data = np.arange(0, CHUNK)

# 1. 참조 마이크 (Left) 그래프 설정 - 파란색
line1, = ax1.plot(x_data, np.zeros(CHUNK), 'b-')
ax1.set_title('Reference Mic (Left / Ch 0) - Outside Window')
ax1.set_ylim(-1.0, 1.0) # Y축 범위 (-1 ~ 1)
ax1.set_ylabel('Amplitude')
ax1.grid(True)

# 2. 오차 마이크 (Right) 그래프 설정 - 빨간색
line2, = ax2.plot(x_data, np.zeros(CHUNK), 'r-')
ax2.set_title('Error Mic (Right / Ch 1) - Inside/Transducer')
ax2.set_ylim(-1.0, 1.0)
ax2.set_ylabel('Amplitude')
ax2.grid(True)

# ==========================================
# [오디오 스트림 시작]
# ==========================================
p = pyaudio.PyAudio()

try:
    stream = p.open(format=FORMAT,
                    channels=2,          # 스테레오
                    rate=RATE,
                    input=True,
                    input_device_index=MIC_INDEX,
                    frames_per_buffer=CHUNK)
    
    print("마이크 테스트 UI가 시작되었습니다.")
    print("창을 닫으면 종료됩니다.")

    # ==========================================
    # [메인 루프] 실시간 업데이트
    # ==========================================
    while True:
        try:
            # 1. 마이크 데이터 읽기 (예외 처리 포함)
            data = stream.read(CHUNK, exception_on_overflow=False)
            data_np = np.frombuffer(data, dtype=np.float32)
            
            # 2. 채널 분리
            # 짝수 인덱스 = 왼쪽(참조), 홀수 인덱스 = 오른쪽(오차)
            left_data = data_np[0::2]
            right_data = data_np[1::2]
            
            # 3. 데이터 길이가 CHUNK와 맞는지 확인 (안 맞으면 건너뜀)
            if len(left_data) != CHUNK or len(right_data) != CHUNK:
                continue

            # 4. 그래프 데이터 업데이트
            line1.set_ydata(left_data)
            line2.set_ydata(right_data)
            
            # 5. 화면 갱신 (아주 짧게 멈춰서 그림 그릴 시간을 줌)
            plt.pause(0.01)
            
            # 창이 닫히면 루프 종료
            if not plt.fignum_exists(fig.number):
                break
                
        except KeyboardInterrupt:
            break

except Exception as e:
    print(f"오류 발생: {e}")
    print("장치 번호(MIC_INDEX)를 확인해보세요.")

finally:
    if 'stream' in locals():
        stream.stop_stream()
        stream.close()
    p.terminate()
    print("테스트 종료")