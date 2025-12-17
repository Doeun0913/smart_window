import React, { useState, useEffect, createContext, useContext, useCallback, useRef } from 'react';
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell
} from 'recharts';
import {
  Home, Thermometer, Droplets, Volume2, Wind, Power, RefreshCw,
  Wifi, WifiOff, ChevronRight, ArrowLeft, Activity, Zap, Shield,
  TrendingUp, TrendingDown, AlertTriangle, Clock, Gauge, Bell,
  X, AlertCircle, Info
} from 'lucide-react';

// =====================================================
// API 설정
// =====================================================
const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';
const WS_URL = process.env.REACT_APP_WS_URL || 'ws://localhost:3001';

// =====================================================
// Context
// =====================================================
const DataContext = createContext();

const useApiData = () => {
  const context = useContext(DataContext);
  if (!context) {
    throw new Error('useApiData must be used within DataProvider');
  }
  return context;
};

// =====================================================
// Custom Hooks
// =====================================================
const useWebSocket = (onMessage) => {
  const [isConnected, setIsConnected] = useState(false);
  const reconnectTimeoutRef = useRef(null);
  const websocketRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const isConnectingRef = useRef(false);

  useEffect(() => {
    const connect = () => {
      // 이미 연결 중이거나 연결되어 있으면 스킵
      if (isConnectingRef.current || (websocketRef.current && websocketRef.current.readyState === WebSocket.OPEN)) {
        return;
      }

      // 기존 연결이 있으면 먼저 닫기
      if (websocketRef.current) {
        try {
          websocketRef.current.close();
        } catch (e) {
          // 무시
        }
      }

      isConnectingRef.current = true;

      try {
        const ws = new WebSocket(WS_URL);
        websocketRef.current = ws;

        ws.onopen = () => {
          console.log('✅ WebSocket connected');
          setIsConnected(true);
          isConnectingRef.current = false;
          reconnectAttemptsRef.current = 0; // 성공하면 재시도 횟수 리셋
          
          // 연결 성공 시 기존 재연결 타이머 취소
          if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
          }
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            onMessage(data);
          } catch (e) {
            console.error('WebSocket message parse error:', e);
          }
        };

        ws.onclose = (event) => {
          console.log('❌ WebSocket disconnected', event.code, event.reason);
          setIsConnected(false);
          isConnectingRef.current = false;
          
          // 정상 종료가 아닌 경우에만 재연결 시도
          if (event.code !== 1000 && event.code !== 1001) {
            // 지수 백오프: 3초, 6초, 12초, 최대 15초 (더 빠른 재연결)
            const delay = Math.min(3000 * Math.pow(2, reconnectAttemptsRef.current), 15000);
            reconnectAttemptsRef.current++;
            
            console.log(`🔄 재연결 시도 ${reconnectAttemptsRef.current}회 (${delay/1000}초 후)`);
            
            reconnectTimeoutRef.current = setTimeout(() => {
              if (!isConnectingRef.current) {
                connect();
              }
            }, delay);
          } else {
            // 정상 종료인 경우 재시도 횟수 리셋
            reconnectAttemptsRef.current = 0;
          }
        };

        ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          setIsConnected(false);
          isConnectingRef.current = false;
        };
      } catch (e) {
        console.error('WebSocket connection failed:', e);
        isConnectingRef.current = false;
        
        const delay = Math.min(5000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
        reconnectAttemptsRef.current++;
        
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, delay);
      }
    };

    connect();

    return () => {
      // 클린업: 타이머와 WebSocket 연결 정리
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (websocketRef.current) {
        try {
          websocketRef.current.close(1000, 'Component unmounting');
        } catch (e) {
          // 무시
        }
        websocketRef.current = null;
      }
      isConnectingRef.current = false;
    };
  }, []); // onMessage 의존성 제거

  // onMessage 변경 시 핸들러만 업데이트
  useEffect(() => {
    if (websocketRef.current && websocketRef.current.readyState === WebSocket.OPEN) {
      const ws = websocketRef.current;
      const originalOnMessage = ws.onmessage;
      
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          onMessage(data);
        } catch (e) {
          console.error('WebSocket message parse error:', e);
        }
      };
    }
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
  const [noiseStats, setNoiseStats] = useState(null);
  const [successRate, setSuccessRate] = useState(null);
  const [ancRunning, setAncRunning] = useState(false);
  const [airQualityData, setAirQualityData] = useState([]);
  const [pldcState, setPldcState] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [error, setError] = useState(null);

  // fetchSuccessRate 함수를 먼저 정의
  const fetchSuccessRate = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/noise/success-rate`);
      if (response.ok) {
        const data = await response.json();
        setSuccessRate(data.success_rate);
      }
    } catch (e) {
      console.error('Failed to fetch success rate:', e);
    }
  }, []);

  // WebSocket 메시지 핸들러 - useCallback으로 메모이제이션
  const handleWebSocketMessage = useCallback((data) => {
    if (data.type === 'sensor_update' || data.type === 'pldc_update') {
      // 실시간 업데이트시 데이터 새로고침은 refreshAllData에서 처리
      if (data.type === 'pldc_update') {
        setPldcState(data.state);
      }
    } else if (data.type === 'anc_update') {
      setAncRunning(data.running);
      if (data.running) {
        fetchSuccessRate();
      }
    }
  }, [fetchSuccessRate]);

  const { isConnected } = useWebSocket(handleWebSocketMessage);

  const fetchCurrentData = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/current`);
      if (!response.ok) throw new Error('Failed to fetch current data');
      const data = await response.json();
      setCurrentData(data);
      setPldcState(data.pldc_state || false);
      setLastUpdate(new Date());
      setError(null);
    } catch (err) {
      console.error('Error fetching current data:', err);
      setError('데이터를 불러올 수 없습니다');
    }
  };

  const fetchTemperatureData = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/temperature-humidity?hours=24`);
      if (!response.ok) throw new Error('Failed to fetch temperature data');
      const data = await response.json();
      setTemperatureData(data);
    } catch (err) {
      console.error('Error fetching temperature data:', err);
    }
  };

  const fetchNoiseData = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/noise?minutes=60`);
      if (!response.ok) throw new Error('Failed to fetch noise data');
      const data = await response.json();
      setNoiseData(data);
    } catch (err) {
      console.error('Error fetching noise data:', err);
    }
  };

  const fetchNoiseStats = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/noise/stats?hours=24`);
      if (!response.ok) throw new Error('Failed to fetch noise stats');
      const data = await response.json();
      setNoiseStats(data);
    } catch (err) {
      console.error('Error fetching noise stats:', err);
    }
  };


  const fetchAirQualityData = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/air-quality?hours=24`);
      if (!response.ok) throw new Error('Failed to fetch air quality data');
      const data = await response.json();
      setAirQualityData(data);
    } catch (err) {
      console.error('Error fetching air quality data:', err);
    }
  };

  const fetchAlerts = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/alerts?resolved=false`);
      if (!response.ok) throw new Error('Failed to fetch alerts');
      const data = await response.json();
      // Ensure data is an array before setting
      setAlerts(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error fetching alerts:', err);
      // Set empty array on error to prevent crashes
      setAlerts([]);
    }
  };

  const togglePLDC = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/pldc/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: !pldcState })
      });
      const data = await response.json();
      if (data.success) {
        setPldcState(!pldcState);
      }
    } catch (err) {
      console.error('Error controlling PLDC:', err);
      setError('PLDC 제어에 실패했습니다');
    }
  };

  const fetchAncStatus = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/anc/status`);
      if (!response.ok) throw new Error('Failed to fetch ANC status');
      const data = await response.json();
      setAncRunning(data.running);
      if (data.success_rate !== null) {
        setSuccessRate(data.success_rate);
      }
    } catch (err) {
      console.error('Error fetching ANC status:', err);
    }
  };

  const toggleAnc = async () => {
    try {
      const action = ancRunning ? 'stop' : 'start';
      const response = await fetch(`${API_BASE_URL}/anc/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      const data = await response.json();
      if (data.success || data.running !== undefined) {
        setAncRunning(data.running);
      }
    } catch (err) {
      console.error('Error controlling ANC:', err);
      setError('ANC 제어에 실패했습니다');
    }
  };

  const resolveAlert = async (alertId) => {
    try {
      const response = await fetch(`${API_BASE_URL}/alerts/${alertId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (response.ok) {
        setAlerts(alerts.filter(a => a.id !== alertId));
      }
    } catch (err) {
      console.error('Error resolving alert:', err);
    }
  };

  const refreshAllData = async () => {
    setIsLoading(true);
    await Promise.all([
      fetchCurrentData(),
      fetchTemperatureData(),
      fetchNoiseData(),
      fetchNoiseStats(),
      fetchSuccessRate(),
      fetchAncStatus(),
      fetchAirQualityData(),
      fetchAlerts()
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
      currentData,
      temperatureData,
      noiseData,
      noiseStats,
      successRate,
      ancRunning,
      airQualityData,
      pldcState,
      alerts,
      isLoading,
      lastUpdate,
      error,
      isConnected,
      togglePLDC,
      toggleAnc,
      refreshAllData,
      resolveAlert
    }}>
      {children}
    </DataContext.Provider>
  );
};

// =====================================================
// 유틸리티 함수
// =====================================================
const formatTime = (date) => {
  if (!date) return '-';
  return new Date(date).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit'
  });
};

