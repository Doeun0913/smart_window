# # CircuitPython 환경 설정을 위한 Blinka 라이브러리 설치
# pip3 install --user Adafruit-Blinka

# # DHT 센서 제어를 위한 라이브러리 설치
# pip3 install --user adafruit-circuitpython-dht

import time
import board
import adafruit_dht
import sys

# 📌 BCM 핀 번호 설정 (예: GPIO 4번 핀)
# 라즈베리 파이의 물리적 핀 번호가 아닌 BCM(GPIO) 번호를 사용합니다.
DHT_PIN = board.D4

# DHT22 센서 객체 생성
try:
    # DHT22 (AM2302) 센서를 지정한 핀에 연결
    dht_device = adafruit_dht.DHT22(DHT_PIN)
    print("DHT22 센서 객체 생성 성공.")
except Exception as e:
    print(f"DHT22 센서 객체 생성 중 오류 발생: {e}")
    sys.exit(1)

print("온도와 습도 측정 시작...")

while True:
    try:
        # 센서로부터 습도와 온도를 읽어옴
        humidity = dht_device.humidity
        temperature = dht_device.temperature
        
        # 값이 성공적으로 읽혔는지 확인
        if humidity is not None and temperature is not None:
            # 섭씨와 화씨로 출력
            print(f"🌡️ 온도: {temperature:.1f} °C / {temperature * 9/5 + 32:.1f} °F")
            print(f"💧 습도: {humidity:.1f} %")
        else:
            print("데이터를 읽을 수 없습니다. 센서 연결을 확인해주세요.")

    except RuntimeError as error:
        # 센서 데이터 읽기 오류 처리 (CRC 에러 등)
        print(f"센서 읽기 오류: {error.args[0]}")
        # 오류가 발생하더라도 다음 시도를 위해 계속 진행
    
    except Exception as error:
        # 기타 모든 예외 처리
        dht_device.exit() # 프로그램 종료 시 센서 객체 정리
        raise error

    # 2초마다 측정 (DHT22는 너무 자주 측정하면 에러 발생 가능성이 높습니다)
    time.sleep(2.0)