import pyaudio
import numpy as np
import time

# --- 파라미터 설정 ---
L_SYSID = 1024               # 측정할 보조 경로의 길이 (샘플 수)                      1024, 2048 넉넉하게 설정 그래프의 끝이 0에 수렴하는지 확인
MU_SYSID = 0.001             # 시스템 식별용 학습률 (매우 중요!)
DURATION = 5                 # 측정 시간 (초)
RATE = 16000                 # 샘플링 레이트 (Hz)
CHUNK = 512                  # 버퍼 크기
FORMAT = pyaudio.paFloat32   # 32비트 부동소수점

# 보조 경로 추정 필터 (우리가 찾으려는 것)
h = np.zeros(L_SYSID)
# 입력 신호(백색 소음) 버퍼
x_buffer = np.zeros(L_SYSID)

# PyAudio 객체 생성
p = pyaudio.PyAudio()

# 오디오 콜백 함수 (측정의 핵심)
def measurement_callback(in_data, frame_count, time_info, status):
    global h, x_buffer
    
    # 1. 입력 데이터(오차 마이크)를 numpy 배열로 변환
    # 입력 2개 중 1번 인덱스(두 번째 채널)가 오차 마이크라고 가정
    in_data_np = np.frombuffer(in_data, dtype=np.float32)
    d_chunk = in_data_np[1::2] # 오차 마이크 (Input 2)
    
    # 2. 출력할 백색 소음 생성
    x_chunk = np.random.randn(frame_count)
    
    # 3. LMS 알고리즘으로 보조 경로 'h'를 실시간으로 추정
    y_out_chunk = np.zeros(frame_count)
    
    for n in range(frame_count):
        # x_buffer 업데이트
        np.roll(x_buffer, -1)
        x_buffer[-1] = x_chunk[n]
        
        # 현재 'h'로 예측값 y 계산
        x_vec = x_buffer[::-1]
        y = np.dot(h, x_vec)
        
        # 실제 측정값 d와 예측값 y의 오차 e 계산
        e = d_chunk[n] - y
        
        # LMS 업데이트: h를 수정하여 e를 줄이는 방향으로 학습
        h = h + MU_SYSID * e * x_vec
        
        # 백색 소음을 그대로 출력
        y_out_chunk[n] = x_chunk[n]

    # 4. 백색 소음을 진동자로 출력
    out_data = y_out_chunk.astype(np.float32).tobytes()
    return (out_data, pyaudio.paContinue)

# --- 메인 실행 ---
print("보조경로 측정을 시작합니다... ({}초간 백색 소음 발생)".format(DURATION))

stream = p.open(format=FORMAT,
                channels=2,             # 입력 채널 수 (참조, 오차)
                rate=RATE,
                input=True,             # 입력
                output=True,            # 출력
                output_channels=1,      # 출력 채널 수 (진동자 1개)
                frames_per_buffer=CHUNK,
                stream_callback=measurement_callback)

stream.start_stream()
time.sleep(DURATION) # 지정된 시간 동안 측정
stream.stop_stream()
stream.close()
p.terminate()

# --- 결과 저장 ---
print("측정이 완료되었습니다. 모델을 'secondary_path_model.npy' 파일로 저장합니다.")
np.save('secondary_path_model.npy', h)

print("저장된 모델의 파형 (앞 50개 샘플):")
print(h[:50])

# (선택사항) matplotlib로 그래프 확인
try:
    import matplotlib.pyplot as plt
    plt.figure()
    plt.plot(h)
    plt.title("Measured Secondary Path Impulse Response (h)")
    plt.xlabel("Samples")
    plt.ylabel("Amplitude")
    plt.grid(True)
    plt.savefig("secondary_path_model.png")
    print("그래프를 'secondary_path_model.png'로 저장했습니다.")
except ImportError:
    print("matplotlib가 설치되지 않아 그래프를 저장할 수 없습니다.")
