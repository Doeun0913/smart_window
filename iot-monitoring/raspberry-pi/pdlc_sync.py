#!/usr/bin/env python3
"""
🔄 PDLC 실시간 동기화 스크립트
- WebSocket으로 서버와 실시간 연결
- 웹 대시보드에서 PDLC 제어 시 즉시 GPIO 동작
- 폴링 방식 백업 (WebSocket 연결 실패 시)

사용법:
  python3 pdlc_sync.py

필요한 패키지:
  pip3 install websocket-client requests gpiozero
  pip3 install rpi-lgpio  # 라즈베리파이 5용
"""

import time
import json
import threading
import requests
import signal
import sys

# =====================================================
# 설정
# =====================================================
CONFIG = {
    'API_BASE_URL': 'http://localhost:3001/api',
    'WS_URL': 'ws://localhost:3001',
    'DEVICE_ID': 'raspberry-pi-01',
    'PDLC_PIN': 17,  # GPIO 17 (물리적 핀 11)
    'POLL_INTERVAL': 2,  # WebSocket 실패 시 폴링 간격 (초)
    'RECONNECT_DELAY': 5,  # WebSocket 재연결 대기 시간 (초)
}

# =====================================================
# GPIO 초기화
# =====================================================
pdlc = None
GPIO_AVAILABLE = False
gpio_handle = None

# 먼저 lgpio 시도 (라즈베리파이 5용)
try:
    import lgpio
    gpio_handle = lgpio.gpiochip_open(0)
    lgpio.gpio_claim_output(gpio_handle, CONFIG['PDLC_PIN'], 0)
    GPIO_AVAILABLE = True
    print(f"✅ GPIO 초기화 완료 (lgpio, GPIO {CONFIG['PDLC_PIN']})")
except ImportError:
    # gpiozero 시도 (라즈베리파이 4 이하)
    try:
        from gpiozero import OutputDevice
        pdlc = OutputDevice(CONFIG['PDLC_PIN'], active_high=True, initial_value=False)
        GPIO_AVAILABLE = True
        print(f"✅ GPIO 초기화 완료 (gpiozero, GPIO {CONFIG['PDLC_PIN']})")
    except Exception as e:
        print(f"⚠️ GPIO 초기화 실패: {e}")
        print("   PDLC 제어가 시뮬레이션 모드로 동작합니다.")
except Exception as e:
    print(f"⚠️ lgpio 초기화 실패: {e}")
    # gpiozero 폴백
    try:
        from gpiozero import OutputDevice
        pdlc = OutputDevice(CONFIG['PDLC_PIN'], active_high=True, initial_value=False)
        GPIO_AVAILABLE = True
        print(f"✅ GPIO 초기화 완료 (gpiozero fallback, GPIO {CONFIG['PDLC_PIN']})")
    except Exception as e2:
        print(f"⚠️ gpiozero도 실패: {e2}")

# =====================================================
# PDLC 제어 함수
# =====================================================
current_state = None

def set_pdlc_gpio(state: bool):
    """GPIO로 PDLC 제어"""
    global current_state
    
    if current_state == state:
        return  # 이미 같은 상태
    
    current_state = state
    status = "ON (투명)" if state else "OFF (불투명)"
    
    if GPIO_AVAILABLE:
        try:
            if gpio_handle is not None:
                # lgpio 사용
                import lgpio
                lgpio.gpio_write(gpio_handle, CONFIG['PDLC_PIN'], 1 if state else 0)
            elif pdlc is not None:
                # gpiozero 사용
                if state:
                    pdlc.on()
                else:
                    pdlc.off()
            print(f"💡 PDLC {status}")
        except Exception as e:
            print(f"❌ GPIO 제어 실패: {e}")
    else:
        print(f"💡 [시뮬레이션] PDLC {status}")


def get_pdlc_status_from_server():
    """서버에서 PDLC 상태 가져오기"""
    try:
        response = requests.get(
            f"{CONFIG['API_BASE_URL']}/pldc/status",
            params={'device_id': CONFIG['DEVICE_ID']},
            timeout=5
        )
        if response.status_code == 200:
            data = response.json()
            return data.get('state', False)
    except Exception as e:
        print(f"⚠️ 서버 상태 조회 실패: {e}")
    return None


# =====================================================
# WebSocket 클라이언트
# =====================================================
ws_connected = False
ws_client = None

def on_ws_message(ws, message):
    """WebSocket 메시지 수신"""
    try:
        data = json.loads(message)
        
        # PDLC 상태 변경 이벤트
        if data.get('type') == 'pldc_update':
            device_id = data.get('device_id')
            state = data.get('state')
            changed_by = data.get('changed_by', 'unknown')
            
            if device_id == CONFIG['DEVICE_ID']:
                print(f"📡 WebSocket: PDLC 상태 변경 수신 (by {changed_by})")
                set_pdlc_gpio(state)
                
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
    print(f"🔌 WebSocket 연결 종료 (code: {close_status_code})")


