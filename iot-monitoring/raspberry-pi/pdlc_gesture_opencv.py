#!/usr/bin/env python3
"""
🖐️ PDLC 손동작 제어 시스템 (OpenCV Only)
MediaPipe 없이 OpenCV 피부색 검출 + 컨투어 분석 사용

제스처:
  ✊ 주먹 (0-1개 손가락) = PDLC OFF (불투명)
  ✋ 손바닥 (4-5개 손가락) = PDLC ON (투명)

필요한 패키지:
  pip3 install opencv-python numpy
  pip3 install picamera2      # 라즈베리파이
  pip3 install rpi-lgpio      # 라즈베리파이5 GPIO
"""

import cv2
import numpy as np
import time
import sys
import math
import requests
import threading
from collections import deque
from flask import Flask, Response

# 카메라 (Picamera2 우선)
USE_PICAMERA2 = False
try:
    from picamera2 import Picamera2
    USE_PICAMERA2 = True
    print("✅ Picamera2 사용")
except ImportError:
    print("⚠️ Picamera2 없음, OpenCV 카메라 사용")

# GPIO (Raspberry Pi 5용 lgpio)
GPIO_AVAILABLE = False
GPIO = None
try:
    import lgpio as GPIO
    GPIO_AVAILABLE = True
    print("✅ GPIO 사용 가능 (lgpio)")
except ImportError:
    print("⚠️ GPIO 시뮬레이션 모드")


# =====================================================
# 설정
# =====================================================
CONFIG = {
    'RELAY_PIN': 17,  # 물리적 핀 11 = BCM GPIO 17
    
    # 카메라 설정
    'CAMERA_WIDTH': 640,
    'CAMERA_HEIGHT': 480,
    
    # 제스처 인식 설정
    'GESTURE_HOLD_TIME': 0.6,   # 제스처 유지 시간 (초)
    'SMOOTHING_FRAMES': 5,      # 손가락 개수 평균 프레임
    
    # 화면 표시
    'SHOW_PREVIEW': False,
    'WEB_STREAM': True,
    'WEB_PORT': 5000,
    
    # 손 검출 설정 (더 관대하게)
    'MIN_HAND_AREA': 3000,      # 최소 면적 (낮춤)
    'MAX_HAND_AREA': 200000,    # 최대 면적 (높임)
    
    # ROI - 전체 화면 사용
    'USE_ROI': False,
    'ROI_X_RATIO': 0.0,
    
    # API 설정 (DB 저장용)
    'API_BASE_URL': 'http://localhost:3001/api',
    'DEVICE_ID': 'raspberry-pi-01',
}


# =====================================================
# PDLC 컨트롤러
# =====================================================
class PDLCController:
    """PDLC 릴레이 제어 + DB 저장"""
    
    def __init__(self, pin):
        self.pin = pin
        self.current_state = False
        self.initialized = False
        self.gpio_handle = None
        
        if GPIO_AVAILABLE:
            try:
                # lgpio: GPIO 칩 열기
                self.gpio_handle = GPIO.gpiochip_open(0)
                # 출력 핀으로 설정 (초기값 LOW)
                GPIO.gpio_claim_output(self.gpio_handle, self.pin, 0)
                self.initialized = True
                print(f"✅ GPIO {self.pin} 초기화 완료")
            except Exception as e:
                print(f"❌ GPIO 초기화 실패: {e}")
                if self.gpio_handle is not None:
                    try:
                        GPIO.gpiochip_close(self.gpio_handle)
                    except:
                        pass
                    self.gpio_handle = None
    
    def send_to_db(self, state: bool) -> bool:
        """PDLC 상태를 서버로 전송하여 DB에 저장"""
        try:
            response = requests.post(
                f"{CONFIG['API_BASE_URL']}/pldc/control",
                json={
                    'device_id': CONFIG['DEVICE_ID'],
                    'state': state,
                    'changed_by': 'gesture-opencv'
                },
                timeout=5
            )
            if response.status_code == 200:
                return response.json().get('success', False)
            return False
        except Exception as e:
            print(f"⚠️ DB 저장 실패: {e}")
            return False
    
    def set_state(self, state: bool):
        if state == self.current_state:
            return
        
        self.current_state = state
        
        # GPIO 제어
        if self.initialized and self.gpio_handle is not None:
            GPIO.gpio_write(self.gpio_handle, self.pin, 1 if state else 0)
        
        status = "ON (투명)" if state else "OFF (불투명)"
        print(f"💡 PDLC {status}")
        
        # DB에 저장
        if self.send_to_db(state):
            print("✅ DB 저장 완료")
        else:
            print("⚠️ DB 저장 실패 (GPIO는 동작함)")
    
    def cleanup(self):
        if self.initialized and self.gpio_handle is not None:
            try:
                # 핀을 LOW로 설정하고 정리
                GPIO.gpio_write(self.gpio_handle, self.pin, 0)
                GPIO.gpio_free(self.gpio_handle, self.pin)
                GPIO.gpiochip_close(self.gpio_handle)
                print("✅ GPIO 정리 완료")
            except Exception as e:
                print(f"⚠️ GPIO 정리 중 오류: {e}")


