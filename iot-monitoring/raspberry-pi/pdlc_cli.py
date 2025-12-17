#!/usr/bin/env python3
"""
💡 PDLC CLI 제어 스크립트
- GUI 없이 터미널에서 PDLC 제어
- API 서버와 연동하여 DB에 상태 저장
- SSH에서도 사용 가능
"""

import sys
import time
import requests
import argparse

# =====================================================
# 설정
# =====================================================
CONFIG = {
    'API_BASE_URL': 'http://localhost:3001/api',
    'DEVICE_ID': 'raspberry-pi-01',
    'PDLC_PIN': 17,  # GPIO 17 (물리적 핀 11)
}

# =====================================================
# GPIO 초기화
# =====================================================
pdlc = None
GPIO_AVAILABLE = False

try:
    from gpiozero import OutputDevice
    pdlc = OutputDevice(CONFIG['PDLC_PIN'], active_high=True, initial_value=False)
    GPIO_AVAILABLE = True
except Exception as e:
    print(f"⚠️ GPIO 초기화 실패: {e}")

# =====================================================
# API 함수
# =====================================================
def send_pdlc_state(state: bool) -> bool:
    """PDLC 상태를 서버로 전송하여 DB에 저장"""
    try:
        response = requests.post(
            f"{CONFIG['API_BASE_URL']}/pldc/control",
            json={
                'device_id': CONFIG['DEVICE_ID'],
                'state': state,
                'changed_by': 'pdlc-cli'
            },
            timeout=5
        )
        if response.status_code == 200:
            return response.json().get('success', False)
        return False
    except Exception as e:
        print(f"⚠️ API 오류: {e}")
        return False


def get_pdlc_status():
    """서버에서 PDLC 상태 가져오기"""
    try:
        response = requests.get(
            f"{CONFIG['API_BASE_URL']}/pldc/status",
            params={'device_id': CONFIG['DEVICE_ID']},
            timeout=5
        )
        if response.status_code == 200:
            data = response.json()
            return data.get('state', False), data.get('changed_at'), data.get('changed_by')
    except Exception as e:
        print(f"⚠️ API 오류: {e}")
    return None, None, None


# =====================================================
# PDLC 제어 함수
# =====================================================
def turn_on():
    """PDLC ON (투명)"""
    if GPIO_AVAILABLE and pdlc:
        pdlc.on()
        print("💡 GPIO: ON")
    
    if send_pdlc_state(True):
        print("✅ DB 저장 완료: ON (투명)")
    else:
        print("⚠️ DB 저장 실패 (GPIO는 동작함)")


def turn_off():
    """PDLC OFF (불투명)"""
    if GPIO_AVAILABLE and pdlc:
        pdlc.off()
        print("🌑 GPIO: OFF")
    
    if send_pdlc_state(False):
        print("✅ DB 저장 완료: OFF (불투명)")
    else:
        print("⚠️ DB 저장 실패 (GPIO는 동작함)")


def show_status():
    """현재 상태 표시"""
    state, changed_at, changed_by = get_pdlc_status()
    
    print("=" * 50)
    print("💡 PDLC 상태")
    print("=" * 50)
    
    if state is not None:
        status_text = "ON (투명)" if state else "OFF (불투명)"
        print(f"  현재 상태: {status_text}")
        if changed_at:
            print(f"  마지막 변경: {changed_at}")
        if changed_by:
            print(f"  변경자: {changed_by}")
    else:
        print("  ❌ 서버에서 상태를 가져올 수 없습니다")
    
    print(f"\n  GPIO 사용 가능: {'✅' if GPIO_AVAILABLE else '❌'}")
    print("=" * 50)


def toggle():
    """상태 토글"""
    state, _, _ = get_pdlc_status()
    if state is not None:
        if state:
            turn_off()
        else:
            turn_on()
    else:
        print("❌ 서버에서 현재 상태를 가져올 수 없습니다")


def interactive_mode():
    """인터랙티브 모드"""
    print("=" * 50)
    print("💡 PDLC CLI 제어 (인터랙티브 모드)")
    print("=" * 50)
    print("명령어:")
    print("  1 또는 on   - PDLC ON (투명)")
    print("  0 또는 off  - PDLC OFF (불투명)")
    print("  t 또는 toggle - 상태 토글")
    print("  s 또는 status - 현재 상태 확인")
    print("  q 또는 exit - 종료")
    print("=" * 50)
    
    try:
        while True:
            cmd = input("\n> ").strip().lower()
            
            if cmd in ['1', 'on']:
                turn_on()
            elif cmd in ['0', 'off']:
                turn_off()
            elif cmd in ['t', 'toggle']:
                toggle()
            elif cmd in ['s', 'status']:
                show_status()
            elif cmd in ['q', 'exit', 'quit']:
                print("👋 종료합니다")
                break
            elif cmd == '':
                continue
            else:
                print("❓ 알 수 없는 명령어입니다")
                
    except KeyboardInterrupt:
        print("\n👋 종료합니다")
    finally:
        if pdlc:
            try:
                pdlc.close()
            except:
                pass


# =====================================================
# 메인
# =====================================================
def main():
    parser = argparse.ArgumentParser(description='PDLC CLI 제어')
    parser.add_argument('command', nargs='?', default='interactive',
                        choices=['on', 'off', 'toggle', 'status', 'interactive'],
                        help='실행할 명령 (기본: interactive)')
    
    args = parser.parse_args()
    
    if args.command == 'on':
        turn_on()
    elif args.command == 'off':
        turn_off()
    elif args.command == 'toggle':
        toggle()
    elif args.command == 'status':
        show_status()
    else:
        interactive_mode()
    
    # 정리
    if pdlc and args.command != 'interactive':
        try:
            pdlc.close()
        except:
            pass


if __name__ == "__main__":
    main()