def on_ws_open(ws):
    """WebSocket 연결 성공"""
    global ws_connected
    ws_connected = True
    print("✅ WebSocket 연결됨 - 실시간 동기화 활성화!")
    
    # 디바이스 구독 메시지 전송
    subscribe_msg = json.dumps({
        'type': 'subscribe',
        'deviceId': CONFIG['DEVICE_ID']
    })
    ws.send(subscribe_msg)


def start_websocket():
    """WebSocket 연결 시작"""
    global ws_client
    
    try:
        import websocket
        
        ws_client = websocket.WebSocketApp(
            CONFIG['WS_URL'],
            on_open=on_ws_open,
            on_message=on_ws_message,
            on_error=on_ws_error,
            on_close=on_ws_close
        )
        
        # 별도 스레드에서 실행
        ws_thread = threading.Thread(
            target=ws_client.run_forever,
            kwargs={'reconnect': CONFIG['RECONNECT_DELAY']},
            daemon=True
        )
        ws_thread.start()
        return True
        
    except ImportError:
        print("⚠️ websocket-client 패키지가 없습니다.")
        print("   설치: pip3 install websocket-client")
        return False
    except Exception as e:
        print(f"⚠️ WebSocket 시작 실패: {e}")
        return False


# =====================================================
# 폴링 백업 (WebSocket 실패 시)
# =====================================================
def polling_loop():
    """서버 상태를 주기적으로 폴링"""
    global ws_connected
    
    while running:
        # WebSocket이 연결되어 있지 않을 때만 폴링
        if not ws_connected:
            state = get_pdlc_status_from_server()
            if state is not None:
                set_pdlc_gpio(state)
        
        time.sleep(CONFIG['POLL_INTERVAL'])


# =====================================================
# 메인
# =====================================================
running = True

def signal_handler(sig, frame):
    """종료 시그널 처리"""
    global running
    print("\n\n👋 종료 신호 수신...")
    running = False


def cleanup():
    """정리"""
    global gpio_handle, pdlc
    
    print("🧹 정리 중...")
    
    # GPIO 정리
    if gpio_handle is not None:
        try:
            import lgpio
            lgpio.gpio_write(gpio_handle, CONFIG['PDLC_PIN'], 0)
            lgpio.gpio_free(gpio_handle, CONFIG['PDLC_PIN'])
            lgpio.gpiochip_close(gpio_handle)
        except:
            pass
    
    if pdlc is not None:
        try:
            pdlc.off()
            pdlc.close()
        except:
            pass
    
    # WebSocket 종료
    if ws_client is not None:
        try:
            ws_client.close()
        except:
            pass
    
    print("✅ 정리 완료")


def main():
    global running
    
    print("=" * 60)
    print("🔄 PDLC 실시간 동기화 스크립트")
    print("=" * 60)
    print(f"📡 API 서버: {CONFIG['API_BASE_URL']}")
    print(f"🔌 WebSocket: {CONFIG['WS_URL']}")
    print(f"📟 디바이스: {CONFIG['DEVICE_ID']}")
    print(f"💡 PDLC GPIO: {CONFIG['PDLC_PIN']}")
    print(f"🔧 GPIO 사용 가능: {'✅' if GPIO_AVAILABLE else '❌ (시뮬레이션)'}")
    print("=" * 60)
    
    # 시그널 핸들러 등록
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    # 초기 상태 동기화
    print("\n📥 초기 상태 동기화 중...")
    initial_state = get_pdlc_status_from_server()
    if initial_state is not None:
        set_pdlc_gpio(initial_state)
        print(f"   현재 PDLC 상태: {'ON (투명)' if initial_state else 'OFF (불투명)'}")
    else:
        print("   ⚠️ 서버에서 초기 상태를 가져올 수 없습니다")
    
    # WebSocket 연결 시도
    print("\n🔌 WebSocket 연결 시도 중...")
    ws_started = start_websocket()
    
    if not ws_started:
        print("   ⚠️ WebSocket 연결 실패 - 폴링 모드로 동작")
    
    # 폴링 스레드 시작 (백업)
    poll_thread = threading.Thread(target=polling_loop, daemon=True)
    poll_thread.start()
    
    print("\n" + "=" * 60)
    print("🚀 동기화 시작! 웹에서 PDLC를 제어해보세요.")
    print("   종료: Ctrl+C")
    print("=" * 60 + "\n")
    
    try:
        # 메인 루프
        while running:
            time.sleep(1)
            
            # 연결 상태 표시 (10초마다)
            if int(time.time()) % 10 == 0:
                status = "WebSocket ✅" if ws_connected else f"폴링 ({CONFIG['POLL_INTERVAL']}초)"
                # 너무 많은 로그 방지를 위해 주석 처리
                # print(f"[{time.strftime('%H:%M:%S')}] 연결: {status}")
                pass
                
    except KeyboardInterrupt:
        pass
    finally:
        running = False
        cleanup()


if __name__ == "__main__":
    main()