# =====================================================
# 손 인식 클래스 (OpenCV) - 피부색 검출 + 얼굴 제외
# =====================================================
class HandDetectorCV:
    """OpenCV 기반 손 검출 및 손가락 카운트 (얼굴 제외)"""
    
    def __init__(self):
        self.finger_buffer = deque(maxlen=CONFIG['SMOOTHING_FRAMES'])
        self.frame_count = 0
        self.bg_learning_frames = 1
        
        # 피부색 범위 (YCrCb) - 넓은 범위
        self.SKIN_LOWER_YCRCB = np.array([0, 130, 75], dtype=np.uint8)
        self.SKIN_UPPER_YCRCB = np.array([255, 185, 140], dtype=np.uint8)
        
        # 피부색 범위 (HSV) - 보조용
        self.SKIN_LOWER_HSV = np.array([0, 20, 70], dtype=np.uint8)
        self.SKIN_UPPER_HSV = np.array([20, 255, 255], dtype=np.uint8)
        
        # 얼굴 검출기 로드
        self.face_cascade = None
        try:
            # OpenCV 얼굴 검출기
            cascade_path = cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
            self.face_cascade = cv2.CascadeClassifier(cascade_path)
            print("✅ 얼굴 검출기 로드 완료 (얼굴 제외 모드)")
        except:
            print("⚠️ 얼굴 검출기 로드 실패")
        
        print("✅ 피부색 기반 손 검출 준비 완료")
        
    def detect_hand(self, frame):
        """피부색으로 손 검출 (얼굴 영역 제외)"""
        self.frame_count += 1
        h, w = frame.shape[:2]
        
        # 블러로 노이즈 감소
        blurred = cv2.GaussianBlur(frame, (5, 5), 0)
        
        # === 1. YCrCb 피부색 검출 ===
        ycrcb = cv2.cvtColor(blurred, cv2.COLOR_BGR2YCrCb)
        mask_ycrcb = cv2.inRange(ycrcb, self.SKIN_LOWER_YCRCB, self.SKIN_UPPER_YCRCB)
        
        # === 2. HSV 피부색 검출 ===
        hsv = cv2.cvtColor(blurred, cv2.COLOR_BGR2HSV)
        mask_hsv1 = cv2.inRange(hsv, self.SKIN_LOWER_HSV, self.SKIN_UPPER_HSV)
        mask_hsv2 = cv2.inRange(hsv, np.array([170, 20, 70]), np.array([180, 255, 255]))
        mask_hsv = cv2.bitwise_or(mask_hsv1, mask_hsv2)
        
        # === 3. 두 마스크 결합 ===
        combined_mask = cv2.bitwise_or(mask_ycrcb, mask_hsv)
        
        # === 4. 얼굴 영역 제외 ===
        if self.face_cascade is not None:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            faces = self.face_cascade.detectMultiScale(
                gray, scaleFactor=1.1, minNeighbors=5, minSize=(60, 60)
            )
            for (fx, fy, fw, fh) in faces:
                # 얼굴 영역을 약간 확장해서 제외
                margin = int(fw * 0.3)
                fx1 = max(0, fx - margin)
                fy1 = max(0, fy - margin)
                fx2 = min(w, fx + fw + margin)
                fy2 = min(h, fy + fh + margin)
                combined_mask[fy1:fy2, fx1:fx2] = 0
        
        # === 5. 화면 상단 1/4 제외 (얼굴이 주로 있는 영역) ===
        combined_mask[0:h//4, :] = 0
        
        # === 6. 모폴로지 연산 ===
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        combined_mask = cv2.morphologyEx(combined_mask, cv2.MORPH_OPEN, kernel, iterations=2)
        
        kernel_large = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11))
        combined_mask = cv2.morphologyEx(combined_mask, cv2.MORPH_CLOSE, kernel_large, iterations=2)
        
        combined_mask = cv2.dilate(combined_mask, kernel, iterations=1)
        
        return combined_mask, mask_ycrcb, mask_hsv
    
    def reset_background(self):
        """피부색 범위 초기화"""
        self.SKIN_LOWER_YCRCB = np.array([0, 130, 75], dtype=np.uint8)
        self.SKIN_UPPER_YCRCB = np.array([255, 185, 140], dtype=np.uint8)
        print("🔄 피부색 범위 초기화됨")
    
    def find_hand_contour(self, mask):
        """가장 큰 컨투어(손) 찾기"""
        contours, _ = cv2.findContours(
            mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )
        
        if not contours:
            return None
        
        # 가장 큰 컨투어 선택
        max_contour = max(contours, key=cv2.contourArea)
        area = cv2.contourArea(max_contour)
        
        # 면적 필터링만 적용
        if area < CONFIG['MIN_HAND_AREA'] or area > CONFIG['MAX_HAND_AREA']:
            return None
        
        return max_contour
    
    def count_fingers(self, contour, frame_shape):
        """Convexity Defects를 이용한 손가락 개수 세기 (개선됨)"""
        if contour is None:
            return None
        
        # Convex Hull
        hull = cv2.convexHull(contour, returnPoints=False)
        
        if len(hull) < 3:
            return 0
        
        try:
            # Convexity Defects 계산
            defects = cv2.convexityDefects(contour, hull)
        except:
            return 0
        
        if defects is None:
            return 0
        
        # 손 영역의 바운딩 박스로 크기 기준 설정
        x, y, w, h = cv2.boundingRect(contour)
        hand_size = max(w, h)
        
        # 최소 깊이 임계값 (손 크기의 15%)
        min_depth = hand_size * 0.15
        
        # 손가락 사이 골짜기 개수 세기
        finger_count = 0
        
        for i in range(defects.shape[0]):
            s, e, f, d = defects[i, 0]
            
            start = tuple(contour[s][0])
            end = tuple(contour[e][0])
            far = tuple(contour[f][0])
            
            # 세 점 사이의 각도 계산
            a = math.sqrt((end[0] - start[0])**2 + (end[1] - start[1])**2)
            b = math.sqrt((far[0] - start[0])**2 + (far[1] - start[1])**2)
            c = math.sqrt((end[0] - far[0])**2 + (end[1] - far[1])**2)
            
            # 코사인 법칙으로 각도 계산
            if b * c == 0:
                continue
            
            try:
                cos_val = (b**2 + c**2 - a**2) / (2 * b * c)
                cos_val = max(-1, min(1, cos_val))  # 범위 제한
                angle = math.acos(cos_val)
                angle_deg = math.degrees(angle)
            except:
                continue
            
            # 깊이 (손가락 사이 골짜기 깊이)
            depth = d / 256.0
            
            # 조건: 각도 100도 미만 (더 관대하게), 깊이가 손 크기 대비 충분
            if angle_deg < 100 and depth > min_depth:
                finger_count += 1
        
        # 골짜기 개수 + 1 = 손가락 개수 (최대 5)
        finger_count = min(finger_count + 1, 5)
        
        return finger_count
    
    def get_smoothed_count(self, count):
        """스무딩된 손가락 개수"""
        if count is not None:
            self.finger_buffer.append(count)
        
        if len(self.finger_buffer) == 0:
            return None
        
        return round(sum(self.finger_buffer) / len(self.finger_buffer))
    
    def process_frame(self, frame):
        """프레임 처리"""
        h, w = frame.shape[:2]
        display_frame = frame.copy()
        
        # ROI 설정 (선택적)
        if CONFIG['USE_ROI']:
            roi_x = int(w * CONFIG['ROI_X_RATIO'])
            roi = frame[:, roi_x:]
            roi_offset = roi_x
        else:
            roi = frame
            roi_offset = 0
        
        # 배경 제거 + 피부색으로 손 검출
        mask, fg_mask, skin_mask = self.detect_hand(roi)
        
        # 손 컨투어 찾기
        contour = self.find_hand_contour(mask)
        
        finger_count = None
        hand_detected = False
        
        if contour is not None:
            hand_detected = True
            
            # 손가락 개수 세기
            raw_count = self.count_fingers(contour, roi.shape)
            finger_count = self.get_smoothed_count(raw_count)
            
            # 시각화 (웹 스트리밍용으로 항상 그림)
            # 컨투어 오프셋 적용
            offset_contour = contour.copy()
            offset_contour[:, :, 0] += roi_offset
            
            # 컨투어 그리기 (녹색, 두껍게)
            cv2.drawContours(display_frame, [offset_contour], -1, (0, 255, 0), 3)
            
            # Convex Hull 그리기 (노란색)
            hull_points = cv2.convexHull(offset_contour)
            cv2.drawContours(display_frame, [hull_points], -1, (0, 255, 255), 2)
            
            # 바운딩 박스 그리기 (파란색)
            x, y, bw, bh = cv2.boundingRect(offset_contour)
            cv2.rectangle(display_frame, (x, y), (x+bw, y+bh), (255, 100, 0), 2)
            
            # 손 면적 표시
            area = cv2.contourArea(contour)
            cv2.putText(display_frame, f"Area: {int(area)}", (x, y-10),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 100, 0), 2)
            
            # 중심점 (분홍색)
            M = cv2.moments(contour)
            if M["m00"] != 0:
                cx = int(M["m10"] / M["m00"]) + roi_offset
                cy = int(M["m01"] / M["m00"])
                cv2.circle(display_frame, (cx, cy), 12, (255, 0, 255), -1)
                cv2.putText(display_frame, f"{finger_count}", (cx-8, cy+5),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
        else:
            self.finger_buffer.clear()
        
        # ROI 영역 표시
        if CONFIG['USE_ROI']:
            roi_x = int(w * CONFIG['ROI_X_RATIO'])
            cv2.rectangle(display_frame, (roi_x, 0), (w, h), (100, 100, 100), 2)
            cv2.putText(display_frame, "Hand Zone", (roi_x + 10, 25),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.6, (100, 100, 100), 2)
        
        return display_frame, mask, finger_count, hand_detected


# =====================================================
# 카메라
# =====================================================
class Camera:
    def __init__(self):
        self.cap = None
        self.picam = None
        
        if USE_PICAMERA2:
            try:
                self.picam = Picamera2()
                
                # BGR888로 직접 받기 (OpenCV와 호환)
                config = self.picam.create_preview_configuration(
                    main={
                        "size": (CONFIG['CAMERA_WIDTH'], CONFIG['CAMERA_HEIGHT']),
                        "format": "BGR888"  # OpenCV 호환 형식
                    }
                )
                self.picam.configure(config)
                self.picam.start()
                time.sleep(2)  # 카메라 안정화 대기
                
                # 자동 초점 시도 (카메라 모듈 3 / IMX708만 지원)
                self.af_supported = False
                try:
                    from libcamera import controls
                    self.picam.set_controls({"AfMode": controls.AfModeEnum.Continuous})
                    self.af_supported = True
                    print("✅ 자동 초점(AF) 활성화!")
                except:
                    try:
                        self.picam.set_controls({"AfMode": 2})  # 2 = Continuous
                        self.af_supported = True
                        print("✅ 자동 초점(AF) 활성화!")
                    except:
                        print("⚠️ 자동 초점 미지원 카메라 (IMX219 등)")
                        print("   → 렌즈를 물리적으로 돌려서 초점을 맞춰주세요")
                
                print(f"✅ Picamera2 초기화 완료 ({CONFIG['CAMERA_WIDTH']}x{CONFIG['CAMERA_HEIGHT']})")
                
            except Exception as e:
                print(f"⚠️ Picamera2 실패: {e}")
                self._init_opencv()
        else:
            self._init_opencv()
    
    def _init_opencv(self):
        self.cap = cv2.VideoCapture(0)
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, CONFIG['CAMERA_WIDTH'])
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, CONFIG['CAMERA_HEIGHT'])
        print("✅ OpenCV 카메라 초기화")
    
    def read(self):
        if self.picam:
            frame = self.picam.capture_array()
            # 채널 순서 수정 (BGR -> RGB 또는 그 반대)
            frame = frame[:, :, ::-1].copy()  # 채널 뒤집기
            
            # 샤프닝 필터로 초점 보완
            kernel = np.array([[-1, -1, -1],
                               [-1,  9, -1],
                               [-1, -1, -1]])
            frame = cv2.filter2D(frame, -1, kernel)
            
            return True, frame
        return self.cap.read()
    
    def release(self):
        if self.picam:
            self.picam.stop()
        if self.cap:
            self.cap.release()