const formatDateTime = (date) => {
  if (!date) return '-';
  return new Date(date).toLocaleString('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const getPMStatus = (pm25) => {
  if (!pm25 || pm25 <= 15) return { text: '좋음', color: 'from-emerald-400 to-teal-500', textColor: 'text-emerald-400', emoji: '😊', level: 1 };
  if (pm25 <= 35) return { text: '보통', color: 'from-sky-400 to-blue-500', textColor: 'text-sky-400', emoji: '🙂', level: 2 };
  if (pm25 <= 75) return { text: '나쁨', color: 'from-amber-400 to-orange-500', textColor: 'text-amber-400', emoji: '😷', level: 3 };
  return { text: '매우나쁨', color: 'from-rose-400 to-red-500', textColor: 'text-rose-400', emoji: '😵', level: 4 };
};

const getTemperatureStatus = (temp) => {
  if (!temp) return { text: '-', color: 'from-slate-400 to-slate-500' };
  if (temp < 18) return { text: '추움', color: 'from-blue-400 to-indigo-500', icon: '❄️' };
  if (temp <= 26) return { text: '쾌적', color: 'from-emerald-400 to-green-500', icon: '✨' };
  return { text: '더움', color: 'from-orange-400 to-red-500', icon: '🔥' };
};

const getHumidityStatus = (humidity) => {
  if (!humidity) return { text: '-', color: 'from-slate-400 to-slate-500' };
  if (humidity < 30) return { text: '건조', color: 'from-amber-400 to-orange-500' };
  if (humidity <= 60) return { text: '적정', color: 'from-cyan-400 to-blue-500' };
  return { text: '습함', color: 'from-indigo-400 to-purple-500' };
};

// =====================================================
// 공통 컴포넌트
// =====================================================
const GlassCard = ({ children, className = '', onClick, hover = false }) => (
  <div
    onClick={onClick}
    className={`
      relative overflow-hidden
      bg-white/80 backdrop-blur-xl
      border border-slate-200
      rounded-[28px]
      shadow-lg
      ${hover ? 'cursor-pointer transition-all duration-500 hover:bg-white hover:border-slate-300 hover:shadow-xl hover:scale-[1.02]' : ''}
      ${className}
    `}
  >
    <div className="absolute inset-0 bg-gradient-to-br from-white/50 to-transparent pointer-events-none" />
    <div className="relative z-10">{children}</div>
  </div>
);

const StatusBadge = ({ status, color }) => (
  <span className={`
    inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold
    bg-gradient-to-r ${color} text-white
    shadow-lg
  `}>
    {status}
  </span>
);

const LoadingSpinner = () => (
  <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
    <div className="relative">
      <div className="w-20 h-20 border-4 border-slate-200 rounded-full" />
      <div className="absolute top-0 left-0 w-20 h-20 border-4 border-transparent border-t-cyan-500 rounded-full animate-spin" />
      <div className="absolute top-2 left-2 w-16 h-16 border-4 border-transparent border-t-purple-500 rounded-full animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }} />
    </div>
  </div>
);

const ConnectionStatus = ({ isConnected }) => (
  <div className={`
    flex items-center gap-2 px-4 py-2 rounded-2xl text-sm font-medium
    transition-all duration-300
    ${isConnected
      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
      : 'bg-rose-50 text-rose-700 border border-rose-200'
    }
  `}>
    <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
    {isConnected ? '실시간 연결' : '연결 끊김'}
  </div>
);

const AlertBanner = ({ alerts, onResolve }) => {
  // Defensive programming: ensure alerts is an array
  if (!alerts || !Array.isArray(alerts) || alerts.length === 0) return null;

  return (
    <div className="mb-6 space-y-3">
      {alerts.slice(0, 3).map((alert) => (
        <div
          key={alert.id}
          className={`
            flex items-center justify-between p-4 rounded-2xl
            border backdrop-blur-xl shadow-sm
            ${alert.severity === 'critical'
              ? 'bg-rose-50 border-rose-200 text-rose-900'
              : 'bg-amber-50 border-amber-200 text-amber-900'
            }
          `}
        >
          <div className="flex items-center gap-3">
            <AlertTriangle className={`w-5 h-5 ${alert.severity === 'critical' ? 'text-rose-600' : 'text-amber-600'}`} />
            <div>
              <p className="font-medium">{alert.message}</p>
              <p className="text-xs opacity-60">{formatDateTime(alert.created_at)}</p>
            </div>
          </div>
          <button
            onClick={() => onResolve(alert.id)}
            className="p-2 hover:bg-white/50 rounded-xl transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
};

// =====================================================
// 대시보드 (메인)
// =====================================================
const Dashboard = ({ onNavigate }) => {
  const {
    currentData, pldcState, togglePLDC, ancRunning, successRate,
    isLoading, lastUpdate, refreshAllData, isConnected, alerts, resolveAlert, error
  } = useApiData();

  if (isLoading && !currentData) {
    return <LoadingSpinner />;
  }

  const temp = currentData?.current_temperature ? parseFloat(currentData.current_temperature) : null;
  const humidity = currentData?.current_humidity ? parseFloat(currentData.current_humidity) : null;
  const noise = currentData?.current_noise ? parseFloat(currentData.current_noise) : null;
  const noiseCancelled = currentData?.current_noise_cancelled ? parseFloat(currentData.current_noise_cancelled) : null;
  const pm25 = currentData?.current_pm25 ? parseFloat(currentData.current_pm25) : null;
  const pm10 = currentData?.current_pm10 ? parseFloat(currentData.current_pm10) : null;

  const pmStatus = getPMStatus(pm25);
  const tempStatus = getTemperatureStatus(temp);
  const humidityStatus = getHumidityStatus(humidity);
  const noiseReduction = noise && noiseCancelled ? ((noise - noiseCancelled) / noise * 100).toFixed(0) : 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 text-slate-900">
      {/* 배경 효과 */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-purple-200/30 rounded-full blur-[150px]" />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-cyan-200/30 rounded-full blur-[150px]" />
        <div className="absolute top-1/2 left-1/2 w-[400px] h-[400px] bg-pink-200/20 rounded-full blur-[120px]" />
      </div>

      {/* 헤더 */}
      <header className="relative z-10 border-b border-slate-200/80 bg-white/60 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 py-5">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-cyan-400 to-purple-500 rounded-2xl blur-lg opacity-50" />
                <div className="relative p-3 bg-gradient-to-br from-cyan-400 to-purple-500 rounded-2xl">
                  <Home className="w-7 h-7 text-white" />
                </div>
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight">
                  <span className="bg-gradient-to-r from-slate-900 to-slate-600 bg-clip-text text-transparent">
                    Smart Home
                  </span>
                </h1>
                <p className="text-sm text-slate-500 font-medium">IoT Monitoring System</p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <ConnectionStatus isConnected={isConnected} />

              <div className="text-right hidden sm:block">
                <p className="text-xs text-slate-400 uppercase tracking-wider">Last Update</p>
                <p className="text-sm font-mono text-slate-600">{formatTime(lastUpdate)}</p>
              </div>

              <button
                onClick={refreshAllData}
                disabled={isLoading}
                className="p-3 bg-white hover:bg-slate-50 border border-slate-200 rounded-2xl transition-all duration-300 disabled:opacity-50 shadow-sm"
              >
                <RefreshCw className={`w-5 h-5 text-slate-600 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-7xl mx-auto px-6 py-8">
        {/* 에러 메시지 */}
        {error && (
          <div className="mb-6 p-4 bg-rose-50 border border-rose-200 rounded-2xl text-rose-700 flex items-center gap-3 shadow-sm">
            <AlertCircle className="w-5 h-5" />
            {error}
          </div>
        )}

        {/* 알림 배너 */}
        <AlertBanner alerts={alerts} onResolve={resolveAlert} />

        {/* PLDC 조명 컨트롤 */}
        <GlassCard className="mb-8 p-8">
          <div className="flex flex-col sm:flex-row justify-between items-center gap-6">
            <div className="flex items-center gap-5">
              <div className={`
                relative p-5 rounded-3xl transition-all duration-500
                ${pldcState
                  ? 'bg-gradient-to-br from-amber-100 to-orange-100 shadow-[0_0_40px_rgba(251,191,36,0.2)]'
                  : 'bg-slate-100'
                }
              `}>
                <Zap className={`w-10 h-10 transition-colors duration-500 ${pldcState ? 'text-amber-600' : 'text-slate-400'}`} />
                {pldcState && (
                  <div className="absolute inset-0 bg-amber-200/30 rounded-3xl animate-ping" />
                )}
              </div>
              <div>
                <h2 className="text-2xl font-bold text-slate-900 mb-1">PDLC 필름</h2>
                <p className="text-slate-500">스마트 윈도우 투명도 제어</p>
              </div>
            </div>

            <button
              onClick={togglePLDC}
              className={`
                relative w-32 h-16 rounded-full transition-all duration-500
                ${pldcState
                  ? 'bg-gradient-to-r from-amber-400 to-orange-500 shadow-[0_0_40px_rgba(251,191,36,0.4)]'
                  : 'bg-white/[0.08] border border-white/[0.1]'
                }
              `}
            >
              <div className={`
                absolute top-2 w-12 h-12 bg-white rounded-full shadow-xl 
                transition-all duration-500 flex items-center justify-center
                ${pldcState ? 'left-[calc(100%-56px)]' : 'left-2'}
              `}>
                <Power className={`w-6 h-6 ${pldcState ? 'text-amber-500' : 'text-slate-400'}`} />
              </div>
              <span className={`
                absolute top-1/2 -translate-y-1/2 font-bold text-sm tracking-wider
                ${pldcState ? 'left-4 text-white' : 'right-4 text-slate-500'}
              `}>
                {pldcState ? 'ON' : 'OFF'}
              </span>
            </button>
          </div>
        </GlassCard>

        {/* 센서 카드 그리드 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* 온습도 카드 */}
          <GlassCard
            hover
            onClick={() => onNavigate('temperature')}
            className="p-7 group"
          >
            <div className="flex justify-between items-start mb-6">
              <div className="flex items-center gap-3">
                <div className={`p-3 bg-gradient-to-br ${tempStatus.color} rounded-2xl shadow-lg`}>
                  <Thermometer className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">온습도</h3>
                  <p className="text-xs text-slate-500">Temperature & Humidity</p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-slate-400 group-hover:text-slate-700 group-hover:translate-x-1 transition-all duration-300" />
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">온도</p>
                <p className="text-4xl font-bold text-slate-900 mb-2">
                  {temp?.toFixed(1) || '--'}
                  <span className="text-lg text-slate-500">°C</span>
                </p>
                <StatusBadge status={tempStatus.text} color={tempStatus.color} />
              </div>
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">습도</p>
                <p className="text-4xl font-bold text-slate-900 mb-2">
                  {humidity?.toFixed(0) || '--'}
                  <span className="text-lg text-slate-500">%</span>
                </p>
                <StatusBadge status={humidityStatus.text} color={humidityStatus.color} />
              </div>
            </div>
          </GlassCard>

          {/* 소음 카드 */}
          <GlassCard
            hover
            onClick={() => onNavigate('noise')}
            className="p-7 group"
          >
            <div className="flex justify-between items-start mb-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-gradient-to-br from-emerald-400 to-teal-500 rounded-2xl shadow-lg">
                  <Volume2 className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">소음 측정</h3>
                  <p className="text-xs text-slate-500">Noise Cancellation</p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-slate-400 group-hover:text-slate-700 group-hover:translate-x-1 transition-all duration-300" />
            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-slate-600 text-sm">원본 소음</span>
                <span className="text-2xl font-bold text-slate-900">{noise?.toFixed(0) || '--'} <span className="text-sm text-slate-500">dB</span></span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-600 text-sm">상쇄 후</span>
                <span className="text-2xl font-bold text-emerald-600">{noiseCancelled?.toFixed(0) || '--'} <span className="text-sm text-emerald-500">dB</span></span>
              </div>
              <div className="p-4 bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-2xl">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Shield className="w-5 h-5 text-emerald-600" />
                    <span className="text-emerald-700 text-sm">노이즈 캔슬링</span>
                  </div>
                  <span className="text-emerald-600 font-bold text-lg">{noiseReduction}% 감소</span>
                </div>
              </div>
            </div>
          </GlassCard>

          {/* 공기질 카드 */}
          <GlassCard
            hover
            onClick={() => onNavigate('air')}
            className="p-7 group"
          >
            <div className="flex justify-between items-start mb-6">
              <div className="flex items-center gap-3">
                <div className={`p-3 bg-gradient-to-br ${pmStatus.color} rounded-2xl shadow-lg`}>
                  <Wind className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">공기질</h3>
                  <p className="text-xs text-slate-500">Air Quality Index</p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-slate-400 group-hover:text-slate-700 group-hover:translate-x-1 transition-all duration-300" />
            </div>

            <div className="text-center mb-5">
              <div className="text-6xl mb-3">{pmStatus.emoji}</div>
              <p className={`text-2xl font-bold ${pmStatus.textColor}`}>{pmStatus.text}</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-white/70 rounded-2xl text-center border border-slate-200 shadow-sm">
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">PM2.5</p>
                <p className="text-2xl font-bold text-slate-900">{pm25?.toFixed(0) || '--'}</p>
                <p className="text-xs text-slate-400">㎍/㎥</p>
              </div>
              <div className="p-4 bg-white/70 rounded-2xl text-center border border-slate-200 shadow-sm">
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">PM10</p>
                <p className="text-2xl font-bold text-slate-900">{pm10?.toFixed(0) || '--'}</p>
                <p className="text-xs text-slate-400">㎍/㎥</p>
              </div>
            </div>
          </GlassCard>

          {/* 시스템 상태 카드 */}
          <GlassCard className="p-7">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 bg-gradient-to-br from-violet-400 to-purple-500 rounded-2xl shadow-lg">
                <Activity className="w-6 h-6 text-white" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">시스템 상태</h3>
                <p className="text-xs text-slate-500">System Health</p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between p-4 bg-white/70 rounded-2xl border border-slate-200 shadow-sm">
                <div className="flex items-center gap-3">
                  {isConnected ? <Wifi className="w-5 h-5 text-emerald-600" /> : <WifiOff className="w-5 h-5 text-rose-600" />}
                  <span className="text-slate-700">네트워크</span>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${isConnected ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                  {isConnected ? '연결됨' : '끊김'}
                </span>
              </div>
              <div className="flex items-center justify-between p-4 bg-white/70 rounded-2xl border border-slate-200 shadow-sm">
                <div className="flex items-center gap-3">
                  <Gauge className="w-5 h-5 text-cyan-600" />
                  <span className="text-slate-700">센서</span>
                </div>
                <span className="px-3 py-1 bg-cyan-100 text-cyan-700 rounded-full text-xs font-semibold">
                  {currentData ? '정상' : '대기중'}
                </span>
              </div>
              <div className="flex items-center justify-between p-4 bg-white/70 rounded-2xl border border-slate-200 shadow-sm">
                <div className="flex items-center gap-3">
                  <Clock className="w-5 h-5 text-purple-600" />
                  <span className="text-slate-700">갱신 주기</span>
                </div>
                <span className="text-purple-600 text-sm font-medium">30초</span>
              </div>
              {Array.isArray(alerts) && alerts.length > 0 && (
                <div className="flex items-center justify-between p-4 bg-amber-50 rounded-2xl border border-amber-200 shadow-sm">
                  <div className="flex items-center gap-3">
                    <Bell className="w-5 h-5 text-amber-600" />
                    <span className="text-slate-700">활성 알림</span>
                  </div>
                  <span className="px-3 py-1 bg-amber-100 text-amber-700 rounded-full text-xs font-semibold">
                    {alerts.length}개
                  </span>
                </div>
              )}
            </div>
          </GlassCard>
        </div>
      </main>
    </div>
  );
};

// =====================================================
// 온습도 상세 페이지
// =====================================================
const TemperatureDetail = ({ onBack }) => {
  const { currentData, temperatureData } = useApiData();

  const formatChartData = () => {
    if (!temperatureData || temperatureData.length === 0) {
      return Array.from({ length: 24 }, (_, i) => ({
        hour: `${i}:00`,
        temperature: null,
        humidity: null
      }));
    }

    return temperatureData.map(d => ({
      hour: new Date(d.hour).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
      temperature: parseFloat(d.temperature) || 0,
      humidity: parseFloat(d.humidity) || 0
    }));
  };

  const chartData = formatChartData();
  const tempStatus = getTemperatureStatus(currentData?.current_temperature ? parseFloat(currentData.current_temperature) : null);
  const humidityStatus = getHumidityStatus(currentData?.current_humidity ? parseFloat(currentData.current_humidity) : null);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 text-slate-900">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-rose-200/30 rounded-full blur-[150px]" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-blue-200/30 rounded-full blur-[150px]" />
      </div>

      <header className="relative z-10 border-b border-slate-200/80 bg-white/60 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 py-5">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className="p-3 bg-white hover:bg-slate-50 border border-slate-200 rounded-2xl transition-all shadow-sm"
            >
              <ArrowLeft className="w-5 h-5 text-slate-600" />
            </button>
            <div className="flex items-center gap-3">
              <div className="p-3 bg-gradient-to-br from-rose-400 to-orange-500 rounded-2xl shadow-lg">
                <Thermometer className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-slate-900">온습도 모니터링</h1>
                <p className="text-sm text-slate-500">24시간 상세 데이터</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <GlassCard className="p-8">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-700">현재 온도</h3>
              <TrendingUp className="w-5 h-5 text-rose-600" />
            </div>
            <p className="text-6xl font-bold text-slate-900 mb-4">
              {currentData?.current_temperature ? parseFloat(currentData.current_temperature).toFixed(1) : '--'}
              <span className="text-2xl text-slate-500">°C</span>
            </p>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">최적 범위</span>
                <span className="text-slate-700">22-26°C</span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-rose-400 to-orange-500 rounded-full transition-all duration-1000"
                  style={{ width: `${Math.min((parseFloat(currentData?.current_temperature || 0) / 40) * 100, 100)}%` }}
                />
              </div>
              <StatusBadge status={tempStatus.text} color={tempStatus.color} />
            </div>
          </GlassCard>

          <GlassCard className="p-8">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-700">현재 습도</h3>
              <Droplets className="w-5 h-5 text-cyan-600" />
            </div>
            <p className="text-6xl font-bold text-slate-900 mb-4">
              {currentData?.current_humidity ? parseFloat(currentData.current_humidity).toFixed(0) : '--'}
              <span className="text-2xl text-slate-500">%</span>
            </p>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">최적 범위</span>
                <span className="text-slate-700">40-60%</span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-cyan-400 to-blue-500 rounded-full transition-all duration-1000"
                  style={{ width: `${parseFloat(currentData?.current_humidity || 0)}%` }}
                />
              </div>
              <StatusBadge status={humidityStatus.text} color={humidityStatus.color} />
            </div>
          </GlassCard>
        </div>

        <GlassCard className="p-8 mb-6">
          <h3 className="text-xl font-semibold text-slate-900 mb-6">온도 변화 추이 (24시간)</h3>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="tempGradientDetail" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
              <XAxis dataKey="hour" stroke="rgba(71,85,105,0.7)" fontSize={11} />
              <YAxis stroke="rgba(71,85,105,0.7)" fontSize={11} domain={['auto', 'auto']} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgba(255,255,255,0.98)',
                  border: '1px solid rgba(148,163,184,0.3)',
                  borderRadius: '16px',
                  color: '#0f172a',
                  padding: '12px 16px'
                }}
                labelStyle={{ color: 'rgba(71,85,105,0.8)' }}
              />
              <Area
                type="monotone"
                dataKey="temperature"
                stroke="#f43f5e"
                strokeWidth={3}
                fill="url(#tempGradientDetail)"
                name="온도 (°C)"
                dot={false}
                activeDot={{ r: 6, fill: '#f43f5e', strokeWidth: 0 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </GlassCard>

        <GlassCard className="p-8">
          <h3 className="text-xl font-semibold text-slate-900 mb-6">습도 변화 추이 (24시간)</h3>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="humidGradientDetail" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
              <XAxis dataKey="hour" stroke="rgba(71,85,105,0.7)" fontSize={11} />
              <YAxis stroke="rgba(71,85,105,0.7)" fontSize={11} domain={[0, 100]} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgba(255,255,255,0.98)',
                  border: '1px solid rgba(148,163,184,0.3)',
                  borderRadius: '16px',
                  color: '#0f172a',
                  padding: '12px 16px'
                }}
                labelStyle={{ color: 'rgba(71,85,105,0.8)' }}
              />
              <Area
                type="monotone"
                dataKey="humidity"
                stroke="#22d3ee"
                strokeWidth={3}
                fill="url(#humidGradientDetail)"
                name="습도 (%)"
                dot={false}
                activeDot={{ r: 6, fill: '#22d3ee', strokeWidth: 0 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </GlassCard>
      </main>
    </div>
  );
};

// =====================================================
// 소음 상세 페이지
// =====================================================
const NoiseDetail = ({ onBack }) => {
  const { noiseData, noiseStats, successRate, currentData } = useApiData();
  const [selectedView, setSelectedView] = useState('all');

  const formatChartData = () => {
    if (!noiseData || noiseData.length === 0) {
      return [];
    }

    return noiseData.map(d => ({
      time: new Date(d.recorded_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
      original: parseFloat(d.original_db) || 0,
      cancelled: parseFloat(d.cancelled_db) || 0,
      reduction: parseFloat(d.reduction_db) || 0
    }));
  };

  const chartData = formatChartData();
  const noise = currentData?.current_noise ? parseFloat(currentData.current_noise) : null;
  const noiseCancelled = currentData?.current_noise_cancelled ? parseFloat(currentData.current_noise_cancelled) : null;
  const reductionPercent = noise && noiseCancelled ? ((noise - noiseCancelled) / noise * 100).toFixed(0) : 0;

  // 평균 감소량 (24시간 기준)
  const avgReduction = noiseStats?.avg_reduction ? parseFloat(noiseStats.avg_reduction) : null;
  const avgOriginal = noiseStats?.avg_original ? parseFloat(noiseStats.avg_original) : null;
  const avgCancelled = noiseStats?.avg_cancelled ? parseFloat(noiseStats.avg_cancelled) : null;

  // 성공률 등급
  const getSuccessRateGrade = (rate) => {
    if (rate === null) return { text: '--', color: 'text-slate-500', bgColor: 'bg-slate-100', emoji: '' };
    if (rate >= 70) return { text: '탁월', color: 'text-emerald-600', bgColor: 'bg-emerald-100', emoji: '🔥' };
    if (rate >= 50) return { text: '좋음', color: 'text-green-600', bgColor: 'bg-green-100', emoji: '🔥' };
    if (rate >= 30) return { text: '보통', color: 'text-amber-600', bgColor: 'bg-amber-100', emoji: '' };
    return { text: '미흡', color: 'text-rose-600', bgColor: 'bg-rose-100', emoji: '' };
  };
  const successRateGrade = getSuccessRateGrade(successRate);

  const viewButtons = [
    { id: 'all', label: '전체', color: 'bg-slate-100 text-slate-700' },
    { id: 'original', label: '원본', color: 'bg-amber-100 text-amber-700' },
    { id: 'cancelled', label: '상쇄 후', color: 'bg-emerald-100 text-emerald-700' },
    { id: 'reduction', label: '감소량', color: 'bg-violet-100 text-violet-700' }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 text-slate-900">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-0 w-[500px] h-[500px] bg-emerald-200/30 rounded-full blur-[150px]" />
        <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-teal-200/30 rounded-full blur-[120px]" />
      </div>

      <header className="relative z-10 border-b border-slate-200/80 bg-white/60 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 py-5">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className="p-3 bg-white hover:bg-slate-50 border border-slate-200 rounded-2xl transition-all shadow-sm"
            >
              <ArrowLeft className="w-5 h-5 text-slate-600" />
            </button>
            <div className="flex items-center gap-3">
              <div className="p-3 bg-gradient-to-br from-emerald-400 to-teal-500 rounded-2xl shadow-lg">
                <Volume2 className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-slate-900">소음 분석</h1>
                <p className="text-sm text-slate-500">실시간 노이즈 캔슬링 효과</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <GlassCard className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <Volume2 className="w-5 h-5 text-amber-600" />
              <h3 className="text-sm font-medium text-slate-600 uppercase tracking-wider">원본 소음</h3>
            </div>
            <p className="text-5xl font-bold text-slate-900 mb-2">
              {noise?.toFixed(0) || '--'}
              <span className="text-lg text-slate-500 ml-1">dB</span>
            </p>
            <p className="text-sm text-slate-500">측정된 환경 소음</p>
          </GlassCard>

          <GlassCard className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <Shield className="w-5 h-5 text-emerald-600" />
              <h3 className="text-sm font-medium text-slate-600 uppercase tracking-wider">상쇄 후</h3>
            </div>
            <p className="text-5xl font-bold text-emerald-600 mb-2">
              {noiseCancelled?.toFixed(0) || '--'}
              <span className="text-lg text-emerald-500 ml-1">dB</span>
            </p>
            <p className="text-sm text-slate-500">노이즈 캔슬링 적용</p>
          </GlassCard>

          <GlassCard className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <TrendingDown className="w-5 h-5 text-violet-600" />
              <h3 className="text-sm font-medium text-slate-600 uppercase tracking-wider">감소율</h3>
            </div>
            <p className="text-5xl font-bold text-violet-600 mb-2">
              {reductionPercent}
              <span className="text-lg text-violet-500 ml-1">%</span>
            </p>
            <p className="text-sm text-slate-500">소음 제거 효과</p>
          </GlassCard>

          <GlassCard className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <Zap className="w-5 h-5 text-orange-600" />
              <h3 className="text-sm font-medium text-slate-600 uppercase tracking-wider">성공률</h3>
            </div>
            <p className="text-5xl font-bold text-orange-600 mb-2">
              {successRateGrade.emoji}{successRate !== null ? successRate.toFixed(0) : '--'}
              <span className="text-lg text-orange-500 ml-1">%</span>
            </p>
            <div className="flex items-center gap-2">
              <span className={`px-2 py-1 rounded-full text-xs font-semibold ${successRateGrade.bgColor} ${successRateGrade.color}`}>
                {successRateGrade.text}
              </span>
              <p className="text-sm text-slate-500">ANC 효과 빈도</p>
            </div>
          </GlassCard>
        </div>

        <div className="flex gap-2 mb-6 flex-wrap">
          {viewButtons.map(btn => (
            <button
              key={btn.id}
              onClick={() => setSelectedView(btn.id)}
              className={`
                px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-300
                ${selectedView === btn.id
                  ? btn.color + ' border border-slate-300 shadow-sm'
                  : 'bg-white/70 text-slate-600 hover:bg-white hover:shadow-sm border border-slate-200'
                }
              `}
            >
              {btn.label}
            </button>
          ))}
        </div>

        <GlassCard className="p-8">
          <h3 className="text-xl font-semibold text-slate-900 mb-6">실시간 소음 레벨 (최근 60분)</h3>
          {chartData.length === 0 ? (
            <div className="h-[400px] flex items-center justify-center text-slate-500">
              <div className="text-center">
                <Info className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>데이터가 없습니다</p>
                <p className="text-sm mt-2">센서에서 데이터를 수집 중입니다...</p>
              </div>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={400}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                <XAxis dataKey="time" stroke="rgba(71,85,105,0.7)" fontSize={11} />
                <YAxis stroke="rgba(71,85,105,0.7)" fontSize={11} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'rgba(255,255,255,0.98)',
                    border: '1px solid rgba(148,163,184,0.3)',
                    borderRadius: '16px',
                    color: '#0f172a',
                    padding: '12px 16px'
                  }}
                  labelStyle={{ color: 'rgba(71,85,105,0.8)' }}
                />
                <Legend />
                {(selectedView === 'all' || selectedView === 'original') && (
                  <Line
                    type="monotone"
                    dataKey="original"
                    stroke="#fbbf24"
                    strokeWidth={selectedView === 'original' ? 3 : 2}
                    strokeOpacity={selectedView === 'all' ? 1 : selectedView === 'original' ? 1 : 0.3}
                    name="원본 소음 (dB)"
                    dot={false}
                    activeDot={{ r: 5, fill: '#fbbf24' }}
                  />
                )}
                {(selectedView === 'all' || selectedView === 'cancelled') && (
                  <Line
                    type="monotone"
                    dataKey="cancelled"
                    stroke="#34d399"
                    strokeWidth={selectedView === 'cancelled' ? 3 : 2}
                    strokeOpacity={selectedView === 'all' ? 1 : selectedView === 'cancelled' ? 1 : 0.3}
                    name="상쇄 후 (dB)"
                    dot={false}
                    activeDot={{ r: 5, fill: '#34d399' }}
                  />
                )}
                {(selectedView === 'all' || selectedView === 'reduction') && (
                  <Line
                    type="monotone"
                    dataKey="reduction"
                    stroke="#a78bfa"
                    strokeWidth={selectedView === 'reduction' ? 3 : 2}
                    strokeOpacity={selectedView === 'all' ? 1 : selectedView === 'reduction' ? 1 : 0.3}
                    name="감소량 (dB)"
                    dot={false}
                    activeDot={{ r: 5, fill: '#a78bfa' }}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          )}
        </GlassCard>
      </main>
    </div>
  );
};

// =====================================================
// 공기질 상세 페이지
// =====================================================
const AirQualityDetail = ({ onBack }) => {
  const { airQualityData, currentData } = useApiData();

  const formatChartData = () => {
    if (!airQualityData || airQualityData.length === 0) {
      return [];
    }

    return airQualityData.map(d => ({
      hour: new Date(d.hour).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
      pm25: parseFloat(d.pm25) || 0,
      pm10: parseFloat(d.pm10) || 0
    }));
  };

  const chartData = formatChartData();
  const pm25 = currentData?.current_pm25 ? parseFloat(currentData.current_pm25) : null;
  const pm10 = currentData?.current_pm10 ? parseFloat(currentData.current_pm10) : null;
  const pmStatus = getPMStatus(pm25);

  const pieData = [
    { name: 'PM2.5', value: pm25 || 0, color: '#8b5cf6' },
    { name: 'PM10', value: pm10 || 0, color: '#ec4899' }
  ];

  const aqiLevels = [
    { label: '좋음', range: '0-15', color: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
    { label: '보통', range: '16-35', color: 'bg-sky-50 border-sky-200 text-sky-700' },
    { label: '나쁨', range: '36-75', color: 'bg-amber-50 border-amber-200 text-amber-700' },
    { label: '매우나쁨', range: '76+', color: 'bg-rose-50 border-rose-200 text-rose-700' }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 text-slate-900">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/3 w-[500px] h-[500px] bg-violet-200/30 rounded-full blur-[150px]" />
        <div className="absolute bottom-1/4 right-0 w-[400px] h-[400px] bg-pink-200/30 rounded-full blur-[120px]" />
      </div>

      <header className="relative z-10 border-b border-slate-200/80 bg-white/60 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 py-5">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className="p-3 bg-white hover:bg-slate-50 border border-slate-200 rounded-2xl transition-all shadow-sm"
            >
              <ArrowLeft className="w-5 h-5 text-slate-600" />
            </button>
            <div className="flex items-center gap-3">
              <div className={`p-3 bg-gradient-to-br ${pmStatus.color} rounded-2xl shadow-lg`}>
                <Wind className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-slate-900">공기질 모니터링</h1>
                <p className="text-sm text-slate-500">미세먼지 상세 분석</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <GlassCard className="p-8 text-center">
            <h3 className="text-sm font-medium text-slate-600 uppercase tracking-wider mb-6">공기질 상태</h3>
            <div className="text-7xl mb-4">{pmStatus.emoji}</div>
            <p className={`text-3xl font-bold ${pmStatus.textColor}`}>{pmStatus.text}</p>
          </GlassCard>

          <GlassCard className="p-8">
            <h3 className="text-sm font-medium text-slate-600 uppercase tracking-wider mb-6">미세먼지 농도</h3>
            <div className="space-y-5">
              <div>
                <div className="flex justify-between mb-2">
                  <span className="text-slate-600">PM2.5</span>
                  <span className="text-2xl font-bold text-slate-900">{pm25?.toFixed(0) || '--'} <span className="text-sm text-slate-500">㎍/㎥</span></span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-violet-400 to-purple-500 rounded-full transition-all duration-1000"
                    style={{ width: `${Math.min((pm25 / 100) * 100, 100)}%` }}
                  />
                </div>
              </div>
              <div>
                <div className="flex justify-between mb-2">
                  <span className="text-slate-600">PM10</span>
                  <span className="text-2xl font-bold text-slate-900">{pm10?.toFixed(0) || '--'} <span className="text-sm text-slate-500">㎍/㎥</span></span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-pink-400 to-rose-500 rounded-full transition-all duration-1000"
                    style={{ width: `${Math.min((pm10 / 150) * 100, 100)}%` }}
                  />
                </div>
              </div>
            </div>
          </GlassCard>

          <GlassCard className="p-8">
            <h3 className="text-sm font-medium text-slate-600 uppercase tracking-wider mb-4">농도 비율</h3>
            <ResponsiveContainer width="100%" height={140}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={35}
                  outerRadius={55}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'rgba(255,255,255,0.98)',
                    border: '1px solid rgba(148,163,184,0.3)',
                    borderRadius: '12px',
                    color: '#0f172a'
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex justify-center gap-6 mt-2">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-violet-500 rounded-full" />
                <span className="text-slate-600 text-sm">PM2.5</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-pink-500 rounded-full" />
                <span className="text-slate-600 text-sm">PM10</span>
              </div>
            </div>
          </GlassCard>
        </div>

        <GlassCard className="p-8 mb-6">
          <h3 className="text-xl font-semibold text-slate-900 mb-6">24시간 미세먼지 추이</h3>
          {chartData.length === 0 ? (
            <div className="h-[400px] flex items-center justify-center text-slate-500">
              <div className="text-center">
                <Info className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>데이터가 없습니다</p>
                <p className="text-sm mt-2">센서에서 데이터를 수집 중입니다...</p>
              </div>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={400}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="pm25Gradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="pm10Gradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ec4899" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#ec4899" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                <XAxis dataKey="hour" stroke="rgba(71,85,105,0.7)" fontSize={11} />
                <YAxis stroke="rgba(71,85,105,0.7)" fontSize={11} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'rgba(255,255,255,0.98)',
                    border: '1px solid rgba(148,163,184,0.3)',
                    borderRadius: '16px',
                    color: '#0f172a',
                    padding: '12px 16px'
                  }}
                  labelStyle={{ color: 'rgba(71,85,105,0.8)' }}
                />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="pm25"
                  stroke="#8b5cf6"
                  strokeWidth={2}
                  fill="url(#pm25Gradient)"
                  name="PM2.5 (㎍/㎥)"
                  dot={false}
                  activeDot={{ r: 5, fill: '#8b5cf6' }}
                />
                <Area
                  type="monotone"
                  dataKey="pm10"
                  stroke="#ec4899"
                  strokeWidth={2}
                  fill="url(#pm10Gradient)"
                  name="PM10 (㎍/㎥)"
                  dot={false}
                  activeDot={{ r: 5, fill: '#ec4899' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </GlassCard>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {aqiLevels.map((level) => (
            <div
              key={level.label}
              className={`p-4 rounded-2xl border text-center ${level.color}`}
            >
              <p className="text-xs opacity-60 mb-1">{level.label}</p>
              <p className="font-bold">{level.range}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
};

// =====================================================
// 메인 앱
// =====================================================
const App = () => {
  const [currentPage, setCurrentPage] = useState('dashboard');

  return (
    <DataProvider>
      <div className="font-sans antialiased">
        {currentPage === 'dashboard' && <Dashboard onNavigate={setCurrentPage} />}
        {currentPage === 'temperature' && <TemperatureDetail onBack={() => setCurrentPage('dashboard')} />}
        {currentPage === 'noise' && <NoiseDetail onBack={() => setCurrentPage('dashboard')} />}
        {currentPage === 'air' && <AirQualityDetail onBack={() => setCurrentPage('dashboard')} />}
      </div>
    </DataProvider>
  );
};

export default App;
