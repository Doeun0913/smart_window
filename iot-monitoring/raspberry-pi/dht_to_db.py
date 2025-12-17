#!/usr/bin/env python3
"""
🌡️ DHT11 센서 데이터 → DB 저장 스크립트
- dht_test.py 기반으로 작동
- 센서 데이터를 API를 통해 PostgreSQL에 저장
- PDLC 상태도 서버에서 가져와서 제어
- WebSocket으로 실시간 PDLC 동기화
"""

import time
import sys
import requests
import threading
import json

# DHT11 라이브러리
import adafruit_dht
import board

# =====================================================
# 설정
# =====================================================
CONFIG = {
    'API_BASE_URL': 'http://localhost:3001/api',
    'WS_URL': 'ws://localhost:3001',
    'DEVICE_ID': 'raspberry-pi-01',
    'DHT_PIN': board.D4,        # GPIO 4 (물리적 핀 7)
    'PDLC_PIN': 17,             # GPIO 17 (물리적 핀 11)
    'COLLECT_INTERVAL': 60,     # 60초마다 DB에 저장
    'READ_INTERVAL': 5,         # 5초마다 센서 읽기 (안정성)
    'PDLC_CHECK_INTERVAL': 5,   # 5초마다 PDLC 상태 확인 (WebSocket 백업용)
    'WS_RECONNECT_DELAY': 5,    # WebSocket 재연결 대기 시간
}

# =====================================================
# DHT11 센서 초기화
# =====================================================
print("🌡️ DHT11 센서 초기화 중...")
try:
    # dht_test.py와 동일한 방식으로 초기화 (use_pulseio 옵션 없음)
    dht_device = adafruit_dht.DHT11(CONFIG['DHT_PIN'])
    print("✅ DHT11 센서 초기화 완료 (GPIO 4)")
except Exception as e:
    print(f"❌ DHT11 센서 초기화 실패: {e}")
    sys.exit(1)

# =====================================================
# PDLC GPIO 초기화 (gpiozero 사용)
# =====================================================
pdlc = None
PDLC_AVAILABLE = False

try:
    from gpiozero import OutputDevice
    pdlc = OutputDevice(CONFIG['PDLC_PIN'], active_high=True, initial_value=False)
    PDLC_AVAILABLE = True
    print(f"✅ PDLC GPIO 초기화 완료 (GPIO {CONFIG['PDLC_PIN']})")
except Exception as e:
    print(f"⚠️ PDLC GPIO 초기화 실패: {e}")
    print("   PDLC 제어 기능이 비활성화됩니다.")

# =====================================================
# API 함수
# =====================================================
def send_temperature_humidity(temp: float, humidity: float) -> bool:
    """온습도 데이터를 서버로 전송하여 DB에 저장"""
    try:
        response = requests.post(
            f"{CONFIG['API_BASE_URL']}/sensor/temperature-humidity",
            json={
                'device_id': CONFIG['DEVICE_ID'],
                'temperature': temp,
                'humidity': humidity
            },
            timeout=10
        )
        if response.status_code == 200:
            data = response.json()
            if data.get('success'):
                print(f"✅ DB 저장 완료: {temp}°C, {humidity}%")
                return True
        print(f"❌ 서버 응답 오류: {response.status_code}")
        return False
    except requests.exceptions.ConnectionError:
        print("⚠️ 서버 연결 실패 - 백엔드가 실행 중인지 확인하세요")
        return False
    except Exception as e:
        print(f"❌ API 오류: {e}")
        return False


def get_pdlc_status() -> bool:
    """서버에서 PDLC 상태 가져오기"""
    try:
        response = requests.get(
            f"{CONFIG['API_BASE_URL']}/pldc/status",
            params={'device_id': CONFIG['DEVICE_ID']},
            timeout=5
        )
        if response.status_code == 200:
            return response.json().get('state', False)
    except:
        pass
    return None


def set_pdlc(state: bool):
    """PDLC 상태 설정 (GPIO 제어)"""
    if PDLC_AVAILABLE and pdlc:
        try:
            if state:
                pdlc.on()
            else:
                pdlc.off()
        except Exception as e:
            print(f"⚠️ PDLC 제어 실패: {e}")


def check_server_health() -> bool:
    """서버 연결 상태 확인"""
    try:
        response = requests.get(f"{CONFIG['API_BASE_URL']}/health", timeout=3)
        return response.status_code == 200
    except:
        return False


# =====================================================
# WebSocket 실시간 PDLC 동기화
# =====================================================
ws_connected = False
ws_client = None
current_pdlc_state = False

def on_ws_message(ws, message):
    """WebSocket 메시지 수신 - PDLC 상태 변경 즉시 반영"""
    global current_pdlc_state
    try:
        data = json.loads(message)
        
        # PDLC 상태 변경 이벤트
        if data.get('type') == 'pldc_update':
            device_id = data.get('device_id')
            state = data.get('state')
            changed_by = data.get('changed_by', 'unknown')
            
            if device_id == CONFIG['DEVICE_ID']:
                if state != current_pdlc_state:
                    print(f"📡 WebSocket: PDLC 변경 수신 (by {changed_by})")
                    set_pdlc(state)
                    current_pdlc_state = state
                
    except json.JSONDecodeError as e:
        print(f"⚠️ JSON 파싱 오류: {e}")
    except Exception as e:
        print(f"⚠️ 메시지 처리 오류: {e}")


def on_ws_error(ws, error):
    """WebSocket 에러"""
    global ws_connected
    ws_connected = False
    print(f"⚠️ WebSocket 에러: {error}")