# =====================================================
# 웹 스트리밍 서버
# =====================================================
flask_app = Flask(__name__)
flask_app.logger.disabled = True
import logging
log = logging.getLogger('werkzeug')
log.setLevel(logging.ERROR)

# 전역 프레임 저장용
current_frame = None
frame_lock = threading.Lock()

def generate_frames():
    """MJPEG 스트림 생성"""
    global current_frame
    while True:
        with frame_lock:
            if current_frame is None:
                time.sleep(0.1)
                continue
            frame = current_frame.copy()
        
        ret, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        if ret:
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + buffer.tobytes() + b'\r\n')
        time.sleep(0.033)  # ~30fps

@flask_app.route('/')
def index():
    """메인 페이지"""
    return '''
    <!DOCTYPE html>
    <html>
    <head>
        <title>🖐️ PDLC Gesture Control</title>
        <style>
            body { 
                font-family: Arial, sans-serif; 
                background: #1a1a2e; 
                color: #eee;
                margin: 0; 
                padding: 20px;
                text-align: center;
            }
            h1 { color: #00d9ff; }
            img { 
                max-width: 100%; 
                border: 3px solid #00d9ff;
                border-radius: 10px;
            }
            .info {
                background: #16213e;
                padding: 15px;
                border-radius: 10px;
                margin: 20px auto;
                max-width: 600px;
            }
            .gesture { font-size: 1.2em; margin: 10px 0; }
        </style>
    </head>
    <body>
        <h1>🖐️ PDLC 손동작 제어</h1>
        <img src="/video_feed" alt="Camera Stream">
        <div class="info">
            <div class="gesture">✊ 주먹 (0-1개) → PDLC OFF (불투명)</div>
            <div class="gesture">✋ 손바닥 (4-5개) → PDLC ON (투명)</div>
            <p>화면 우측 회색 영역에 손을 위치시키세요</p>
        </div>
    </body>
    </html>
    '''

