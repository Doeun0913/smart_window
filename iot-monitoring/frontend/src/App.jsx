import React, { useState, useEffect, createContext, useContext, useCallback } from 'react';
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer
} from 'recharts';
import {
  Home, Thermometer, Droplets, Volume2, Wind, Power, RefreshCw,
  ChevronRight, ArrowLeft, TrendingUp, TrendingDown, AlertTriangle,
  X, AlertCircle, Shield, Waves, Mic, VolumeX, BarChart3, Leaf,
  Sun, CloudRain, Zap
} from 'lucide-react';

// =====================================================
// API 설정 (동적으로 현재 호스트 기반 URL 생성)
// =====================================================
const getApiBaseUrl = () => {
  if (process.env.REACT_APP_API_URL) return process.env.REACT_APP_API_URL;
  if (typeof window !== 'undefined' && window.location.hostname !== 'localhost') {
    return `http://${window.location.hostname}:3001/api`;
  }
  return 'http://localhost:3001/api';
};

const getWsUrl = () => {
  if (process.env.REACT_APP_WS_URL) return process.env.REACT_APP_WS_URL;
  if (typeof window !== 'undefined' && window.location.hostname !== 'localhost') {
    return `ws://${window.location.hostname}:3001`;
  }
  return 'ws://localhost:3001';
};

const API_BASE_URL = getApiBaseUrl();
const WS_URL = getWsUrl();

// =====================================================
// Context
// =====================================================
const DataContext = createContext();
const useApiData = () => {
  const context = useContext(DataContext);
  if (!context) throw new Error('useApiData must be used within DataProvider');
  return context;
};

// =====================================================
// WebSocket Hook
// =====================================================
const useWebSocket = (onMessage) => {
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    let ws = null;
    let reconnectTimeout = null;

    const connect = () => {
      try {
        ws = new WebSocket(WS_URL);
        ws.onopen = () => setIsConnected(true);
        ws.onmessage = (e) => {
          try { onMessage(JSON.parse(e.data)); } catch { }
        };
        ws.onclose = () => {
          setIsConnected(false);
          reconnectTimeout = setTimeout(connect, 5000);
        };
        ws.onerror = () => setIsConnected(false);
      } catch {
        reconnectTimeout = setTimeout(connect, 5000);
      }
    };

    connect();
    return () => {
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (ws) ws.close();
    };
  }, [onMessage]);

  return { isConnected };
};