def on_ws_close(ws, close_status_code, close_msg):
    """WebSocket 연결 종료"""
    global ws_connected
    ws_connected = False
    print(f"🔌 WebSocket 연결 종료")


def on_ws_open(ws):
    """WebSocket 연결 성공"""
    global ws_connected
    ws_connected = True
    print("✅ WebSocket 연결됨 - 실시간 PDLC 동기화 활성!")
    
    # 디바이스 구독 메시지 전송
    subscribe_msg = json.dumps({
        'type': 'subscribe',
        'deviceId': CONFIG['DEVICE_ID']
    })
    ws.send(subscribe_msg)


def start_websocket():
    """WebSocket 연결 시작"""
    global ws_client, ws_connected
    
    try:
        import websocket
        
        while True:
            try:
                ws_client = websocket.WebSocketApp(
                    CONFIG['WS_URL'],
                    on_open=on_ws_open,
                    on_message=on_ws_message,
                    on_error=on_ws_error,
                    on_close=on_ws_close
                )
                ws_client.run_forever()
            except Exception as e:
                print(f"⚠️ WebSocket 연결 실패: {e}")
            
            # 재연결 대기
            ws_connected = False
            print(f"🔄 {CONFIG['WS_RECONNECT_DELAY']}초 후 WebSocket 재연결...")
            time.sleep(CONFIG['WS_RECONNECT_DELAY'])
            
    except ImportError:
        print("⚠️ websocket-client 패키지 없음 - 폴링 모드로 동작")
        print("   설치: pip3 install websocket-client")


# =====================================================
# DHT11 센서 읽기 (dht_test.py와 동일한 방식)
# =====================================================
def read_dht11():
    """DHT11에서 온습도 읽기 (최대 5회 시도)"""
    for attempt in range(5):
        try:
            # dht_test.py와 동일한 순서: humidity 먼저, temperature 나중
            humidity = dht_device.humidity
            temperature = dht_device.temperature
            
            if humidity is not None and temperature is not None:
                return round(temperature, 1), round(humidity, 1)
            else:
                print(f"⚠️ 시도 {attempt+1}: 센서 값 없음")
                
        except RuntimeError as e:
            print(f"⚠️ 시도 {attempt+1}: {e}")
        
        time.sleep(2)
    
    return None, None


# =====================================================
# 메인 루프
# =====================================================
def main():
    global current_pdlc_state, ws_connected
    
    print("=" * 60)
    print("🏠 Smart Home IoT - DHT11 + PDLC 통합 스크립트")
    print("=" * 60)
    print(f"📡 API 서버: {CONFIG['API_BASE_URL']}")
    print(f"🔌 WebSocket: {CONFIG['WS_URL']}")
    print(f"🌡️ DHT11: GPIO 4 (물리적 핀 7)")
    print(f"💡 PDLC: {'✅ GPIO 17' if PDLC_AVAILABLE else '❌ 사용 불가'}")
    print(f"⏱️ DB 저장 주기: {CONFIG['COLLECT_INTERVAL']}초")
    print("=" * 60)
    
    # 서버 연결 확인
    if check_server_health():
        print("✅ 서버 연결됨")
    else:
        print("⚠️ 서버 연결 안됨 - 나중에 연결되면 자동으로 저장됩니다")
    
    # 초기 PDLC 상태 동기화
    if PDLC_AVAILABLE:
        initial_state = get_pdlc_status()
        if initial_state is not None:
            set_pdlc(initial_state)
            current_pdlc_state = initial_state
            print(f"💡 초기 PDLC 상태: {'ON (투명)' if initial_state else 'OFF (불투명)'}")
    
    # WebSocket 스레드 시작 (실시간 PDLC 동기화)
    ws_thread = threading.Thread(target=start_websocket, daemon=True)
    ws_thread.start()
    print("🔌 WebSocket 연결 시도 중...")
    
    print("\n📊 데이터 수집 시작... (Ctrl+C로 종료)\n")
    
    last_db_save = 0
    last_pdlc_check = 0
    
    try:
        while True:
            current_time = time.time()
            
            # 센서 데이터 읽기 및 출력
            temp, humidity = read_dht11()
            
            if temp is not None and humidity is not None:
                ws_status = "WS✅" if ws_connected else "WS❌"
                print(f"🌡️ {temp}°C | 💧 {humidity}% | {ws_status}")
                
                # DB 저장 (주기적으로)
                if current_time - last_db_save >= CONFIG['COLLECT_INTERVAL']:
                    send_temperature_humidity(temp, humidity)
                    last_db_save = current_time
            else:
                print("❌ 센서 읽기 실패")
            
            # PDLC 상태 확인 및 동기화 (WebSocket 백업 - 폴링)
            # WebSocket이 연결 안됐을 때만 폴링
            if PDLC_AVAILABLE and not ws_connected:
                if current_time - last_pdlc_check >= CONFIG['PDLC_CHECK_INTERVAL']:
                    server_state = get_pdlc_status()
                    if server_state is not None and server_state != current_pdlc_state:
                        print(f"🔄 PDLC 폴링 동기화: {'ON' if server_state else 'OFF'}")
                        set_pdlc(server_state)
                        current_pdlc_state = server_state
                    last_pdlc_check = current_time
            
            time.sleep(CONFIG['READ_INTERVAL'])
            
    except KeyboardInterrupt:
        print("\n\n👋 종료 요청...")
    finally:
        # 정리
        if pdlc:
            try:
                pdlc.off()
                pdlc.close()
            except:
                pass
        
        try:
            dht_device.exit()
        except:
            pass
        
        print("✅ 정리 완료")


if __name__ == "__main__":
    main()

