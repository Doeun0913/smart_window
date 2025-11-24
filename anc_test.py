import pyaudio
import numpy as np
import time

# --- 1. 파라미터 설정 (원본과 동일) ---
L_ANC = 1024             # ANC 필터(w)의 길이
MU_ANC = 0.0001          # ANC용 학습률
RATE = 16000             # 샘플링 레이트 (Hz)
CHUNK = 512              # 버퍼 크기
DTYPE = np.float32       # 데이터 타입 (원본의 paFloat32와 매칭)

# --- 2. PyAudio 라이브러리 설치 확인 ---
try:
    p = pyaudio.PyAudio()
    p.terminate()
    print("PyAudio 라이브러리가 성공적으로 로드되었습니다.")
except Exception as e:
    print(f"PyAudio 로드 실패: {e}")
    print("Jetson Nano에 PyAudio가 올바르게 설치되었는지 확인하세요.")
    print("예: sudo apt-get install python3-pyaudio portaudio19-dev")
    exit()

# --- 3. 보조 경로 모델 (S_hat) *시뮬레이션* ---
# 원본: S_hat = np.load('secondary_path_model.npy')
# 테스트용: S_hat을 임의의 값으로 생성합니다.
L_SYSID = 256 # S_hat의 길이 (임의로 설정, 실제 모델과 달라도 됨)
S_hat = np.random.randn(L_SYSID).astype(DTYPE) * 0.1
print(f"'S_hat' (보조경로 모델)을 시뮬레이션합니다. (길이: {L_SYSID})")


# --- 4. FxLMS 알고리즘 변수 초기화 (원본과 동일) ---
w = np.zeros(L_ANC, dtype=DTYPE)
BUFFER_LEN = max(L_ANC, L_SYSID)
x_buffer = np.zeros(BUFFER_LEN, dtype=DTYPE)
x_filtered_buffer = np.zeros(L_ANC, dtype=DTYPE)

print("\nANC 알고리즘 시뮬레이션 테스트를 시작합니다...")
print(f"ANC 필터 길이(w): {L_ANC}")
print(f"학습률(MU_ANC): {MU_ANC}")
print("약 10초간 시뮬레이션을 실행합니다... (Ctrl+C로 종료 가능)")

# --- 5. 메인 테스트 루프 (pyaudio.open() 및 콜백 대신) ---
start_time = time.time()
loop_count = 0
TEST_DURATION_SEC = 10.0 # 10초 동안 테스트

try:
    while time.time() - start_time < TEST_DURATION_SEC:
        
        # 1. [시뮬레이션] 가짜 입력 데이터 생성
        #    실제 마이크 입력을 랜덤 노이즈로 대체
        x_chunk = np.random.randn(CHUNK).astype(DTYPE)
        e_chunk = np.random.randn(CHUNK).astype(DTYPE) # 단순 테스트용

        y_out_chunk = np.zeros(CHUNK, dtype=DTYPE)

        # 2. [원본 로직] 원본 콜백의 샘플 단위 FxLMS 알고리즘 처리
        #    이 부분이 Jetson Nano의 CPU에서 실행되는 핵심 연산입니다.
        for n in range(CHUNK):
            x_n = x_chunk[n] # 현재 참조 신호 샘플
            e_n = e_chunk[n] # 현재 오차 신호 샘플
            
            # x_buffer 업데이트
            np.roll(x_buffer, -1)
            x_buffer[-1] = x_n
            
            # --- FxLMS 핵심 로직 (원본과 동일) ---
            
            # 1. '필터링된 x' (x') 신호 생성
            x_vec_sysid = x_buffer[-L_SYSID:][::-1]
            x_filtered_n = np.dot(S_hat, x_vec_sysid)
            
            #    x_filtered_buffer 업데이트
            np.roll(x_filtered_buffer, -1)
            x_filtered_buffer[-1] = x_filtered_n

            # 2. 제어 신호 y(n) 계산
            x_vec_anc = x_buffer[-L_ANC:][::-1]
            y_n = np.dot(w, x_vec_anc)
            y_out_chunk[n] = y_n # (시뮬레이션에서는 이 값을 사용하지 않음)
            
            # 3. 필터(w) 가중치 업데이트
            x_filtered_vec = x_filtered_buffer[::-1]
            w = w - MU_ANC * e_n * x_filtered_vec
        
        loop_count += 1
        
        # 0.5초마다 진행 상황 출력
        if loop_count % (int(RATE / CHUNK * 0.5)) == 0:
            print(f"  루프 {loop_count} 실행 중... (w의 첫 값: {w[0]:.6f})")

except KeyboardInterrupt:
    print("\n시뮬레이션을 중지합니다.")

end_time = time.time()

print("\n--- 젯슨 나노 테스트 완료 ---")
print(f"총 {end_time - start_time:.2f}초 동안 {loop_count}개의 데이터 청크를 처리했습니다.")
print(f"초당 약 {loop_count / (end_time - start_time):.1f} 청크 처리")
print(f"최종 'w' 필터의 첫 5개 값: {w[:5]}")
np.save('test_final_anc_filter_w.npy', w)
print("테스트 완료. 'test_final_anc_filter_w.npy' 파일이 저장되었습니다.")