@flask_app.route('/video_feed')
def video_feed():
    """비디오 스트림"""
    return Response(generate_frames(),
                    mimetype='multipart/x-mixed-replace; boundary=frame')


# =====================================================
# 메인 컨트롤러
# =====================================================
class GesturePDLCController:
    """손동작 PDLC 제어"""
    
    def __init__(self):
        print("\n" + "=" * 50)
        print("🖐️ PDLC 손동작 제어 (OpenCV)")
        print("=" * 50 + "\n")
        
        self.pdlc = PDLCController(CONFIG['RELAY_PIN'])
        self.camera = Camera()
        self.detector = HandDetectorCV()
        
        self.last_gesture = None
        self.gesture_start_time = None
        self.gesture_confirmed = False
        
        print("\n📖 사용법:")
        print("  ✊ 주먹 (0-1개 손가락) → PDLC OFF (불투명)")
        print("  ✋ 손바닥 (4-5개 손가락) → PDLC ON (투명)")
        print("  💡 손을 카메라에 가까이 대세요!")
        
        if CONFIG['WEB_STREAM']:
            print(f"\n🌐 웹 스트리밍: http://<라즈베리파이IP>:{CONFIG['WEB_PORT']}")
        
        print("\n⌨️ 터미널 명령어:")
        print("  1 = PDLC ON")
        print("  0 = PDLC OFF") 
        print("  r = 피부색 범위 초기화")
        print("  q = 종료\n")
    
    def get_gesture(self, finger_count):
        if finger_count is None:
            return None
        if finger_count <= 1:
            return "FIST"
        elif finger_count >= 4:
            return "PALM"
        return "NEUTRAL"
    
    def process_gesture(self, gesture):
        current_time = time.time()
        
        if gesture != self.last_gesture:
            self.last_gesture = gesture
            self.gesture_start_time = current_time
            self.gesture_confirmed = False
            return
        
        if gesture and not self.gesture_confirmed:
            hold_time = current_time - self.gesture_start_time
            
            if hold_time >= CONFIG['GESTURE_HOLD_TIME']:
                self.gesture_confirmed = True
                
                if gesture == "FIST":
                    self.pdlc.set_state(False)
                elif gesture == "PALM":
                    self.pdlc.set_state(True)
    
    def draw_ui(self, frame, mask, finger_count, gesture, hand_detected):
        h, w = frame.shape[:2]
        
        # 정보 패널
        cv2.rectangle(frame, (10, 10), (280, 190), (0, 0, 0), -1)
        cv2.rectangle(frame, (10, 10), (280, 190), (255, 255, 255), 2)
        
        # 손 감지 상태
        status_text = "Hand: DETECTED" if hand_detected else "Hand: Not Found"
        status_color = (0, 255, 0) if hand_detected else (100, 100, 100)
        cv2.putText(frame, status_text, (20, 35),
                   cv2.FONT_HERSHEY_SIMPLEX, 0.6, status_color, 2)
        
        # 손가락 개수 (크게 표시)
        finger_text = f"Fingers: {finger_count}" if finger_count is not None else "Fingers: -"
        cv2.putText(frame, finger_text, (20, 65),
                   cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 0), 2)
        
        # 제스처
        gesture_text = f"Gesture: {gesture or 'None'}"
        gesture_color = (0, 255, 0) if gesture in ["FIST", "PALM"] else (150, 150, 150)
        cv2.putText(frame, gesture_text, (20, 95),
                   cv2.FONT_HERSHEY_SIMPLEX, 0.6, gesture_color, 2)
        
        # PDLC 상태 (크게)
        pdlc_text = "PDLC: ON (Transparent)" if self.pdlc.current_state else "PDLC: OFF (Opaque)"
        pdlc_color = (0, 255, 0) if self.pdlc.current_state else (0, 0, 255)
        cv2.putText(frame, pdlc_text, (20, 125),
                   cv2.FONT_HERSHEY_SIMPLEX, 0.55, pdlc_color, 2)
        
        # 홀드 진행바
        if self.gesture_start_time and not self.gesture_confirmed and gesture:
            progress = min((time.time() - self.gesture_start_time) / CONFIG['GESTURE_HOLD_TIME'], 1.0)
            bar_width = int(240 * progress)
            cv2.rectangle(frame, (20, 140), (20 + bar_width, 160), (0, 255, 255), -1)
            cv2.rectangle(frame, (20, 140), (260, 160), (255, 255, 255), 2)
            cv2.putText(frame, f"Hold: {int(progress*100)}%", (100, 157),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 1)
        
        # 조작 가이드
        cv2.putText(frame, "r=Reset BG | 1/0=Manual | q=Quit", (20, 182),
                   cv2.FONT_HERSHEY_SIMPLEX, 0.4, (180, 180, 180), 1)
        
        # 마스크 미리보기 (우측 상단) - 흰색=손 감지 영역
        mask_small = cv2.resize(mask, (160, 120))
        # 그레이스케일 → 컬러 (녹색으로 표시)
        mask_color = np.zeros((120, 160, 3), dtype=np.uint8)
        mask_color[:, :, 1] = mask_small  # 녹색 채널
        frame[10:130, w-170:w-10] = mask_color
        cv2.rectangle(frame, (w-170, 10), (w-10, 130), (0, 255, 0), 2)
        cv2.putText(frame, "Detection Mask", (w-165, 145),
                   cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 255, 0), 1)
        
        return frame
    
    def reset_background(self):
        """배경 재학습"""
        self.detector.reset_background()
        print("🔄 배경 재학습 시작! 손을 화면에서 빼주세요.")
    
    def input_thread(self):
        """터미널 입력 처리 스레드"""
        import select
        print("터미널 명령 대기 중... (1=ON, 0=OFF, r=배경재학습, q=종료)")
        
        while self.running:
            # 비동기 입력 체크
            if select.select([sys.stdin], [], [], 0.5)[0]:
                cmd = sys.stdin.readline().strip().lower()
                
                if cmd == '1':
                    self.pdlc.set_state(True)
                elif cmd == '0':
                    self.pdlc.set_state(False)
                elif cmd == 'r':
                    self.reset_background()
                elif cmd == 'q':
                    print("종료 요청...")
                    self.running = False
                    break
    
    def run(self):
        global current_frame
        self.running = True
        
        # 웹 스트리밍 서버 시작
        if CONFIG['WEB_STREAM']:
            web_thread = threading.Thread(
                target=lambda: flask_app.run(
                    host='0.0.0.0', 
                    port=CONFIG['WEB_PORT'], 
                    threaded=True,
                    use_reloader=False
                ),
                daemon=True
            )
            web_thread.start()
            print(f"🌐 웹 스트리밍 시작: http://0.0.0.0:{CONFIG['WEB_PORT']}")
        
        # 터미널 입력 스레드 시작
        input_thread = threading.Thread(target=self.input_thread, daemon=True)
        input_thread.start()
        
        try:
            while self.running:
                ret, frame = self.camera.read()
                if not ret:
                    print("❌ 카메라 프레임 읽기 실패")
                    time.sleep(0.1)
                    continue
                
                frame = cv2.flip(frame, 1)
                
                # 손 인식
                frame, mask, finger_count, hand_detected = self.detector.process_frame(frame)
                
                # 제스처 처리
                gesture = self.get_gesture(finger_count)
                self.process_gesture(gesture)
                
                # UI 그리기 (웹 스트리밍용)
                frame = self.draw_ui(frame, mask, finger_count, gesture, hand_detected)
                
                # 웹 스트리밍용 프레임 업데이트
                if CONFIG['WEB_STREAM']:
                    with frame_lock:
                        current_frame = frame.copy()
                
                # 로컬 GUI (선택적)
                if CONFIG['SHOW_PREVIEW']:
                    cv2.imshow('PDLC Gesture Control (OpenCV)', frame)
                    key = cv2.waitKey(1) & 0xFF
                    if key == 27 or key == ord('q'):
                        break
                else:
                    time.sleep(0.033)  # ~30fps
        
        except KeyboardInterrupt:
            print("\n👋 종료...")
        
        finally:
            self.running = False
            self.cleanup()
    
    def cleanup(self):
        print("\n정리 중...")
        self.camera.release()
        self.pdlc.cleanup()
        cv2.destroyAllWindows()
        print("✅ 완료")


# =====================================================
# 진입점
# =====================================================
if __name__ == "__main__":
    controller = GesturePDLCController()
    controller.run()
