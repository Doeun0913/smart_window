import pyaudio
import numpy as np
import time

# ==========================================
#  x_chunk = in_data_np[0::2] (왼쪽) = 주 경로
#  e_chunk = in_data_np[1::2] (오른쪽) = 보조 경로
# ==========================================
# 1. 오디오 장치 인덱스 (매우 중요! 확인 후 수정하세요)
# 실행 전에 넣어야됨 
MIC_INDEX = None  # (마이크) -> 모르면 None으로 두면 기본장치 사용
SPK_INDEX = None  # (DAC)  -> 모르면 None으로 두면 기본장치 사용

# 2. 오디오 공통 설정
RATE = 16000                 # 샘플링 레이트 (Hz)
CHUNK = 512                  # 버퍼 크기
FORMAT = pyaudio.paFloat32   # 32비트 처리

# 3. 알고리즘 설정
L_SYSID = 1024               # 보조 경로 모델 길이 (S_hat)
L_ANC = 1024                 # ANC 필터 길이 (w)
MU_SYSID = 0.001             # 보조 경로 측정용 학습률
MU_ANC = 0.0001              # ANC용 학습률 (발산하면 더 줄이세요: 0.00001)
MEASURE_TIME = 5             # 측정 시간 (초)

# ==========================================
# [전역 변수] 알고리즘 상태 저장
# ==========================================
# 보조 경로 모델 (S_hat) - 1단계에서 학습됨
S_hat = np.zeros(L_SYSID)

# ANC 필터 (w) - 2단계에서 학습됨
w = np.zeros(L_ANC)

# 버퍼들
x_buffer_sysid = np.zeros(L_SYSID)      # 측정용 버퍼
x_buffer_anc = np.zeros(max(L_ANC, L_SYSID)) # ANC용 참조 신호 버퍼
x_filtered_buffer = np.zeros(L_ANC)     # Filtered-X 버퍼

# PyAudio 객체
p = pyaudio.PyAudio()

# ==========================================
# [1단계] 보조 경로 측정 (System Identification)
# ==========================================
def measure_callback(in_data, frame_count, time_info, status):
    global S_hat, x_buffer_sysid
    
    # 입력: 오차 마이크(Right 채널)만 필요
    in_data_np = np.frombuffer(in_data, dtype=np.float32)
    d_chunk = in_data_np[1::2] # 오차 마이크 (Input 2)
    
    # 백색 소음 생성
    x_chunk = np.random.randn(frame_count).astype(np.float32)
    
    y_out_chunk = np.zeros(frame_count, dtype=np.float32)
    
    # LMS 알고리즘 수행
    for n in range(frame_count):
        # 버퍼 업데이트
        np.roll(x_buffer_sysid, -1)
        x_buffer_sysid[-1] = x_chunk[n]
        
        # 예측
        x_vec = x_buffer_sysid[::-1]
        y_est = np.dot(S_hat, x_vec)
        
        # 오차 계산
        e = d_chunk[n] - y_est
        
        # 가중치 업데이트 (S_hat 학습)
        S_hat = S_hat + MU_SYSID * e * x_vec
        
        # 출력은 백색 소음 그대로
        y_out_chunk[n] = x_chunk[n]
        
    return (y_out_chunk.tobytes(), pyaudio.paContinue)

def run_system_identification():
    print(f"\n[1단계] 보조 경로 측정을 시작합니다. ({MEASURE_TIME}초)")
    print(">> 스피커에서 '취-익' 소리가 납니다.")
    
    stream = p.open(format=FORMAT,
                    channels=2,
                    rate=RATE,
                    input=True,
                    output=True,
                    input_device_index=MIC_INDEX,
                    output_device_index=SPK_INDEX,
                    frames_per_buffer=CHUNK,
                    stream_callback=measure_callback)
    
    stream.start_stream()
    time.sleep(MEASURE_TIME)
    stream.stop_stream()
    stream.close()
    print("[1단계 완료] 보조 경로 모델(S_hat) 생성 완료.")

# ==========================================
# [2단계] ANC 실행 (FxLMS)
# ==========================================
def anc_callback(in_data, frame_count, time_info, status):
    global w, S_hat, x_buffer_anc, x_filtered_buffer
    
    in_data_np = np.frombuffer(in_data, dtype=np.float32)
    
    # 입력 분리
    x_chunk = in_data_np[0::2] # 참조 마이크 (Left)
    e_chunk = in_data_np[1::2] # 오차 마이크 (Right)
    
    y_out_chunk = np.zeros(frame_count, dtype=np.float32)
    
    # FxLMS 알고리즘
    for n in range(frame_count):
        x_n = x_chunk[n]
        e_n = e_chunk[n]
        
        # 버퍼 업데이트
        np.roll(x_buffer_anc, -1)
        x_buffer_anc[-1] = x_n
        
        # 1. Filtered-X 신호 만들기 (S_hat 이용)
        x_vec_sysid = x_buffer_anc[-L_SYSID:][::-1]
        x_filtered_n = np.dot(S_hat, x_vec_sysid)
        
        np.roll(x_filtered_buffer, -1)
        x_filtered_buffer[-1] = x_filtered_n
        
        # 2. 반대 위상 소음(y) 만들기
        x_vec_anc = x_buffer_anc[-L_ANC:][::-1]
        y_n = np.dot(w, x_vec_anc)
        y_out_chunk[n] = y_n
        
        # 3. ANC 필터(w) 업데이트
        x_filtered_vec = x_filtered_buffer[::-1]
        w = w - MU_ANC * e_n * x_filtered_vec
        
    return (y_out_chunk.tobytes(), pyaudio.paContinue)

def run_anc():
    print(f"\n[2단계] ANC 노이즈 캔슬링을 시작합니다.")
    print(">> 외부 소음을 상쇄하는 중입니다... (종료: Ctrl+C)")
    
    stream = p.open(format=FORMAT,
                    channels=2,
                    rate=RATE,
                    input=True,
                    output=True,
                    input_device_index=MIC_INDEX,
                    output_device_index=SPK_INDEX,
                    frames_per_buffer=CHUNK,
                    stream_callback=anc_callback)
    
    stream.start_stream()
    
    try:
        while stream.is_active():
            time.sleep(0.1)
    except KeyboardInterrupt:
        print("\n멈춤 요청 발생.")
    finally:
        stream.stop_stream()
        stream.close()
        print("[종료] 시스템을 정지합니다.")

# ==========================================
# [메인 실행부]
# ==========================================
if __name__ == "__main__":
    try:
        # 1. 측정 실행
        run_system_identification()
        
        # 잠시 대기 (시스템 안정화)
        time.sleep(1)
        
        # 2. ANC 실행
        run_anc()
        
    except Exception as e:
        print(f"오류 발생: {e}")
    finally:
        p.terminate()