// =====================================================
// Data Provider
// =====================================================
const DataProvider = ({ children }) => {
  const [currentData, setCurrentData] = useState(null);
  const [temperatureData, setTemperatureData] = useState([]);
  const [noiseData, setNoiseData] = useState([]);
  const [airQualityData, setAirQualityData] = useState([]);
  const [pldcState, setPldcState] = useState(false);
  const [pldcChangedAt, setPldcChangedAt] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [error, setError] = useState(null);

  const handleWebSocketMessage = useCallback((data) => {
    if (data.type === 'sensor_update') {
      fetchCurrentData();
      if (data.sensor === 'temperature_humidity') fetchTemperatureData();
      else if (data.sensor === 'noise') fetchNoiseData();
      else if (data.sensor === 'air_quality') fetchAirQualityData();
    } else if (data.type === 'pldc_update') {
      setPldcState(data.state);
      setPldcChangedAt(data.changed_at);
    }
  }, []);

  const { isConnected } = useWebSocket(handleWebSocketMessage);

  const fetchCurrentData = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/current`);
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      setCurrentData(data);
      setPldcState(data.pldc_state || false);
      setLastUpdate(new Date());
      setError(null);
    } catch (err) {
      setError('서버 연결 실패');
    }
  };

  const fetchTemperatureData = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/temperature-humidity?hours=24`);
      if (res.ok) setTemperatureData(await res.json());
    } catch { }
  };

  const fetchNoiseData = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/noise?minutes=60`);
      if (res.ok) setNoiseData(await res.json());
    } catch { }
  };

  const fetchAirQualityData = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/air-quality?hours=24`);
      if (res.ok) setAirQualityData(await res.json());
    } catch { }
  };

  const fetchAlerts = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/alerts?resolved=false`);
      if (res.ok) {
        const data = await res.json();
        // API 응답이 배열인지 확인
        setAlerts(Array.isArray(data) ? data : []);
      }
    } catch {
      // 에러 시 빈 배열 유지
    }
  };

  // PDLC ON/OFF 토글 (DB 저장)
  const togglePLDC = async () => {
    try {
      const newState = !pldcState;
      const res = await fetch(`${API_BASE_URL}/pldc/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: newState, changed_by: 'web-dashboard' })
      });
      const data = await res.json();
      if (data.success) {
        setPldcState(newState);
        setPldcChangedAt(data.data?.changed_at);
      }
    } catch (err) {
      setError('PDLC 제어 실패');
    }
  };

  const resolveAlert = async (id) => {
    try {
      const res = await fetch(`${API_BASE_URL}/alerts/${id}/resolve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }
      });
      if (res.ok) setAlerts(alerts.filter(a => a.id !== id));
    } catch { }
  };

  const refreshAllData = async () => {
    setIsLoading(true);
    await Promise.all([
      fetchCurrentData(), fetchTemperatureData(),
      fetchNoiseData(), fetchAirQualityData(), fetchAlerts()
    ]);
    setIsLoading(false);
  };

  useEffect(() => {
    refreshAllData();
    const interval = setInterval(refreshAllData, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <DataContext.Provider value={{
      currentData, temperatureData, noiseData, airQualityData,
      pldcState, pldcChangedAt, alerts, isLoading, lastUpdate, error,
      isConnected, togglePLDC, refreshAllData, resolveAlert
    }}>
      {children}
    </DataContext.Provider>
  );
};

// =====================================================
// 유틸리티
// =====================================================
const formatTime = (d) => d ? new Date(d).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '-';

const getPMStatus = (pm25) => {
  if (!pm25 || pm25 <= 15) return { text: '좋음', emoji: '🌿', color: '#10B981', bg: 'from-emerald-500/20 to-teal-500/20', border: 'border-emerald-500/30' };
  if (pm25 <= 35) return { text: '보통', emoji: '🌤️', color: '#3B82F6', bg: 'from-blue-500/20 to-cyan-500/20', border: 'border-blue-500/30' };
  if (pm25 <= 75) return { text: '나쁨', emoji: '😷', color: '#F59E0B', bg: 'from-amber-500/20 to-orange-500/20', border: 'border-amber-500/30' };
  return { text: '매우나쁨', emoji: '🚨', color: '#EF4444', bg: 'from-red-500/20 to-rose-500/20', border: 'border-red-500/30' };
};

const getTempStatus = (t) => {
  if (!t) return { text: '-', color: '#6B7280' };
  if (t < 18) return { text: '추움', color: '#3B82F6', icon: '❄️' };
  if (t <= 26) return { text: '쾌적', color: '#10B981', icon: '✨' };
  return { text: '더움', color: '#EF4444', icon: '🔥' };
};

const getHumidStatus = (h) => {
  if (!h) return { text: '-', color: '#6B7280' };
  if (h < 30) return { text: '건조', color: '#F59E0B' };
  if (h <= 60) return { text: '적정', color: '#06B6D4' };
  return { text: '습함', color: '#8B5CF6' };
};

// =====================================================
// 메인 대시보드
// =====================================================
const Dashboard = ({ onNavigate }) => {
  const {
    currentData, pldcState, pldcChangedAt, togglePLDC,
    isLoading, lastUpdate, refreshAllData, isConnected, alerts, resolveAlert, error
  } = useApiData();

  const temp = currentData?.current_temperature != null ? Number(currentData.current_temperature) : null;
  const humidity = currentData?.current_humidity != null ? Number(currentData.current_humidity) : null;
  const noise = currentData?.current_noise != null ? Number(currentData.current_noise) : null;
  const noiseCancelled = currentData?.current_noise_cancelled != null ? Number(currentData.current_noise_cancelled) : null;
  const pm25 = currentData?.current_pm25 != null ? Number(currentData.current_pm25) : null;
  const pm10 = currentData?.current_pm10 != null ? Number(currentData.current_pm10) : null;

  const tempStatus = getTempStatus(temp);
  const humidStatus = getHumidStatus(humidity);
  const pmStatus = getPMStatus(pm25);
  const reduction = noise && noiseCancelled ? ((noise - noiseCancelled) / noise * 100).toFixed(0) : 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0a0a0f] via-[#0D0D0F] to-[#12121a] text-white overflow-x-hidden">
      {/* 배경 그라데이션 - Enhanced */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[700px] bg-gradient-to-b from-violet-600/12 via-purple-500/8 to-transparent rounded-full blur-3xl animate-float" />
        <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-gradient-to-tr from-cyan-500/10 via-blue-500/6 to-transparent rounded-full blur-3xl" style={{ animation: 'float 8s ease-in-out infinite reverse' }} />
        <div className="absolute top-1/2 right-0 w-[500px] h-[500px] bg-gradient-to-l from-pink-500/8 via-rose-500/6 to-transparent rounded-full blur-3xl" style={{ animation: 'float 10s ease-in-out infinite' }} />
        <div className="absolute top-1/4 left-1/4 w-[300px] h-[300px] bg-gradient-to-br from-amber-500/6 to-transparent rounded-full blur-2xl" style={{ animation: 'float 12s ease-in-out infinite' }} />
      </div>

      {/* 헤더 - Enhanced */}
      <header className="relative z-10 px-6 pt-8 pb-6 backdrop-blur-sm">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 via-purple-500 to-purple-600 flex items-center justify-center shadow-2xl shadow-violet-500/40 hover:shadow-violet-500/60 transition-all duration-300 hover:scale-105">
                <Home className="w-6 h-6 drop-shadow-lg" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-white via-purple-100 to-violet-200 bg-clip-text text-transparent">Smart Home</h1>
                <p className="text-xs text-white/50 font-medium">IoT Dashboard</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold backdrop-blur-md border transition-all duration-300 ${isConnected ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30 shadow-lg shadow-emerald-500/20' : 'bg-red-500/20 text-red-300 border-red-500/30'}`}>
                <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse shadow-lg shadow-emerald-400/50' : 'bg-red-400'}`} />
                {isConnected ? 'Live' : 'Offline'}
              </div>
              <button onClick={refreshAllData} disabled={isLoading} className="w-10 h-10 rounded-xl bg-white/10 hover:bg-white/15 backdrop-blur-md flex items-center justify-center transition-all duration-300 border border-white/10 hover:border-white/20 hover:scale-105 active:scale-95">
                <RefreshCw className={`w-4 h-4 text-white/70 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 px-6 pb-12">
        <div className="max-w-lg mx-auto space-y-4">

          {/* 에러 알림 - Enhanced */}
          {error && (
            <div className="p-5 rounded-2xl bg-red-500/15 backdrop-blur-xl border border-red-500/30 flex items-center gap-4 shadow-xl shadow-red-500/10 animate-slide-up">
              <AlertCircle className="w-6 h-6 text-red-400 flex-shrink-0 animate-pulse" />
              <p className="text-sm text-red-300 font-medium">{error}</p>
            </div>
          )}

          {/* 알림 배너 - Enhanced */}
          {Array.isArray(alerts) && alerts.length > 0 && (
            <div className="space-y-3">
              {alerts.slice(0, 2).map(alert => (
                <div key={alert.id} className={`p-4 rounded-2xl backdrop-blur-xl flex items-center justify-between shadow-lg transition-all duration-300 hover:scale-[1.01] ${alert.severity === 'critical' ? 'bg-red-500/15 border border-red-500/30 shadow-red-500/10' : 'bg-amber-500/15 border border-amber-500/30 shadow-amber-500/10'}`}>
                  <div className="flex items-center gap-3">
                    <AlertTriangle className={`w-5 h-5 ${alert.severity === 'critical' ? 'text-red-400 animate-pulse' : 'text-amber-400'}`} />
                    <span className={`text-sm font-medium ${alert.severity === 'critical' ? 'text-red-300' : 'text-amber-300'}`}>{alert.message}</span>
                  </div>
                  <button onClick={() => resolveAlert(alert.id)} className="p-2 hover:bg-white/15 rounded-lg transition-all duration-200 active:scale-90"><X className="w-4 h-4 text-white/50" /></button>
                </div>
              ))}
            </div>
          )}

          {/* ========== PDLC 스마트 글래스 카드 - Enhanced ========== */}
          <div className={`relative overflow-hidden rounded-3xl p-6 transition-all duration-700 backdrop-blur-xl ${pldcState ? 'bg-gradient-to-br from-amber-500/20 via-orange-500/15 to-yellow-500/10 shadow-2xl shadow-amber-500/20' : 'bg-white/[0.05] shadow-xl'} border ${pldcState ? 'border-amber-400/40' : 'border-white/[0.08]'} hover:scale-[1.01] hover:shadow-2xl`}>
            {/* 글로우 효과 - Enhanced */}
            {pldcState && (
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute top-0 right-0 w-40 h-40 bg-amber-400/25 rounded-full blur-3xl animate-pulse" />
                <div className="absolute bottom-0 left-0 w-32 h-32 bg-orange-400/20 rounded-full blur-2xl" style={{ animation: 'pulse 3s ease-in-out infinite' }} />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 bg-yellow-400/10 rounded-full blur-3xl" />
              </div>
            )}

            <div className="relative z-10">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4">
                  <div className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-all duration-700 ${pldcState ? 'bg-gradient-to-br from-amber-400 via-orange-400 to-orange-500 shadow-2xl shadow-amber-500/50 animate-pulse-glow' : 'bg-white/[0.08] shadow-lg'}`}>
                    {pldcState ? <Sun className="w-8 h-8 text-white drop-shadow-lg" /> : <Power className="w-8 h-8 text-white/40" />}
                  </div>
                  <div>
                    <h2 className="text-xl font-bold bg-gradient-to-r from-white to-amber-100 bg-clip-text text-transparent">스마트 글래스</h2>
                    <p className="text-sm text-white/50 font-medium">PDLC Film Control</p>
                  </div>
                </div>

                {/* ON/OFF 토글 스위치 - Enhanced */}
                <button
                  onClick={togglePLDC}
                  className={`relative w-[80px] h-10 rounded-full transition-all duration-700 hover:scale-105 active:scale-95 ${pldcState ? 'bg-gradient-to-r from-amber-400 via-orange-400 to-orange-500 shadow-2xl shadow-amber-500/50' : 'bg-white/15 backdrop-blur-md shadow-lg'}`}
                >
                  <div className={`absolute top-1 w-8 h-8 rounded-full bg-white shadow-xl transition-all duration-700 flex items-center justify-center ${pldcState ? 'left-[calc(100%-36px)]' : 'left-1'}`}>
                    <Power className={`w-4 h-4 transition-all duration-300 ${pldcState ? 'text-amber-500' : 'text-gray-400'}`} />
                  </div>
                </button>
              </div>

              {/* 상태 표시 - Enhanced */}
              <div className={`p-6 rounded-2xl text-center transition-all duration-700 backdrop-blur-md ${pldcState ? 'bg-gradient-to-br from-amber-500/15 to-orange-500/10 border border-amber-400/30 shadow-lg shadow-amber-500/20' : 'bg-white/[0.05] border border-white/[0.08] shadow-lg'}`}>
                <div className="flex items-center justify-center gap-3 mb-2">
                  <Zap className={`w-6 h-6 transition-all duration-300 ${pldcState ? 'text-amber-400 drop-shadow-lg' : 'text-white/30'}`} />
                  <span className={`text-4xl font-black tracking-tight transition-all duration-300 ${pldcState ? 'text-amber-400 drop-shadow-lg' : 'text-white/50'}`}>
                    {pldcState ? 'ON' : 'OFF'}
                  </span>
                </div>
                <p className={`text-sm font-medium transition-all duration-300 ${pldcState ? 'text-amber-300/80' : 'text-white/40'}`}>
                  {pldcState ? '✨ 투명 모드 (전원 켜짐)' : '🔒 불투명 모드 (전원 꺼짐)'}
                </p>
                {pldcChangedAt && (
                  <p className="text-xs text-white/30 mt-3 font-medium">
                    마지막 변경: {formatTime(pldcChangedAt)}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* ========== 온습도 카드 - Enhanced ========== */}
          <div
            onClick={() => onNavigate('temperature')}
            className="relative overflow-hidden rounded-3xl p-6 bg-white/[0.05] backdrop-blur-xl border border-white/[0.08] cursor-pointer hover:bg-white/[0.08] hover:border-white/[0.15] hover:scale-[1.02] transition-all duration-300 group shadow-xl hover:shadow-2xl"
          >
            {/* Subtle gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-br from-rose-500/5 via-transparent to-cyan-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

            <div className="relative z-10 flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-rose-500/25 to-orange-500/25 flex items-center justify-center shadow-lg shadow-rose-500/20 group-hover:shadow-rose-500/30 transition-all duration-300">
                  <Thermometer className="w-6 h-6 text-rose-400" />
                </div>
                <div>
                  <h3 className="font-bold text-lg">온습도</h3>
                  <p className="text-xs text-white/50 font-medium">실내 환경</p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-white/30 group-hover:text-white/60 group-hover:translate-x-1 transition-all duration-300" />
            </div>

            <div className="relative z-10 grid grid-cols-2 gap-4">
              <div className="p-5 rounded-2xl bg-gradient-to-br from-rose-500/15 to-orange-500/10 border border-rose-500/20 backdrop-blur-md shadow-lg hover:shadow-rose-500/20 transition-all duration-300">
                <div className="flex items-center gap-2 mb-3">
                  <Thermometer className="w-4 h-4 text-rose-400" />
                  <span className="text-xs text-white/60 font-semibold">온도</span>
                </div>
                <p className="text-3xl font-black mb-2">{temp != null ? temp.toFixed(1) : '--'}<span className="text-base text-white/50 ml-1">°C</span></p>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold shadow-lg" style={{ backgroundColor: `${tempStatus.color}30`, color: tempStatus.color }}>
                  {tempStatus.icon} {tempStatus.text}
                </span>
              </div>
              <div className="p-5 rounded-2xl bg-gradient-to-br from-cyan-500/15 to-blue-500/10 border border-cyan-500/20 backdrop-blur-md shadow-lg hover:shadow-cyan-500/20 transition-all duration-300">
                <div className="flex items-center gap-2 mb-3">
                  <Droplets className="w-4 h-4 text-cyan-400" />
                  <span className="text-xs text-white/60 font-semibold">습도</span>
                </div>
                <p className="text-3xl font-black mb-2">{humidity != null ? humidity.toFixed(0) : '--'}<span className="text-base text-white/50 ml-1">%</span></p>
                <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-bold shadow-lg" style={{ backgroundColor: `${humidStatus.color}30`, color: humidStatus.color }}>
                  {humidStatus.text}
                </span>
              </div>
            </div>
          </div>

          {/* ========== 공기질 카드 - Enhanced ========== */}
          <div
            onClick={() => onNavigate('air')}
            className="relative overflow-hidden rounded-3xl p-6 bg-white/[0.05] backdrop-blur-xl border border-white/[0.08] cursor-pointer hover:bg-white/[0.08] hover:border-white/[0.15] hover:scale-[1.02] transition-all duration-300 group shadow-xl hover:shadow-2xl"
          >
            {/* Subtle gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-transparent to-teal-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

            <div className="relative z-10 flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500/25 to-teal-500/25 flex items-center justify-center shadow-lg shadow-emerald-500/20 group-hover:shadow-emerald-500/30 transition-all duration-300">
                  <Wind className="w-6 h-6 text-emerald-400" />
                </div>
                <div>
                  <h3 className="font-bold text-lg">공기질</h3>
                  <p className="text-xs text-white/50 font-medium">미세먼지</p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-white/30 group-hover:text-white/60 group-hover:translate-x-1 transition-all duration-300" />
            </div>

            {/* 상태 배너 - Enhanced */}
            <div className={`relative z-10 p-5 rounded-2xl mb-4 bg-gradient-to-r ${pmStatus.bg} border ${pmStatus.border} backdrop-blur-md shadow-lg`}>
              <div className="flex items-center gap-4">
                <span className="text-4xl drop-shadow-lg">{pmStatus.emoji}</span>
                <div>
                  <p className="text-xl font-black mb-0.5" style={{ color: pmStatus.color }}>{pmStatus.text}</p>
                  <p className="text-xs text-white/50 font-medium">미세먼지 상태</p>
                </div>
              </div>
            </div>

            <div className="relative z-10 grid grid-cols-2 gap-3">
              <div className="p-4 rounded-xl bg-white/[0.06] backdrop-blur-md text-center border border-white/[0.08] hover:bg-white/[0.08] transition-all duration-300">
                <p className="text-xs text-white/50 mb-2 font-semibold">PM2.5</p>
                <p className="text-2xl font-black">{pm25 != null ? pm25.toFixed(0) : '--'}</p>
              </div>
              <div className="p-4 rounded-xl bg-white/[0.06] backdrop-blur-md text-center border border-white/[0.08] hover:bg-white/[0.08] transition-all duration-300">
                <p className="text-xs text-white/50 mb-2 font-semibold">PM10</p>
                <p className="text-2xl font-black">{pm10 != null ? pm10.toFixed(0) : '--'}</p>
              </div>
            </div>
          </div>

          {/* ========== 소음 분석 카드 - Enhanced ========== */}
          <div
            onClick={() => onNavigate('noise')}
            className="relative overflow-hidden rounded-3xl p-6 bg-white/[0.05] backdrop-blur-xl border border-white/[0.08] cursor-pointer hover:bg-white/[0.08] hover:border-white/[0.15] hover:scale-[1.02] transition-all duration-300 group shadow-xl hover:shadow-2xl"
          >
            {/* Subtle gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 via-transparent to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

            <div className="relative z-10 flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500/25 to-purple-500/25 flex items-center justify-center shadow-lg shadow-violet-500/20 group-hover:shadow-violet-500/30 transition-all duration-300">
                  <Volume2 className="w-6 h-6 text-violet-400" />
                </div>
                <div>
                  <h3 className="font-bold text-lg">소음 분석</h3>
                  <p className="text-xs text-white/50 font-medium">노이즈 캔슬링</p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-white/30 group-hover:text-white/60 group-hover:translate-x-1 transition-all duration-300" />
            </div>

            {/* 소음 레벨 바 - Enhanced */}
            <div className="relative z-10 space-y-4 mb-5">
              <div>
                <div className="flex justify-between text-xs mb-2">
                  <span className="text-white/50 font-semibold">원본 소음</span>
                  <span className="text-amber-400 font-bold">{noise != null ? noise.toFixed(0) : '--'} dB</span>
                </div>
                <div className="h-3 rounded-full bg-white/[0.08] overflow-hidden shadow-inner">
                  <div className="h-full rounded-full bg-gradient-to-r from-amber-400 via-orange-400 to-orange-500 transition-all duration-700 shadow-lg" style={{ width: `${Math.min((noise || 0), 100)}%` }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs mb-2">
                  <span className="text-white/50 font-semibold">상쇄 후</span>
                  <span className="text-emerald-400 font-bold">{noiseCancelled != null ? noiseCancelled.toFixed(0) : '--'} dB</span>
                </div>
                <div className="h-3 rounded-full bg-white/[0.08] overflow-hidden shadow-inner">
                  <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-teal-400 to-teal-500 transition-all duration-700 shadow-lg" style={{ width: `${Math.min((noiseCancelled || 0), 100)}%` }} />
                </div>
              </div>
            </div>

            {/* 캔슬링 효과 - Enhanced */}
            <div className="relative z-10 p-4 rounded-xl bg-gradient-to-r from-violet-500/15 to-purple-500/15 border border-violet-400/30 backdrop-blur-md flex items-center justify-between shadow-lg">
              <div className="flex items-center gap-2.5">
                <Shield className="w-5 h-5 text-violet-400" />
                <span className="text-sm text-violet-300 font-bold">노이즈 캔슬링</span>
              </div>
              <span className="text-2xl font-black text-violet-400 drop-shadow-lg">{reduction}%</span>
            </div>
          </div>

          {/* 업데이트 시간 */}
          <p className="text-center text-xs text-white/20 pt-4">
            마지막 업데이트: {formatTime(lastUpdate)}
          </p>
        </div>
      </main>
    </div>
  );
};

// =====================================================
// 온습도 상세 페이지
// =====================================================
const TemperatureDetail = ({ onBack }) => {
  const { currentData, temperatureData, refreshAllData, isLoading, isConnected } = useApiData();

  const temp = currentData?.current_temperature != null ? Number(currentData.current_temperature) : null;
  const humidity = currentData?.current_humidity != null ? Number(currentData.current_humidity) : null;
  const tempStatus = getTempStatus(temp);
  const humidStatus = getHumidStatus(humidity);

  const chartData = temperatureData.length > 0
    ? temperatureData.map(d => ({
      time: new Date(d.hour).toLocaleTimeString('ko-KR', { hour: '2-digit' }),
      temp: parseFloat(d.temperature) || 0,
      humid: parseFloat(d.humidity) || 0
    }))
    : Array.from({ length: 24 }, (_, i) => ({ time: `${i}시`, temp: 22 + Math.random() * 4, humid: 45 + Math.random() * 20 }));

  return (
    <div className="min-h-screen bg-[#0D0D0F] text-white">
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-gradient-to-bl from-rose-600/8 to-transparent rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-gradient-to-tr from-cyan-600/8 to-transparent rounded-full blur-3xl" />
      </div>

      {/* 헤더 */}
      <header className="relative z-10 px-6 pt-8 pb-4">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="w-10 h-10 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center transition-all border border-white/5">
              <ArrowLeft className="w-5 h-5 text-white/70" />
            </button>
            <div>
              <h1 className="text-lg font-bold">온습도 모니터링</h1>
              <p className="text-xs text-white/40">24시간 데이터</p>
            </div>
          </div>
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs ${isConnected ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-red-400'}`} />
            {isConnected ? 'Live' : 'Offline'}
          </div>
        </div>
      </header>

      <main className="relative z-10 px-6 pb-12">
        <div className="max-w-lg mx-auto space-y-4">
          {/* 현재 값 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-5 rounded-2xl bg-gradient-to-br from-rose-500/10 to-orange-500/5 border border-rose-500/20 text-center">
              <Thermometer className="w-8 h-8 text-rose-400 mx-auto mb-2" />
              <p className="text-3xl font-bold">{temp != null ? temp.toFixed(1) : '--'}<span className="text-lg text-white/40">°C</span></p>
              <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium mt-2" style={{ backgroundColor: `${tempStatus.color}20`, color: tempStatus.color }}>{tempStatus.text}</span>
            </div>
            <div className="p-5 rounded-2xl bg-gradient-to-br from-cyan-500/10 to-blue-500/5 border border-cyan-500/20 text-center">
              <Droplets className="w-8 h-8 text-cyan-400 mx-auto mb-2" />
              <p className="text-3xl font-bold">{humidity != null ? humidity.toFixed(0) : '--'}<span className="text-lg text-white/40">%</span></p>
              <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium mt-2" style={{ backgroundColor: `${humidStatus.color}20`, color: humidStatus.color }}>{humidStatus.text}</span>
            </div>
          </div>

          {/* 온도 그래프 */}
          <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/[0.06]">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-rose-400" />
              온도 변화
            </h3>
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="tempGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#F43F5E" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#F43F5E" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="time" stroke="rgba(255,255,255,0.3)" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="rgba(255,255,255,0.3)" fontSize={10} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
                <Tooltip contentStyle={{ backgroundColor: '#1a1a1f', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }} />
                <Area type="monotone" dataKey="temp" stroke="#F43F5E" strokeWidth={2} fill="url(#tempGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* 습도 그래프 */}
          <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/[0.06]">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <Droplets className="w-4 h-4 text-cyan-400" />
              습도 변화
            </h3>
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="humidGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#06B6D4" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#06B6D4" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="time" stroke="rgba(255,255,255,0.3)" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="rgba(255,255,255,0.3)" fontSize={10} tickLine={false} axisLine={false} domain={[0, 100]} />
                <Tooltip contentStyle={{ backgroundColor: '#1a1a1f', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }} />
                <Area type="monotone" dataKey="humid" stroke="#06B6D4" strokeWidth={2} fill="url(#humidGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </main>
    </div>
  );
};

// =====================================================
// 공기질 상세 페이지
// =====================================================
const AirQualityDetail = ({ onBack }) => {
  const { currentData, airQualityData, isConnected } = useApiData();

  const pm25 = currentData?.current_pm25 != null ? Number(currentData.current_pm25) : null;
  const pm10 = currentData?.current_pm10 != null ? Number(currentData.current_pm10) : null;
  const pmStatus = getPMStatus(pm25);

  const chartData = airQualityData.length > 0
    ? airQualityData.map(d => ({
      time: new Date(d.hour).toLocaleTimeString('ko-KR', { hour: '2-digit' }),
      pm25: parseFloat(d.pm25) || 0,
      pm10: parseFloat(d.pm10) || 0
    }))
    : Array.from({ length: 24 }, (_, i) => ({ time: `${i}시`, pm25: 15 + Math.random() * 30, pm10: 30 + Math.random() * 40 }));

  const levels = [
    { label: '좋음', range: '0-15', color: '#10B981' },
    { label: '보통', range: '16-35', color: '#3B82F6' },
    { label: '나쁨', range: '36-75', color: '#F59E0B' },
    { label: '매우나쁨', range: '76+', color: '#EF4444' }
  ];

  return (
    <div className="min-h-screen bg-[#0D0D0F] text-white">
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/3 left-0 w-[500px] h-[500px] bg-gradient-to-r from-emerald-600/8 to-transparent rounded-full blur-3xl" />
      </div>

      <header className="relative z-10 px-6 pt-8 pb-4">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="w-10 h-10 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center transition-all border border-white/5">
              <ArrowLeft className="w-5 h-5 text-white/70" />
            </button>
            <div>
              <h1 className="text-lg font-bold">공기질 모니터링</h1>
              <p className="text-xs text-white/40">미세먼지 상세</p>
            </div>
          </div>
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs ${isConnected ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-red-400'}`} />
            {isConnected ? 'Live' : 'Offline'}
          </div>
        </div>
      </header>

      <main className="relative z-10 px-6 pb-12">
        <div className="max-w-lg mx-auto space-y-4">
          {/* 현재 상태 */}
          <div className={`p-6 rounded-2xl bg-gradient-to-br ${pmStatus.bg} border ${pmStatus.border} text-center`}>
            <span className="text-5xl mb-2 block">{pmStatus.emoji}</span>
            <p className="text-2xl font-bold mb-1" style={{ color: pmStatus.color }}>{pmStatus.text}</p>
            <div className="flex justify-center gap-6 mt-4">
              <div>
                <p className="text-xs text-white/40">PM2.5</p>
                <p className="text-2xl font-bold">{pm25 != null ? pm25.toFixed(0) : '--'}</p>
              </div>
              <div>
                <p className="text-xs text-white/40">PM10</p>
                <p className="text-2xl font-bold">{pm10 != null ? pm10.toFixed(0) : '--'}</p>
              </div>
            </div>
          </div>

          {/* 등급 */}
          <div className="grid grid-cols-4 gap-2">
            {levels.map(l => (
              <div key={l.label} className={`p-2.5 rounded-xl text-center border ${pmStatus.text === l.label ? 'ring-2' : 'border-white/[0.06]'}`} style={pmStatus.text === l.label ? { borderColor: l.color, ringColor: l.color } : {}}>
                <p className="text-xs font-medium" style={{ color: l.color }}>{l.label}</p>
                <p className="text-[10px] text-white/40">{l.range}</p>
              </div>
            ))}
          </div>

          {/* 그래프 */}
          <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/[0.06]">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <Leaf className="w-4 h-4 text-emerald-400" />
              24시간 변화
            </h3>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="pm25Grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#8B5CF6" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#8B5CF6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="time" stroke="rgba(255,255,255,0.3)" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="rgba(255,255,255,0.3)" fontSize={10} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ backgroundColor: '#1a1a1f', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }} />
                <Area type="monotone" dataKey="pm25" stroke="#8B5CF6" strokeWidth={2} fill="url(#pm25Grad)" name="PM2.5" dot={false} />
                <Line type="monotone" dataKey="pm10" stroke="#EC4899" strokeWidth={2} name="PM10" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </main>
    </div>
  );
};

// =====================================================
// 소음 상세 페이지
// =====================================================
const NoiseDetail = ({ onBack }) => {
  const { currentData, noiseData, isConnected } = useApiData();
  const [selectedPoint, setSelectedPoint] = useState(null);

  const noise = currentData?.current_noise != null ? Number(currentData.current_noise) : null;
  const noiseCancelled = currentData?.current_noise_cancelled != null ? Number(currentData.current_noise_cancelled) : null;
  const reduction = noise && noiseCancelled ? noise - noiseCancelled : 0;
  const reductionPercent = noise && noiseCancelled && noise > 0 ? ((reduction / noise) * 100).toFixed(0) : 0;

  const chartData = noiseData.length > 0
    ? noiseData.map(d => ({
      time: new Date(d.recorded_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
      original: parseFloat(d.original_db) || 0,
      cancelled: parseFloat(d.cancelled_db) || 0,
      reduction: parseFloat(d.reduction_db) || 0
    }))
    : Array.from({ length: 30 }, (_, i) => {
      const o = 50 + Math.random() * 30;
      const c = o * 0.4 + Math.random() * 5;
      return { time: `${i}분`, original: o, cancelled: c, reduction: o - c };
    });

  return (
    <div className="min-h-screen bg-[#0D0D0F] text-white">
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 w-[600px] h-[400px] bg-gradient-to-b from-violet-600/8 to-transparent rounded-full blur-3xl" />
      </div>

      <header className="relative z-10 px-6 pt-8 pb-4">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="w-10 h-10 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center transition-all border border-white/5">
              <ArrowLeft className="w-5 h-5 text-white/70" />
            </button>
            <div>
              <h1 className="text-lg font-bold">소음 분석</h1>
              <p className="text-xs text-white/40">노이즈 캔슬링 효과</p>
            </div>
          </div>
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs ${isConnected ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-red-400'}`} />
            {isConnected ? 'Live' : 'Offline'}
          </div>
        </div>
      </header>

      <main className="relative z-10 px-6 pb-12">
        <div className="max-w-lg mx-auto space-y-4">
          {/* 현재 값 */}
          <div className="grid grid-cols-3 gap-2">
            <div className="p-4 rounded-2xl bg-gradient-to-br from-amber-500/10 to-orange-500/5 border border-amber-500/20 text-center">
              <Mic className="w-5 h-5 text-amber-400 mx-auto mb-1" />
              <p className="text-2xl font-bold">{noise != null ? noise.toFixed(0) : '--'}</p>
              <p className="text-[10px] text-white/40">원본 dB</p>
            </div>
            <div className="p-4 rounded-2xl bg-gradient-to-br from-emerald-500/10 to-teal-500/5 border border-emerald-500/20 text-center">
              <VolumeX className="w-5 h-5 text-emerald-400 mx-auto mb-1" />
              <p className="text-2xl font-bold">{noiseCancelled != null ? noiseCancelled.toFixed(0) : '--'}</p>
              <p className="text-[10px] text-white/40">상쇄 후 dB</p>
            </div>
            <div className="p-4 rounded-2xl bg-gradient-to-br from-violet-500/10 to-purple-500/5 border border-violet-500/20 text-center">
              <Shield className="w-5 h-5 text-violet-400 mx-auto mb-1" />
              <p className="text-2xl font-bold">{reductionPercent}%</p>
              <p className="text-[10px] text-white/40">감소율</p>
            </div>
          </div>

          {/* 캔슬링 시각화 */}
          <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/[0.06]">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <Waves className="w-4 h-4 text-violet-400" />
              노이즈 캔슬링 효과
            </h3>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-white/40">원본 소음</span>
                  <span className="text-amber-400">{noise != null ? noise.toFixed(0) : '--'} dB</span>
                </div>
                <div className="h-3 rounded-full bg-white/[0.06] overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500" style={{ width: `${Math.min(noise || 0, 100)}%` }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-white/40">상쇄 후</span>
                  <span className="text-emerald-400">{noiseCancelled != null ? noiseCancelled.toFixed(0) : '--'} dB</span>
                </div>
                <div className="h-3 rounded-full bg-white/[0.06] overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-500" style={{ width: `${Math.min(noiseCancelled || 0, 100)}%` }} />
                </div>
              </div>
              <div className="p-4 rounded-xl bg-gradient-to-r from-violet-500/15 to-purple-500/15 border border-violet-500/20 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Waves className="w-4 h-4 text-violet-400" />
                  <span className="text-sm text-violet-300">소음 감소량</span>
                </div>
                <span className="text-xl font-bold text-violet-400">-{reduction.toFixed(0)} dB</span>
              </div>
            </div>
          </div>

          {/* 선택 포인트 */}
          {selectedPoint && (
            <div className="p-4 rounded-2xl bg-white/[0.05] border border-white/[0.1]">
              <div className="flex justify-between items-center mb-3">
                <span className="text-sm font-medium">📍 {selectedPoint.time}</span>
                <button onClick={() => setSelectedPoint(null)} className="p-1 hover:bg-white/10 rounded"><X className="w-4 h-4 text-white/40" /></button>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-sm">
                <div className="p-2 rounded-lg bg-amber-500/10"><p className="text-amber-400 font-bold">{selectedPoint.original?.toFixed(1)}</p><p className="text-[10px] text-white/40">원본</p></div>
                <div className="p-2 rounded-lg bg-emerald-500/10"><p className="text-emerald-400 font-bold">{selectedPoint.cancelled?.toFixed(1)}</p><p className="text-[10px] text-white/40">상쇄</p></div>
                <div className="p-2 rounded-lg bg-violet-500/10"><p className="text-violet-400 font-bold">{selectedPoint.reduction?.toFixed(1)}</p><p className="text-[10px] text-white/40">감소</p></div>
              </div>
            </div>
          )}

          {/* 그래프 */}
          <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/[0.06]">
            <h3 className="font-semibold mb-1 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-violet-400" />
              실시간 소음 레벨
            </h3>
            <p className="text-xs text-white/30 mb-4">그래프를 탭하면 상세 정보</p>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData} onClick={(e) => e?.activePayload && setSelectedPoint(e.activePayload[0]?.payload)}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="time" stroke="rgba(255,255,255,0.3)" fontSize={9} tickLine={false} axisLine={false} />
                <YAxis stroke="rgba(255,255,255,0.3)" fontSize={9} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ backgroundColor: '#1a1a1f', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }} />
                <Line type="monotone" dataKey="original" stroke="#F59E0B" strokeWidth={2} name="원본" dot={false} />
                <Line type="monotone" dataKey="cancelled" stroke="#10B981" strokeWidth={2} name="상쇄" dot={false} />
                <Line type="monotone" dataKey="reduction" stroke="#8B5CF6" strokeWidth={2} name="감소" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </main>
    </div>
  );
};

// =====================================================
// 메인 앱
// =====================================================
const App = () => {
  const [page, setPage] = useState('dashboard');

  return (
    <DataProvider>
      <div className="font-sans antialiased selection:bg-violet-500/30">
        {page === 'dashboard' && <Dashboard onNavigate={setPage} />}
        {page === 'temperature' && <TemperatureDetail onBack={() => setPage('dashboard')} />}
        {page === 'noise' && <NoiseDetail onBack={() => setPage('dashboard')} />}
        {page === 'air' && <AirQualityDetail onBack={() => setPage('dashboard')} />}
      </div>
    </DataProvider>
  );
};

export default App;
