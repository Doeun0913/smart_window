import pyaudio
import numpy as np
import time

# --- 파라미터 설정 ---
L_ANC = 1024                 # ANC 필터(w)의 길이 (샘플 수)                          이걸 튜닝해야됨
MU_ANC = 0.0001              # ANC용 학습률 (매우 중요! 작게 시작!)              이걸 튜닝해야됨
RATE = 16000                 # 샘플링 레이트 (Hz) - 측정 코드와 동일해야 함
CHUNK = 512                  # 버퍼 크기
FORMAT = pyaudio.paFloat32   # 32비트 부동소수점

# --- 1. 보조 경로 모델 로드 (하드코딩) ---
try:
    S_hat = np.load('secondary_path_model.npy')
    print("보조경로 모델('secondary_path_model.npy')을 성공적으로 로드했습니다.")
except FileNotFoundError:
    print("오류: 'secondary_path_model.npy' 파일을 찾을 수 없습니다.")
    print("먼저 '코드 1 (측정용 코드)'를 실행하여 모델을 생성해야 합니다.")
    exit()

L_SYSID = len(S_hat) # 측정된 보조 경로의 길이

# --- 2. FxLMS 알고리즘 변수 초기화 ---
# ANC 적응 필터 (w)
w = np.zeros(L_ANC)

# 버퍼 초기화
# 참조 신호(x) 버퍼: w와 S_hat 필터링에 모두 사용되므로 더 긴 쪽 기준으로 생성
BUFFER_LEN = max(L_ANC, L_SYSID)
x_buffer = np.zeros(BUFFER_LEN)

# '필터링된 x' (x') 버퍼: w 필터와 길이가 같아야 함
x_filtered_buffer = np.zeros(L_ANC)

# PyAudio 객체 생성
p = pyaudio.PyAudio()

# --- 3. 실시간 FxLMS 오디오 콜백 ---
def fxlms_callback(in_data, frame_count, time_info, status):
    global w, S_hat, x_buffer, x_filtered_buffer
    
    # 1. 입력 데이터(스테레오)를 numpy 배열로 변환
    in_data_np = np.frombuffer(in_data, dtype=np.float32)
    
    # 2. 채널 분리
    x_chunk = in_data_np[0::2] # 참조 마이크 (Input 1)
    e_chunk = in_data_np[1::2] # 오차 마이크 (Input 2)

    y_out_chunk = np.zeros(frame_count)

    # 3. 샘플 단위로 FxLMS 알고리즘 처리
    for n in range(frame_count):
        x_n = x_chunk[n] # 현재 참조 신호 샘플
        e_n = e_chunk[n] # 현재 오차 신호 샘플
        
        # x_buffer 업데이트 (가장 오래된 샘플 버리고 새 샘플 추가)
        np.roll(x_buffer, -1)
        x_buffer[-1] = x_n
        
        # --- FxLMS 핵심 로직 ---
        
        # 1. '필터링된 x' (x') 신호 생성
        #    x_buffer에서 S_hat 길이에 맞는 벡터 추출
        x_vec_sysid = x_buffer[-L_SYSID:][::-1]
        x_filtered_n = np.dot(S_hat, x_vec_sysid)
        
        #    x_filtered_buffer 업데이트
        np.roll(x_filtered_buffer, -1)
        x_filtered_buffer[-1] = x_filtered_n

        # 2. 제어 신호 y(n) 계산
        #    x_buffer에서 w 길이에 맞는 벡터 추출
        x_vec_anc = x_buffer[-L_ANC:][::-1]
        y_n = np.dot(w, x_vec_anc)
        y_out_chunk[n] = y_n # 출력 버퍼에 저장
        
        # 3. 필터(w) 가중치 업데이트
        #    x_filtered_buffer에서 벡터 추출
        x_filtered_vec = x_filtered_buffer[::-1]
        w = w - MU_ANC * e_n * x_filtered_vec
        
    # 4. 계산된 제어 신호(y)를 진동자로 출력
    out_data = y_out_chunk.astype(np.float32).tobytes()
    return (out_data, pyaudio.paContinue)

# --- 4. 메인 실행 ---
print("ANC 시스템 작동을 시작합니다...")
print(f"ANC 필터 길이(w): {L_ANC}")
print(f"보조경로 모델 길이(S_hat): {L_SYSID}")
print(f"학습률(MU_ANC): {MU_ANC}")
print("Ctrl+C를 눌러 종료합니다.")

stream = p.open(format=FORMAT,
                channels=2,             # 입력 채널 수 (참조, 오차)
                rate=RATE,
                input=True,
                output=True,
                output_channels=1,      # 출력 채널 수 (진동자 1개)
                frames_per_buffer=CHUNK,
                stream_callback=fxlms_callback) # FxLMS 콜백 등록

stream.start_stream()

# Ctrl+C로 종료할 때까지 대기
try:
    while stream.is_active():
        time.sleep(0.1)
except KeyboardInterrupt:
    print("ANC 시스템을 종료합니다.")

stream.stop_stream()
stream.close()
p.terminate()

print("최종 ANC 필터(w)가 업데이트되었습니다.")
# (선택사항) 최종 필터 가중치도 저장
np.save('final_anc_filter_w.npy', w)