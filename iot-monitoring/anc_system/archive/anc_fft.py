#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AI-Enhanced Hybrid ANC System
LMS(즉시) + LSTM(지능형) 하이브리드 방식

설치 필요:
pip install torch numpy sounddevice pyserial requests
"""

import serial
import struct
from collections import deque, Counter
import threading
import numpy as np
import sounddevice as sd
import time
import requests
import signal
import sys
import io

# Windows 콘솔 한글 출력 설정
if sys.platform == 'win32':
    try:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')
    except:
        pass

# PyTorch 임포트
try:
    import torch
    import torch.nn as nn
    from torch.utils.data import Dataset, DataLoader
    TORCH_AVAILABLE = True
    print("OK PyTorch load success")
except ImportError:
    TORCH_AVAILABLE = False
    print("WARNING: PyTorch not installed - LMS mode only")
    print("Install: pip install torch --index-url https://download.pytorch.org/whl/cpu")

# ==========================================
# 설정
# ==========================================
COM_PORT = '/dev/ttyACM1'
BAUD_RATE = 115200
SAMPLE_RATE = 6300
FFT_SAMPLES = 6300

API_BASE_URL = 'http://localhost:3001/api'
API_SEND_INTERVAL = 2.0
DEVICE_ID = 'raspberry-pi-01'

TARGET_FREQ = 198.2
FIXED_GAIN = 0.15

# Delay 보상 설정 (실측값으로 조정!)
SYSTEM_DELAY_MS = 50
DELAY_SAMPLES = int((SYSTEM_DELAY_MS / 1000.0) * SAMPLE_RATE)

# LMS 설정
LMS_FILTER_LENGTH = 32
LMS_STEP_SIZE = 0.01
LMS_MOMENTUM = 0.9

# AI 설정
if TORCH_AVAILABLE:
    DEVICE = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    PREDICTION_HORIZON = min(DELAY_SAMPLES, 200)
    SEQUENCE_LENGTH = 50
    HIDDEN_SIZE = 64
    NUM_LAYERS = 2
    LEARNING_RATE = 0.001
    BATCH_SIZE = 32
    print(f"AI Device: {DEVICE}")

# ==========================================
# LMS 적응 필터
# ==========================================
class LMSAdaptiveFilter:
    def __init__(self, filter_length=LMS_FILTER_LENGTH, 
                 step_size=LMS_STEP_SIZE, momentum=LMS_MOMENTUM):
        self.filter_length = filter_length
        self.step_size = step_size
        self.momentum = momentum
        
        self.weights = np.zeros(filter_length)
        self.weight_velocity = np.zeros(filter_length)
        
        self.input_buffer = deque([0.0] * filter_length, maxlen=filter_length)
        self.prediction_buffer = deque([0.0] * DELAY_SAMPLES, maxlen=DELAY_SAMPLES)
        
        self.update_count = 0
        self.avg_error = 0.0
        
    def predict(self, new_sample):
        self.input_buffer.append(new_sample)
        x = np.array(self.input_buffer)
        
        current_prediction = np.dot(self.weights, x)
        
        if self.update_count > 50:
            weight_trend = self.weights[-5:].mean() - self.weights[-10:-5].mean()
            
            future_predictions = []
            for i in range(1, min(DELAY_SAMPLES, 100) + 1):
                future_pred = current_prediction + weight_trend * x[-1] * i * 0.1
                future_predictions.append(future_pred)
            
            self.prediction_buffer.clear()
            self.prediction_buffer.extend(future_predictions)
        else:
            self.prediction_buffer.clear()
            self.prediction_buffer.extend([current_prediction] * min(DELAY_SAMPLES, 100))
        
        return current_prediction
    
    def update(self, error):
        x = np.array(self.input_buffer)
        
        gradient = error * x
        self.weight_velocity = self.momentum * self.weight_velocity + self.step_size * gradient
        self.weights += self.weight_velocity
        
        max_weight = np.max(np.abs(self.weights))
        if max_weight > 5.0:
            self.weights *= 5.0 / max_weight
        
        self.update_count += 1
        self.avg_error = 0.95 * self.avg_error + 0.05 * abs(error)
    
    def get_status(self):
        return {
            'updates': self.update_count,
            'avg_error': self.avg_error,
            'weight_norm': np.linalg.norm(self.weights),
            'is_converged': self.update_count > 100 and self.avg_error < 500
        }

# ==========================================
# LSTM 예측 모델
# ==========================================
if TORCH_AVAILABLE:
    class NoisePredictorLSTM(nn.Module):
        def __init__(self, input_size=1, hidden_size=HIDDEN_SIZE, 
                     num_layers=NUM_LAYERS, output_size=PREDICTION_HORIZON):
            super(NoisePredictorLSTM, self).__init__()
            self.hidden_size = hidden_size
            self.num_layers = num_layers
            
            self.lstm = nn.LSTM(input_size, hidden_size, num_layers, 
                               batch_first=True, dropout=0.2)
            self.fc = nn.Linear(hidden_size, output_size)
            
        def forward(self, x):
            h0 = torch.zeros(self.num_layers, x.size(0), self.hidden_size).to(x.device)
            c0 = torch.zeros(self.num_layers, x.size(0), self.hidden_size).to(x.device)
            
            out, _ = self.lstm(x, (h0, c0))
            out = self.fc(out[:, -1, :])
            return out

    class OnlineNoiseDataset(Dataset):
        def __init__(self, data, seq_len=SEQUENCE_LENGTH, pred_horizon=PREDICTION_HORIZON):
            self.data = data
            self.seq_len = seq_len
            self.pred_horizon = pred_horizon
            
        def __len__(self):
            return max(0, len(self.data) - self.seq_len - self.pred_horizon)
        
        def __getitem__(self, idx):
            x = self.data[idx:idx + self.seq_len]
            y = self.data[idx + self.seq_len:idx + self.seq_len + self.pred_horizon]
            return torch.FloatTensor(x).unsqueeze(-1), torch.FloatTensor(y)

# ==========================================
# 글로벌 변수
# ==========================================
w_gain = 0.0
w_phase = 0.0
is_running_anc = False
is_running = True
baseline_noise = 1e-6
last_api_send_time = 0

lms_filter = LMSAdaptiveFilter()

if TORCH_AVAILABLE:
    predictor_model = NoisePredictorLSTM().to(DEVICE)
    optimizer = torch.optim.Adam(predictor_model.parameters(), lr=LEARNING_RATE)
    criterion = nn.MSELoss()
    
    USE_AI_PREDICTION = False
    ai_ready = False
    model_update_counter = 0
    training_data = deque(maxlen=10000)
else:
    USE_AI_PREDICTION = False
    ai_ready = False
    model_update_counter = 0

fft_buffer = deque([0] * FFT_SAMPLES, maxlen=FFT_SAMPLES)
error_buffer_signed = deque([0] * int(SAMPLE_RATE * 0.5), maxlen=int(SAMPLE_RATE * 0.5))
original_buffer_signed = deque([0] * int(SAMPLE_RATE * 0.5), maxlen=int(SAMPLE_RATE * 0.5))
prediction_buffer = deque(maxlen=DELAY_SAMPLES)

# ==========================================
# 오디오 출력
# ==========================================
def audio_callback(outdata, frames, time_info, status):
    global w_phase, w_gain, TARGET_FREQ, prediction_buffer
    
    t = (np.arange(frames) + audio_callback.t) / 44100
    audio_callback.t += frames
    
    base_wave = w_gain * np.sin(2 * np.pi * TARGET_FREQ * t + w_phase)
    
    if len(prediction_buffer) > 10 and w_gain > 0.01:
        predicted_values = list(prediction_buffer)[:min(frames, len(prediction_buffer))]
        predicted_avg = np.mean(predicted_values)
        predicted_std = np.std(predicted_values)
        
        prediction_strength = abs(predicted_avg) / 1000.0
        variability_factor = min(1.0, predicted_std / 500.0)
        
        gain_boost = prediction_strength * 0.15 * (1 - variability_factor * 0.5)
        dynamic_gain = w_gain * (1.0 + gain_boost)
        
        phase_correction = np.arctan2(predicted_avg, 1000) * 0.05
        
        wave = dynamic_gain * np.sin(2 * np.pi * TARGET_FREQ * t + w_phase + phase_correction)
    else:
        wave = base_wave
    
    outdata[:] = wave.reshape(-1, 1)

audio_callback.t = 0

try:
    stream = sd.OutputStream(channels=1, callback=audio_callback, samplerate=44100, blocksize=512)
    stream.start()
    print("🔊 오디오 출력 초기화 성공")
except Exception as e:
    print(f"⚠️ 오디오 출력 실패: {e}")
    stream = None

# ==========================================
# 시리얼 통신
# ==========================================
def read_serial():
    global is_running, lms_filter, prediction_buffer, training_data
    
    while is_running:
        try:
            ser = serial.Serial(COM_PORT, BAUD_RATE, timeout=1)
            ser.reset_input_buffer()
            print(f"✅ {COM_PORT} 연결 성공!")
            
            while is_running:
                if ser.in_waiting >= 4:
                    packet = ser.read(4)
                    val1, val2 = struct.unpack('>HH', packet)
                    v1 = val1 - 32768
                    v2 = val2 - 32768
                    
                    fft_buffer.append(v1)
                    error_buffer_signed.append(v2)
                    original_buffer_signed.append(v1)
                    
                    # LMS 실시간 처리
                    current_pred = lms_filter.predict(float(v1))
                    lms_filter.update(float(v2))
                    
                    # AI 미사용시 LMS 예측 사용
                    if not USE_AI_PREDICTION:
                        prediction_buffer.clear()
                        prediction_buffer.extend(lms_filter.prediction_buffer)
                    
                    # AI 학습 데이터
                    if TORCH_AVAILABLE:
                        training_data.append(float(v1))
                    
        except serial.SerialException as e:
            print(f"❌ 시리얼 연결 실패: {e}")
            time.sleep(5)
        except Exception as e:
            print(f"❌ 시리얼 오류: {e}")
            time.sleep(5)

# ==========================================
# AI 백그라운드 학습
# ==========================================
def train_ai_background():
    if not TORCH_AVAILABLE:
        return
    
    global is_running, predictor_model, ai_ready, model_update_counter, USE_AI_PREDICTION
    
    print("🤖 AI 백그라운드 학습 시작...")
    
    while is_running and len(training_data) < 1000:
        time.sleep(1)
    
    print("📊 데이터 수집 완료, AI 학습 시작...")
    
    while is_running:
        if len(training_data) < SEQUENCE_LENGTH + PREDICTION_HORIZON + 500:
            time.sleep(2)
            continue
        
        try:
            data_array = np.array(list(training_data))
            mean = np.mean(data_array)
            std = np.std(data_array) + 1e-8
            normalized_data = (data_array - mean) / std
            
            dataset = OnlineNoiseDataset(normalized_data)
            
            if len(dataset) < BATCH_SIZE:
                time.sleep(2)
                continue
            
            dataloader = DataLoader(dataset, batch_size=BATCH_SIZE, shuffle=True)
            
            predictor_model.train()
            epoch_loss = 0
            num_batches = 0
            
            for batch_x, batch_y in dataloader:
                batch_x = batch_x.to(DEVICE)
                batch_y = batch_y.to(DEVICE)
                
                optimizer.zero_grad()
                predictions = predictor_model(batch_x)
                loss = criterion(predictions, batch_y)
                loss.backward()
                optimizer.step()
                
                epoch_loss += loss.item()
                num_batches += 1
                
                if num_batches >= 5:
                    break
            
            avg_loss = epoch_loss / num_batches if num_batches > 0 else 0
            model_update_counter += 1
            
            if not ai_ready and model_update_counter >= 10 and avg_loss < 0.5:
                ai_ready = True
                print("\n" + "="*70)
                print("✨ AI 모델 학습 완료! LSTM 예측 모드 전환 가능")
                print("   10초 후 자동 전환...")
                print("="*70 + "\n")
                
                time.sleep(10)
                USE_AI_PREDICTION = True
                print("🤖 [모드 전환] LMS → LSTM 활성화!")
            
            if model_update_counter % 20 == 0:
                mode = "🤖 LSTM" if USE_AI_PREDICTION else "📊 LMS"
                print(f"🧠 [{mode}] AI 업데이트 #{model_update_counter} | Loss: {avg_loss:.4f}")
            
            time.sleep(5)
            
        except Exception as e:
            print(f"⚠️ AI 학습 오류: {e}")
            time.sleep(5)

# ==========================================
# AI 예측 실행
# ==========================================
def run_ai_predictor():
    if not TORCH_AVAILABLE:
        return
    
    global is_running, prediction_buffer, USE_AI_PREDICTION
    
    while is_running:
        if not USE_AI_PREDICTION or len(training_data) < SEQUENCE_LENGTH:
            time.sleep(1)
            continue
        
        try:
            recent_data = np.array(list(training_data)[-SEQUENCE_LENGTH:])
            mean = np.mean(recent_data)
            std = np.std(recent_data) + 1e-8
            normalized = (recent_data - mean) / std
            
            predictor_model.eval()
            with torch.no_grad():
                input_tensor = torch.FloatTensor(normalized).unsqueeze(0).unsqueeze(-1).to(DEVICE)
                prediction = predictor_model(input_tensor)
                predicted_values = prediction.cpu().numpy()[0]
            
            predicted_values = predicted_values * std + mean
            
            prediction_buffer.clear()
            for val in predicted_values:
                prediction_buffer.append(val)
            
            time.sleep(0.05)
            
        except Exception as e:
            print(f"⚠️ AI 예측 오류: {e}")
            time.sleep(1)

# ==========================================
# RMS 및 dB
# ==========================================
def get_rms_noise():
    samples = np.array(list(error_buffer_signed))
    if len(samples) == 0: return 1e-6
    return np.sqrt(np.mean(samples**2)) + 1e-6

def get_original_rms():
    samples = np.array(list(original_buffer_signed))
    if len(samples) == 0: return 1e-6
    return np.sqrt(np.mean(samples**2)) + 1e-6

def rms_to_db(rms_value):
    if rms_value < 1:
        return 20.0
    raw_db = 20 * np.log10(rms_value / 1.0)
    db_spl = 20 + (raw_db * 0.6)
    return max(20.0, min(120.0, db_spl))

# ==========================================
# API
# ==========================================
def send_noise_data():
    global last_api_send_time
    
    current_time = time.time()
    if current_time - last_api_send_time < API_SEND_INTERVAL:
        return
    
    try:
        original_rms = get_original_rms()
        cancelled_rms = get_rms_noise()
        
        original_db = rms_to_db(original_rms)
        cancelled_db = rms_to_db(cancelled_rms)
        
        mode = "LSTM" if USE_AI_PREDICTION else "LMS"
        
        payload = {
            'original_db': round(original_db, 2),
            'cancelled_db': round(cancelled_db, 2),
            'device_id': DEVICE_ID,
            'prediction_mode': mode,
            'ai_ready': ai_ready if TORCH_AVAILABLE else False
        }
        
        response = requests.post(
            f'{API_BASE_URL}/sensor/noise',
            json=payload,
            timeout=2.0
        )
        
        if response.status_code == 200:
            reduction = original_db - cancelled_db
            mode_icon = "🤖" if USE_AI_PREDICTION else "📊"
            print(f"📡 {mode_icon}[{mode}] [{time.strftime('%H:%M:%S')}] "
                  f"원본={original_db:.0f}dB → 상쇄={cancelled_db:.0f}dB (감소: {reduction:.1f}dB)")
        
        last_api_send_time = current_time
        
    except requests.exceptions.ConnectionError:
        last_api_send_time = current_time
    except Exception:
        last_api_send_time = current_time

def api_sender_loop():
    global is_running
    while is_running:
        send_noise_data()
        time.sleep(0.5)

# ==========================================
# 하이브리드 ANC
# ==========================================
def run_hybrid_anc():
    global w_phase, w_gain, is_running_anc, baseline_noise, is_running
    
    mode_name = "Hybrid AI-Enhanced ANC" if TORCH_AVAILABLE else "LMS Adaptive ANC"
    print(f"\n⚡ [{mode_name}] 시작!")
    
    saved_user_gain = w_gain if w_gain >= 0.01 else FIXED_GAIN
    
    w_gain = 0.0
    time.sleep(0.7)
    baseline_noise = get_rms_noise()
    print(f"   📢 기준: {int(baseline_noise)} RMS ({rms_to_db(baseline_noise):.0f} dB)")
    
    w_gain = saved_user_gain
    success_threshold = baseline_noise * 0.65
    
    while is_running_anc and is_running:
        mode = "🤖 LSTM" if (TORCH_AVAILABLE and USE_AI_PREDICTION) else "📊 LMS"
        
        status = lms_filter.get_status()
        converged = "✅" if status['is_converged'] else "⏳"
        
        print(f"\n🔄 {mode} {converged} 위상 스캔 중... (게인: {w_gain:.3f})")
        
        best_phase = 0.0
        min_noise = 99999999.0
        
        if len(prediction_buffer) > 20:
            predicted_avg = np.mean(list(prediction_buffer)[:30])
            initial_phase = np.arctan2(predicted_avg, 1000) % (2 * np.pi)
            scan_range = np.linspace(initial_phase - np.pi/3, initial_phase + np.pi/3, 15)
        else:
            scan_range = np.arange(0, 2 * np.pi, 0.15)
        
        for p in scan_range:
            if not is_running_anc: break
            w_phase = p
            time.sleep(0.04)
            curr = get_rms_noise()
            if curr < min_noise:
                min_noise = curr
                best_phase = p
        
        for p in np.linspace(best_phase - 0.2, best_phase + 0.2, 10):
            if not is_running_anc: break
            w_phase = p % (2 * np.pi)
            time.sleep(0.04)
            curr = get_rms_noise()
            if curr < min_noise:
                min_noise = curr
                best_phase = p % (2 * np.pi)
        
        w_phase = best_phase
        time.sleep(0.5)
        
        locked_noise = get_rms_noise()
        reduction_db = 20 * np.log10(locked_noise / baseline_noise) if locked_noise > 0 else -60
        
        print(f"🔒 고정: Phase={best_phase:.2f}, 감소={reduction_db:.1f}dB")
        
        if locked_noise > success_threshold:
            print("   ⚠️ 효과 부족, 재시도...")
            time.sleep(0.2)
            continue
        
        print(f"   ✅ 성공! {mode} 모니터링 중...")
        
        last_check = time.time()
        amplify_threshold = locked_noise * 1.25
        
        while is_running_anc and is_running:
            current_noise = get_rms_noise()
            
            if current_noise > amplify_threshold:
                print(f"🚨 노이즈 증가 → {mode} 재스캔")
                break
            
            if time.time() - last_check > 0.3:
                if len(prediction_buffer) > 10:
                    future_samples = list(prediction_buffer)[:20]
                    future_avg = np.mean(future_samples)
                    future_std = np.std(future_samples)
                    
                    if future_std < 300:
                        adjustment = future_avg / 8000
                        test_phases = [
                            w_phase - 0.03,
                            w_phase,
                            w_phase + 0.03,
                            (w_phase + adjustment) % (2 * np.pi)
                        ]
                    else:
                        test_phases = [w_phase - 0.02, w_phase, w_phase + 0.02]
                else:
                    test_phases = [w_phase - 0.02, w_phase, w_phase + 0.02]
                
                test_results = []
                for tp in test_phases:
                    w_phase = tp % (2 * np.pi)
                    time.sleep(0.03)
                    test_results.append(get_rms_noise())
                
                best_idx = np.argmin(test_results)
                w_phase = test_phases[best_idx] % (2 * np.pi)
                last_check = time.time()
            
            time.sleep(0.08)
    
    w_gain = 0.0
    print("\n🛑 ANC 종료")

# ==========================================
# 주파수 탐지
# ==========================================
def detect_frequency():
    global TARGET_FREQ
    
    print("\n🔍 주파수 분석 중...")
    candidates = []
    
    for _ in range(5):
        samples = list(fft_buffer)
        if len(samples) < FFT_SAMPLES:
            time.sleep(0.3)
            continue
        
        fft_vals = np.fft.fft(samples)
        freqs = np.fft.fftfreq(len(samples), 1/SAMPLE_RATE)
        mags = np.abs(fft_vals)[:len(samples)//2]
        
        start_idx = int(30 * len(samples) / SAMPLE_RATE)
        peak_idx = np.argmax(mags[start_idx:]) + start_idx
        candidates.append(int(round(freqs[peak_idx])))
        time.sleep(0.2)
    
    if candidates:
        TARGET_FREQ = float(Counter(candidates).most_common(1)[0][0])
        print(f"🎯 타겟 주파수: {TARGET_FREQ} Hz")

# ==========================================
# 종료
# ==========================================
def signal_handler(sig, frame):
    global is_running, is_running_anc
    print("\n\n🛑 종료 신호 수신...")
    is_running_anc = False
    is_running = False
    
    if stream:
        stream.stop()
        stream.close()
    
    print("👋 프로그램 종료")
    sys.exit(0)

signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

# ==========================================
# 메인
# ==========================================
def main():
    global is_running_anc, w_gain
    
    print("=" * 70)
    if TORCH_AVAILABLE:
        print("🤖 AI-Enhanced Hybrid ANC System")
        print("   📊 LMS (즉시) + 🤖 LSTM (지능형)")
    else:
        print("📊 LMS Adaptive ANC System (AI 비활성)")
        print("   PyTorch 설치: pip install torch --index-url https://...")
    print("=" * 70)
    print(f"📡 API: {API_BASE_URL}")
    print(f"🔌 포트: {COM_PORT}")
    print(f"🎵 주파수: {TARGET_FREQ} Hz")
    print(f"⏱️  Delay: {SYSTEM_DELAY_MS}ms ({DELAY_SAMPLES} 샘플)")
    print("=" * 70)
    
    # 스레드 시작
    serial_thread = threading.Thread(target=read_serial, daemon=True)
    serial_thread.start()
    
    api_thread = threading.Thread(target=api_sender_loop, daemon=True)
    api_thread.start()
    
    if TORCH_AVAILABLE:
        ai_training_thread = threading.Thread(target=train_ai_background, daemon=True)
        ai_training_thread.start()
        
        ai_prediction_thread = threading.Thread(target=run_ai_predictor, daemon=True)
        ai_prediction_thread.start()
    
    print("\n⏳ Pico 연결 대기...")
    time.sleep(3)
    
    detect_frequency()
    
    print("\n🚀 ANC 즉시 시작 (LMS)")
    if TORCH_AVAILABLE:
        print("   💡 AI가 백그라운드에서 학습 중... 준비되면 자동 전환")
    
    w_gain = FIXED_GAIN
    is_running_anc = True
    
    anc_thread = threading.Thread(target=run_hybrid_anc, daemon=True)
    anc_thread.start()
    
    print("\n📊 상태 모니터링 (Ctrl+C 종료)")
    print("-" * 70)
    
    while is_running:
        time.sleep(10)
        
        original_db = rms_to_db(get_original_rms())
        cancelled_db = rms_to_db(get_rms_noise())
        reduction = original_db - cancelled_db
        
        status = "🟢 ACTIVE" if is_running_anc else "⚫ OFF"
        
        if TORCH_AVAILABLE:
            mode_icon = "🤖" if USE_AI_PREDICTION else "📊"
            mode_text = "LSTM" if USE_AI_PREDICTION else "LMS"
            print(f"[{time.strftime('%H:%M:%S')}] {status} {mode_icon}[{mode_text}] | "
                  f"원본: {original_db:.0f}dB | 상쇄: {cancelled_db:.0f}dB | 감소: {reduction:.1f}dB")
        else:
            print(f"[{time.strftime('%H:%M:%S')}] {status} 📊[LMS] | "
                  f"원본: {original_db:.0f}dB | 상쇄: {cancelled_db:.0f}dB | 감소: {reduction:.1f}dB")

if __name__ == "__main__":
    main()