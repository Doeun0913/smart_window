# PDLC System Utilities

라즈베리 파이에서 PDLC 유리를 제어하고 DHT 센서 값을 확인하기 위한 간단한 스크립트 모음입니다.  
중복/불필요 파일(가상환경, `__pycache__`)은 모두 제거하고 필요한 소스만 남겨 최소 구조로 정리했습니다.

## 구성

- `dht_test.py` : Adafruit DHT11 센서 값을 지속적으로 출력
- `pdlc_relay.py` : 키보드 입력으로 PDLC 릴레이(GPIO 17)를 온/오프
- `requirements.txt` : 필요한 파이썬 패키지 목록 (하드웨어에 맞는 GPIO 백엔드 선택 설치)

## 환경 구성

```bash
cd /home/user/project/pdlc_system
python -m venv .venv
source venv/bin/activate
pip install -r requirements.txt
```

> **참고**  
> - 라즈베리 파이 5는 `RPi.GPIO` 대신 `rpi-lgpio`를 사용해야 합니다.  
> - `Adafruit-Blinka`는 `board` 모듈을 제공하므로 필수입니다.

## 실행 방법

```bash
python dht_test.py     # DHT11/22 센서 값 확인
python pdlc_relay.py   # 키보드 명령으로 PDLC 릴레이 제어
```

필요 시 `pdlc_relay.py` 내 `RELAY_PIN`과 Active-High/Low 설정을 하드웨어 환경에 맞게 조정하세요.