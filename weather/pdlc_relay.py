import RPi.GPIO as GPIO
import time
import sys
import select  # 키보드 입력을 처리하기 위한 라이브러리

# 핀 번호 설정 (BCM 모드 사용)
# 아두이노 7번 핀을 라즈베리 파이 BCM 4번 핀으로 가정 (변경 가능)
RELAY_PIN = 17

# 릴레이 상태 상수 정의 (Active-High 가정)
# 만약 Active-Low 릴레이라면 ON과 OFF를 서로 바꿔주세요.
RELAY_ON = GPIO.HIGH
RELAY_OFF = GPIO.LOW

def setup_gpio():
    # BCM (GPIO 번호) 모드로 설정
    GPIO.setmode(GPIO.BCM) 
    
    # 릴레이 핀을 출력(OUTPUT)으로 설정
    GPIO.setup(RELAY_PIN, GPIO.OUT)
    
    # 초기 상태 설정 (PDLC OFF)
    GPIO.output(RELAY_PIN, RELAY_OFF)
    print(f"GPIO {RELAY_PIN} (BCM) 설정 완료. 초기 상태: OFF")
    print("PDLC 제어 준비 완료. 1=ON / 0=OFF 입력 후 Enter")

def main_loop():
    while True:
        # 키보드 입력 대기 (비동기 처리)
        # 0초 대기이므로 입력이 없으면 바로 통과
        if sys.stdin in select.select([sys.stdin], [], [], 0)[0]:
            cmd = sys.stdin.readline().strip()
        else:
            time.sleep(0.1) # CPU 부하를 줄이기 위해 짧은 대기
            continue

        if cmd == '1':
            GPIO.output(RELAY_PIN, RELAY_ON) # 릴레이 ON
            print("PDLC ON")
        elif cmd == '0':
            GPIO.output(RELAY_PIN, RELAY_OFF) # 릴레이 OFF
            print("PDLC OFF")
        elif cmd.lower() == 'exit' or cmd.lower() == 'q':
            print("프로그램 종료...")
            break
        elif cmd:
             print("잘못된 입력입니다. 1(ON) 또는 0(OFF)을 입력하세요.")

# 메인 함수 실행
if __name__ == '__main__':
    try:
        setup_gpio()
        main_loop()
    except KeyboardInterrupt:
        print("\n사용자 종료 요청.")
    except Exception as e:
        print(f"오류 발생: {e}")
    finally:
        # 프로그램 종료 시 GPIO 설정 초기화 (필수)
        GPIO.cleanup()
        print("GPIO 설정 초기화 완료.")