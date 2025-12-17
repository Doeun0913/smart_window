import React, { useState, useEffect, createContext, useContext, useCallback, useRef } from 'react';
import { 
  LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, 
  Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar
} from 'recharts';
import { 
  Home, Thermometer, Droplets, Volume2, Wind, Power, RefreshCw, 
  Wifi, WifiOff, ChevronRight, ArrowLeft, Activity, Zap, Shield, 
  TrendingUp, TrendingDown, AlertTriangle, Clock, Gauge, Bell,
  X, AlertCircle, Info, Sun, Moon, Eye, EyeOff, ChevronDown, ChevronUp,
  Waves, Mic, VolumeX, BarChart3, Sparkles, Settings, Menu
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

  useEffect(() => {
    let websocket = null;
    let reconnectTimeout = null;

    const connect = () => {
      try {
        websocket = new WebSocket(WS_URL);

        websocket.onopen = () => {
          console.log('✅ WebSocket connected');
          setIsConnected(true);
        };

        websocket.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            onMessage(data);
          } catch (e) {
            console.error('WebSocket message parse error:', e);
          }
        };

        websocket.onclose = () => {
          console.log('❌ WebSocket disconnected');
          setIsConnected(false);
          reconnectTimeout = setTimeout(connect, 5000);
        };

        websocket.onerror = () => {
          setIsConnected(false);
        };
      } catch (e) {
        console.error('WebSocket connection failed:', e);
        reconnectTimeout = setTimeout(connect, 5000);
      }
    };

    connect();

    return () => {
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (websocket) websocket.close();
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
  const [pldcOpacity, setPldcOpacity] = useState(100); // 0-100 투명도
  const [alerts, setAlerts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [error, setError] = useState(null);

  const handleWebSocketMessage = useCallback((data) => {
    if (data.type === 'sensor_update') {
      fetchCurrentData();
      if (data.sensor === 'temperature_humidity') {
        fetchTemperatureData();
      } else if (data.sensor === 'noise') {
        fetchNoiseData();
      } else if (data.sensor === 'air_quality') {
        fetchAirQualityData();
      }
    } else if (data.type === 'pldc_update') {
      setPldcState(data.state);
    }
  }, []);

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
      setAlerts(data);
    } catch (err) {
      console.error('Error fetching alerts:', err);
    }
  };

  const togglePLDC = async () => {
    try {
      const newState = !pldcState;
      const response = await fetch(`${API_BASE_URL}/pldc/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: newState })
      });
      const data = await response.json();
      if (data.success) {
        setPldcState(newState);
        if (newState) {
          setPldcOpacity(100);
        }
      }
    } catch (err) {
      console.error('Error controlling PLDC:', err);
      setError('PDLC 제어에 실패했습니다');
    }
  };

  const setPldcLevel = async (level) => {
    try {
      setPldcOpacity(level);
      // 레벨이 0보다 크면 ON 상태로 설정
      const shouldBeOn = level > 0;
      if (shouldBeOn !== pldcState) {
        const response = await fetch(`${API_BASE_URL}/pldc/control`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: shouldBeOn })
        });
        const data = await response.json();
        if (data.success) {
          setPldcState(shouldBeOn);
        }
      }
    } catch (err) {
      console.error('Error setting PLDC level:', err);
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
      airQualityData,
      pldcState,
      pldcOpacity,
      alerts,
      isLoading,
      lastUpdate,
      error,
      isConnected,
      togglePLDC,
      setPldcLevel,
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
  if (!pm25 || pm25 <= 15) return { 
    text: '좋음', 
    desc: '야외 활동하기 좋아요', 
    color: '#10B981', 
    bgColor: 'bg-emerald-50', 
    borderColor: 'border-emerald-200',
    textColor: 'text-emerald-600',
    emoji: '😊', 
    level: 1,
    face: '😊'
  };
  if (pm25 <= 35) return { 
    text: '보통', 
    desc: '민감군은 장시간 야외활동 자제', 
    color: '#3B82F6', 
    bgColor: 'bg-blue-50', 
    borderColor: 'border-blue-200',
    textColor: 'text-blue-600',
    emoji: '🙂', 
    level: 2,
    face: '🙂'
  };
  if (pm25 <= 75) return { 
    text: '나쁨', 
    desc: '야외활동 시 마스크 착용', 
    color: '#F59E0B', 
    bgColor: 'bg-amber-50', 
    borderColor: 'border-amber-200',
    textColor: 'text-amber-600',
    emoji: '😷', 
    level: 3,
    face: '😷'
  };
  return { 
    text: '매우나쁨', 
    desc: '외출 자제 권고', 
    color: '#EF4444', 
    bgColor: 'bg-red-50', 
    borderColor: 'border-red-200',
    textColor: 'text-red-600',
    emoji: '😵', 
    level: 4,
    face: '😵'
  };
};

const getTemperatureStatus = (temp) => {
  if (!temp) return { text: '-', color: '#94A3B8', bgColor: 'bg-slate-50' };
  if (temp < 18) return { text: '추움', color: '#3B82F6', bgColor: 'bg-blue-50', icon: '❄️' };
  if (temp <= 26) return { text: '쾌적', color: '#10B981', bgColor: 'bg-emerald-50', icon: '✨' };
  return { text: '더움', color: '#EF4444', bgColor: 'bg-red-50', icon: '🔥' };
};

const getHumidityStatus = (humidity) => {
  if (!humidity) return { text: '-', color: '#94A3B8', bgColor: 'bg-slate-50' };
  if (humidity < 30) return { text: '건조', color: '#F59E0B', bgColor: 'bg-amber-50' };
  if (humidity <= 60) return { text: '적정', color: '#06B6D4', bgColor: 'bg-cyan-50' };
  return { text: '습함', color: '#8B5CF6', bgColor: 'bg-purple-50' };
};

const getNoiseLevel = (db) => {
  if (!db) return { text: '-', color: '#94A3B8' };
  if (db < 40) return { text: '조용함', color: '#10B981', desc: '도서관 수준' };
  if (db < 60) return { text: '보통', color: '#3B82F6', desc: '일반 대화 수준' };
  if (db < 80) return { text: '시끄러움', color: '#F59E0B', desc: '진공청소기 수준' };
  return { text: '매우 시끄러움', color: '#EF4444', desc: '청력 손상 위험' };
};

// =====================================================
// 공통 컴포넌트
// =====================================================
const Card = ({ children, className = '', onClick, style = {} }) => (
  <div 
    onClick={onClick}
    style={style}
    className={`
      bg-white rounded-3xl shadow-sm border border-slate-100
      transition-all duration-300 ease-out
      ${onClick ? 'cursor-pointer hover:shadow-lg hover:-translate-y-1 active:scale-[0.98]' : ''}
      ${className}
    `}
  >
    {children}
  </div>
);

const GlassPanel = ({ children, className = '' }) => (
  <div className={`
    bg-white/80 backdrop-blur-xl rounded-3xl
    border border-white/50 shadow-xl
    ${className}
  `}>
    {children}
  </div>
);

const IconBadge = ({ icon: Icon, color, size = 'md' }) => {
  const sizeClasses = {
    sm: 'w-8 h-8',
    md: 'w-12 h-12',
    lg: 'w-16 h-16'
  };
  const iconSizes = {
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-8 h-8'
  };
  
  return (
    <div 
      className={`${sizeClasses[size]} rounded-2xl flex items-center justify-center`}
      style={{ backgroundColor: `${color}15` }}
    >
      <Icon className={iconSizes[size]} style={{ color }} />
    </div>
  );
};

const StatusPill = ({ text, color, size = 'md' }) => {
  const sizeClasses = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-3 py-1 text-sm',
    lg: 'px-4 py-1.5 text-base'
  };
  
  return (
    <span 
      className={`inline-flex items-center rounded-full font-semibold ${sizeClasses[size]}`}
      style={{ backgroundColor: `${color}15`, color }}
    >
      {text}
    </span>
  );
};

const ProgressBar = ({ value, max, color, height = 'h-2' }) => (
  <div className={`w-full bg-slate-100 rounded-full ${height} overflow-hidden`}>
    <div 
      className={`${height} rounded-full transition-all duration-1000 ease-out`}
      style={{ 
        width: `${Math.min((value / max) * 100, 100)}%`,
        backgroundColor: color
      }}
    />
  </div>
);

const LoadingScreen = () => (
  <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 flex items-center justify-center">
    <div className="text-center">
      <div className="relative w-20 h-20 mx-auto mb-6">
        <div className="absolute inset-0 rounded-full border-4 border-slate-100" />
        <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-blue-500 animate-spin" />
        <div className="absolute inset-2 rounded-full border-4 border-transparent border-t-emerald-500 animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }} />
      </div>
      <p className="text-slate-400 font-medium">데이터를 불러오는 중...</p>
    </div>
  </div>
);

// =====================================================
// 헤더 컴포넌트
// =====================================================
const Header = ({ title, subtitle, onBack, showRefresh = true }) => {
  const { refreshAllData, isLoading, isConnected, lastUpdate } = useApiData();
  
  return (
    <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-slate-100">
      <div className="max-w-2xl mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {onBack ? (
              <button
                onClick={onBack}
                className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-100 hover:bg-slate-200 transition-colors"
              >
                <ArrowLeft className="w-5 h-5 text-slate-600" />
              </button>
            ) : (
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/30">
                <Home className="w-6 h-6 text-white" />
              </div>
            )}
            <div>
              <h1 className="text-xl font-bold text-slate-800">{title}</h1>
              {subtitle && <p className="text-sm text-slate-400">{subtitle}</p>}
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {/* 연결 상태 */}
            <div className={`
              flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium
              ${isConnected 
                ? 'bg-emerald-50 text-emerald-600' 
                : 'bg-red-50 text-red-600'
              }
            `}>
              <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
              {isConnected ? '연결됨' : '끊김'}
            </div>
            
            {/* 새로고침 */}
            {showRefresh && (
              <button
                onClick={refreshAllData}
                disabled={isLoading}
                className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-100 hover:bg-slate-200 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-5 h-5 text-slate-600 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};

// =====================================================
// PDLC 컨트롤러 컴포넌트
// =====================================================
const PDLCController = () => {
  const { pldcState, pldcOpacity, togglePLDC, setPldcLevel } = useApiData();
  const [showSlider, setShowSlider] = useState(false);
  
  const opacityPresets = [
    { label: '0%', value: 0, desc: '완전 불투명' },
    { label: '25%', value: 25, desc: '약간 투명' },
    { label: '50%', value: 50, desc: '반투명' },
    { label: '75%', value: 75, desc: '대부분 투명' },
    { label: '100%', value: 100, desc: '완전 투명' }
  ];

  return (
    <Card className="p-6 overflow-hidden relative">
      {/* 배경 효과 */}
      <div 
        className="absolute inset-0 transition-opacity duration-500"
        style={{
          background: pldcState 
            ? `linear-gradient(135deg, rgba(251,191,36,${pldcOpacity/500}) 0%, rgba(245,158,11,${pldcOpacity/500}) 100%)`
            : 'transparent'
        }}
      />
      
      <div className="relative z-10">
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className={`
              w-14 h-14 rounded-2xl flex items-center justify-center transition-all duration-500
              ${pldcState 
                ? 'bg-gradient-to-br from-amber-400 to-orange-500 shadow-lg shadow-amber-500/40' 
                : 'bg-slate-100'
              }
            `}>
              {pldcState ? (
                <Sun className="w-7 h-7 text-white" />
              ) : (
                <Moon className="w-7 h-7 text-slate-400" />
              )}
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">스마트 글래스</h2>
              <p className="text-sm text-slate-400">PDLC 투명도 제어</p>
            </div>
          </div>
          
          {/* ON/OFF 토글 */}
          <button
            onClick={togglePLDC}
            className={`
              relative w-20 h-10 rounded-full transition-all duration-500
              ${pldcState 
                ? 'bg-gradient-to-r from-amber-400 to-orange-500 shadow-lg shadow-amber-500/30' 
                : 'bg-slate-200'
              }
            `}
          >
            <div className={`
              absolute top-1 w-8 h-8 rounded-full bg-white shadow-md
              transition-all duration-500 flex items-center justify-center
              ${pldcState ? 'left-[calc(100%-36px)]' : 'left-1'}
            `}>
              <Power className={`w-4 h-4 ${pldcState ? 'text-amber-500' : 'text-slate-400'}`} />
            </div>
          </button>
        </div>

        {/* 현재 상태 표시 */}
        <div className="flex items-center gap-3 mb-4">
          <div className={`
            flex-1 p-4 rounded-2xl text-center transition-all duration-300
            ${pldcState ? 'bg-amber-50 border-2 border-amber-200' : 'bg-slate-50 border-2 border-slate-200'}
          `}>
            <div className="flex items-center justify-center gap-2 mb-1">
              {pldcState ? <Eye className="w-5 h-5 text-amber-600" /> : <EyeOff className="w-5 h-5 text-slate-400" />}
              <span className={`text-2xl font-bold ${pldcState ? 'text-amber-600' : 'text-slate-600'}`}>
                {pldcState ? `${pldcOpacity}%` : 'OFF'}
              </span>
            </div>
            <p className={`text-xs ${pldcState ? 'text-amber-600' : 'text-slate-400'}`}>
              {pldcState ? (pldcOpacity === 100 ? '완전 투명' : pldcOpacity === 0 ? '완전 불투명' : '반투명') : '전원 꺼짐'}
            </p>
          </div>
        </div>

        {/* 투명도 조절 슬라이더 */}
        {pldcState && (
          <div className="space-y-4 animate-fadeIn">
            {/* 프리셋 버튼들 */}
            <div className="flex gap-2">
              {opacityPresets.map((preset) => (
                <button
                  key={preset.value}
                  onClick={() => setPldcLevel(preset.value)}
                  className={`
                    flex-1 py-3 rounded-xl text-sm font-medium transition-all duration-300
                    ${pldcOpacity === preset.value 
                      ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/30' 
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }
                  `}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            {/* 슬라이더 */}
            <div className="px-2">
              <input
                type="range"
                min="0"
                max="100"
                value={pldcOpacity}
                onChange={(e) => setPldcLevel(parseInt(e.target.value))}
                className="w-full h-2 bg-slate-200 rounded-full appearance-none cursor-pointer
                  [&::-webkit-slider-thumb]:appearance-none
                  [&::-webkit-slider-thumb]:w-6
                  [&::-webkit-slider-thumb]:h-6
                  [&::-webkit-slider-thumb]:rounded-full
                  [&::-webkit-slider-thumb]:bg-gradient-to-br
                  [&::-webkit-slider-thumb]:from-amber-400
                  [&::-webkit-slider-thumb]:to-orange-500
                  [&::-webkit-slider-thumb]:shadow-lg
                  [&::-webkit-slider-thumb]:shadow-amber-500/40
                  [&::-webkit-slider-thumb]:cursor-pointer
                  [&::-webkit-slider-thumb]:transition-transform
                  [&::-webkit-slider-thumb]:hover:scale-110
                "
              />
              <div className="flex justify-between mt-2 text-xs text-slate-400">
                <span>불투명</span>
                <span>투명</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
};

// =====================================================
// 온습도 카드 컴포넌트
// =====================================================
const TemperatureHumidityCard = ({ onClick }) => {
  const { currentData } = useApiData();
  const temp = currentData?.current_temperature;
  const humidity = currentData?.current_humidity;
  const tempStatus = getTemperatureStatus(temp);
  const humidityStatus = getHumidityStatus(humidity);

  return (
    <Card onClick={onClick} className="p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <IconBadge icon={Thermometer} color="#EF4444" />
          <div>
            <h3 className="font-bold text-slate-800">온습도</h3>
            <p className="text-xs text-slate-400">실내 환경</p>
          </div>
        </div>
        <ChevronRight className="w-5 h-5 text-slate-300" />
      </div>
      
      <div className="grid grid-cols-2 gap-4">
        <div className="p-3 bg-gradient-to-br from-red-50 to-orange-50 rounded-2xl">
          <div className="flex items-center gap-1 mb-1">
            <Thermometer className="w-4 h-4 text-red-500" />
            <span className="text-xs text-slate-500">온도</span>
          </div>
          <p className="text-2xl font-bold text-slate-800">
            {temp?.toFixed(1) || '--'}
            <span className="text-sm text-slate-400">°C</span>
          </p>
          <StatusPill text={tempStatus.text} color={tempStatus.color} size="sm" />
        </div>
        
        <div className="p-3 bg-gradient-to-br from-cyan-50 to-blue-50 rounded-2xl">
          <div className="flex items-center gap-1 mb-1">
            <Droplets className="w-4 h-4 text-cyan-500" />
            <span className="text-xs text-slate-500">습도</span>
          </div>
          <p className="text-2xl font-bold text-slate-800">
            {humidity?.toFixed(0) || '--'}
            <span className="text-sm text-slate-400">%</span>
          </p>
          <StatusPill text={humidityStatus.text} color={humidityStatus.color} size="sm" />
        </div>
      </div>
    </Card>
  );
};

// =====================================================
// 미세먼지 카드 컴포넌트
// =====================================================
const AirQualityCard = ({ onClick }) => {
  const { currentData } = useApiData();
  const pm25 = currentData?.current_pm25;
  const pm10 = currentData?.current_pm10;
  const pmStatus = getPMStatus(pm25);

  return (
    <Card onClick={onClick} className="p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <IconBadge icon={Wind} color={pmStatus.color} />
          <div>
            <h3 className="font-bold text-slate-800">공기질</h3>
            <p className="text-xs text-slate-400">미세먼지 현황</p>
          </div>
        </div>
        <ChevronRight className="w-5 h-5 text-slate-300" />
      </div>
      
      {/* 상태 표시 */}
      <div 
        className={`p-4 rounded-2xl mb-4 ${pmStatus.bgColor} border ${pmStatus.borderColor}`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-4xl">{pmStatus.face}</span>
            <div>
              <p className={`text-xl font-bold ${pmStatus.textColor}`}>{pmStatus.text}</p>
              <p className="text-xs text-slate-500">{pmStatus.desc}</p>
            </div>
          </div>
        </div>
      </div>
      
      {/* 수치 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="text-center p-3 bg-slate-50 rounded-xl">
          <p className="text-xs text-slate-400 mb-1">PM2.5</p>
          <p className="text-xl font-bold text-slate-800">{pm25?.toFixed(0) || '--'}</p>
          <p className="text-xs text-slate-400">㎍/㎥</p>
        </div>
        <div className="text-center p-3 bg-slate-50 rounded-xl">
          <p className="text-xs text-slate-400 mb-1">PM10</p>
          <p className="text-xl font-bold text-slate-800">{pm10?.toFixed(0) || '--'}</p>
          <p className="text-xs text-slate-400">㎍/㎥</p>
        </div>
      </div>
    </Card>
  );
};

// =====================================================
// 소음 카드 컴포넌트
// =====================================================
const NoiseCard = ({ onClick }) => {
  const { currentData } = useApiData();
  const noise = currentData?.current_noise;
  const noiseCancelled = currentData?.current_noise_cancelled;
  const noiseLevel = getNoiseLevel(noise);
  const reduction = noise && noiseCancelled ? noise - noiseCancelled : 0;
  const reductionPercent = noise && noiseCancelled ? ((reduction / noise) * 100).toFixed(0) : 0;

  return (
    <Card onClick={onClick} className="p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <IconBadge icon={Volume2} color="#10B981" />
          <div>
            <h3 className="font-bold text-slate-800">소음 분석</h3>
            <p className="text-xs text-slate-400">노이즈 캔슬링</p>
          </div>
        </div>
        <ChevronRight className="w-5 h-5 text-slate-300" />
      </div>
      
      {/* 소음 시각화 */}
      <div className="relative h-20 mb-4 bg-gradient-to-r from-slate-50 to-slate-100 rounded-2xl overflow-hidden">
        {/* 원본 소음 바 */}
        <div 
          className="absolute left-4 bottom-4 h-8 bg-gradient-to-r from-amber-400 to-orange-500 rounded-lg transition-all duration-500"
          style={{ width: `${Math.min((noise || 0) / 100 * 60, 60)}%` }}
        />
        {/* 상쇄 후 소음 바 */}
        <div 
          className="absolute left-4 bottom-4 h-8 bg-gradient-to-r from-emerald-400 to-teal-500 rounded-lg transition-all duration-500 opacity-80"
          style={{ width: `${Math.min((noiseCancelled || 0) / 100 * 60, 60)}%` }}
        />
        {/* 레이블 */}
        <div className="absolute right-4 top-1/2 -translate-y-1/2 text-right">
          <p className="text-2xl font-bold text-slate-800">{noise?.toFixed(0) || '--'}<span className="text-sm text-slate-400">dB</span></p>
          <p className="text-xs text-slate-400">{noiseLevel.text}</p>
        </div>
      </div>
      
      {/* 노이즈 캔슬링 효과 */}
      <div className="p-3 bg-gradient-to-r from-emerald-50 to-teal-50 rounded-xl border border-emerald-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-emerald-500" />
            <span className="text-sm text-emerald-700">노이즈 캔슬링</span>
          </div>
          <div className="text-right">
            <span className="text-lg font-bold text-emerald-600">-{reduction?.toFixed(0) || 0}dB</span>
            <span className="text-sm text-emerald-500 ml-1">({reductionPercent}%)</span>
          </div>
        </div>
      </div>
    </Card>
  );
};

// =====================================================
// 대시보드 메인
// =====================================================
const Dashboard = ({ onNavigate }) => {
  const { alerts, resolveAlert, error, lastUpdate } = useApiData();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50">
      <Header 
        title="스마트 홈" 
        subtitle="IoT 모니터링 시스템"
      />
      
      <main className="max-w-2xl mx-auto px-4 py-6 pb-24">
        {/* 에러 메시지 */}
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-2xl flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-500" />
            <p className="text-red-600 text-sm">{error}</p>
          </div>
        )}

        {/* 알림 */}
        {alerts.length > 0 && (
          <div className="mb-4 space-y-2">
            {alerts.slice(0, 2).map((alert) => (
              <div 
                key={alert.id}
                className={`
                  flex items-center justify-between p-4 rounded-2xl
                  ${alert.severity === 'critical' 
                    ? 'bg-red-50 border border-red-200' 
                    : 'bg-amber-50 border border-amber-200'
                  }
                `}
              >
                <div className="flex items-center gap-3">
                  <AlertTriangle className={`w-5 h-5 ${alert.severity === 'critical' ? 'text-red-500' : 'text-amber-500'}`} />
                  <div>
                    <p className={`text-sm font-medium ${alert.severity === 'critical' ? 'text-red-700' : 'text-amber-700'}`}>
                      {alert.message}
                    </p>
                    <p className="text-xs text-slate-400">{formatDateTime(alert.created_at)}</p>
                  </div>
                </div>
                <button 
                  onClick={() => resolveAlert(alert.id)}
                  className="p-2 hover:bg-white/50 rounded-xl transition-colors"
                >
                  <X className="w-4 h-4 text-slate-400" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* PDLC 컨트롤러 */}
        <div className="mb-4">
          <PDLCController />
        </div>

        {/* 센서 카드 그리드 */}
        <div className="grid grid-cols-1 gap-4">
          <TemperatureHumidityCard onClick={() => onNavigate('temperature')} />
          <AirQualityCard onClick={() => onNavigate('air')} />
          <NoiseCard onClick={() => onNavigate('noise')} />
        </div>

        {/* 마지막 업데이트 */}
        <div className="mt-6 text-center">
          <p className="text-xs text-slate-400">
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
  const { currentData, temperatureData } = useApiData();
  
  const formatChartData = () => {
    if (!temperatureData || temperatureData.length === 0) {
      // 데모 데이터 생성
      return Array.from({ length: 24 }, (_, i) => ({
        hour: `${String(i).padStart(2, '0')}:00`,
        temperature: 22 + Math.sin(i / 3) * 3 + Math.random() * 2,
        humidity: 50 + Math.cos(i / 4) * 15 + Math.random() * 5
      }));
    }
    
    return temperatureData.map(d => ({
      hour: new Date(d.hour).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
      temperature: parseFloat(d.temperature) || 0,
      humidity: parseFloat(d.humidity) || 0
    }));
  };

  const chartData = formatChartData();
  const temp = currentData?.current_temperature;
  const humidity = currentData?.current_humidity;
  const tempStatus = getTemperatureStatus(temp);
  const humidityStatus = getHumidityStatus(humidity);

  const avgTemp = chartData.reduce((sum, d) => sum + d.temperature, 0) / chartData.length;
  const maxTemp = Math.max(...chartData.map(d => d.temperature));
  const minTemp = Math.min(...chartData.map(d => d.temperature));

  return (
    <div className="min-h-screen bg-gradient-to-br from-red-50 via-white to-orange-50">
      <Header 
        title="온습도 모니터링" 
        subtitle="24시간 상세 데이터"
        onBack={onBack}
      />
      
      <main className="max-w-2xl mx-auto px-4 py-6 pb-24">
        {/* 현재 값 카드 */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <Card className="p-6 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-red-100 to-orange-100 flex items-center justify-center">
              <Thermometer className="w-8 h-8 text-red-500" />
            </div>
            <p className="text-5xl font-bold text-slate-800 mb-2">
              {temp?.toFixed(1) || '--'}
              <span className="text-xl text-slate-400">°C</span>
            </p>
            <StatusPill text={tempStatus.text} color={tempStatus.color} />
            <p className="text-xs text-slate-400 mt-2">현재 온도</p>
          </Card>
          
          <Card className="p-6 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-cyan-100 to-blue-100 flex items-center justify-center">
              <Droplets className="w-8 h-8 text-cyan-500" />
            </div>
            <p className="text-5xl font-bold text-slate-800 mb-2">
              {humidity?.toFixed(0) || '--'}
              <span className="text-xl text-slate-400">%</span>
            </p>
            <StatusPill text={humidityStatus.text} color={humidityStatus.color} />
            <p className="text-xs text-slate-400 mt-2">현재 습도</p>
          </Card>
        </div>

        {/* 통계 */}
        <Card className="p-5 mb-6">
          <h3 className="font-bold text-slate-800 mb-4">오늘의 온도 통계</h3>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-3 bg-blue-50 rounded-xl">
              <TrendingDown className="w-5 h-5 text-blue-500 mx-auto mb-1" />
              <p className="text-lg font-bold text-slate-800">{minTemp.toFixed(1)}°</p>
              <p className="text-xs text-slate-400">최저</p>
            </div>
            <div className="text-center p-3 bg-emerald-50 rounded-xl">
              <Activity className="w-5 h-5 text-emerald-500 mx-auto mb-1" />
              <p className="text-lg font-bold text-slate-800">{avgTemp.toFixed(1)}°</p>
              <p className="text-xs text-slate-400">평균</p>
            </div>
            <div className="text-center p-3 bg-red-50 rounded-xl">
              <TrendingUp className="w-5 h-5 text-red-500 mx-auto mb-1" />
              <p className="text-lg font-bold text-slate-800">{maxTemp.toFixed(1)}°</p>
              <p className="text-xs text-slate-400">최고</p>
            </div>
          </div>
        </Card>

        {/* 온도 그래프 */}
        <Card className="p-5 mb-6">
          <h3 className="font-bold text-slate-800 mb-4">온도 변화 (24시간)</h3>
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="tempGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#EF4444" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#EF4444" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis dataKey="hour" stroke="#94A3B8" fontSize={10} tickLine={false} />
              <YAxis stroke="#94A3B8" fontSize={10} tickLine={false} domain={['auto', 'auto']} />
              <Tooltip
                contentStyle={{ 
                  backgroundColor: 'white', 
                  border: '1px solid #E2E8F0', 
                  borderRadius: '12px',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                }}
              />
              <Area 
                type="monotone" 
                dataKey="temperature" 
                stroke="#EF4444" 
                strokeWidth={3}
                fill="url(#tempGrad)"
                name="온도 (°C)"
                dot={false}
                activeDot={{ r: 6, fill: '#EF4444', strokeWidth: 2, stroke: 'white' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        {/* 습도 그래프 */}
        <Card className="p-5">
          <h3 className="font-bold text-slate-800 mb-4">습도 변화 (24시간)</h3>
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="humidGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#06B6D4" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#06B6D4" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis dataKey="hour" stroke="#94A3B8" fontSize={10} tickLine={false} />
              <YAxis stroke="#94A3B8" fontSize={10} tickLine={false} domain={[0, 100]} />
              <Tooltip
                contentStyle={{ 
                  backgroundColor: 'white', 
                  border: '1px solid #E2E8F0', 
                  borderRadius: '12px',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                }}
              />
              <Area 
                type="monotone" 
                dataKey="humidity" 
                stroke="#06B6D4" 
                strokeWidth={3}
                fill="url(#humidGrad)"
                name="습도 (%)"
                dot={false}
                activeDot={{ r: 6, fill: '#06B6D4', strokeWidth: 2, stroke: 'white' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
      </main>
    </div>
  );
};

// =====================================================
// 미세먼지 상세 페이지
// =====================================================
const AirQualityDetail = ({ onBack }) => {
  const { airQualityData, currentData } = useApiData();
  
  const formatChartData = () => {
    if (!airQualityData || airQualityData.length === 0) {
      // 데모 데이터 생성
      return Array.from({ length: 24 }, (_, i) => ({
        hour: `${String(i).padStart(2, '0')}:00`,
        pm25: 20 + Math.sin(i / 4) * 15 + Math.random() * 10,
        pm10: 35 + Math.cos(i / 3) * 20 + Math.random() * 15
      }));
    }
    
    return airQualityData.map(d => ({
      hour: new Date(d.hour).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
      pm25: parseFloat(d.pm25) || 0,
      pm10: parseFloat(d.pm10) || 0
    }));
  };

  const chartData = formatChartData();
  const pm25 = currentData?.current_pm25;
  const pm10 = currentData?.current_pm10;
  const pmStatus = getPMStatus(pm25);

  const aqiLevels = [
    { label: '좋음', range: '0-15', color: '#10B981', bgColor: 'bg-emerald-50', borderColor: 'border-emerald-200' },
    { label: '보통', range: '16-35', color: '#3B82F6', bgColor: 'bg-blue-50', borderColor: 'border-blue-200' },
    { label: '나쁨', range: '36-75', color: '#F59E0B', bgColor: 'bg-amber-50', borderColor: 'border-amber-200' },
    { label: '매우나쁨', range: '76+', color: '#EF4444', bgColor: 'bg-red-50', borderColor: 'border-red-200' }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-50 via-white to-pink-50">
      <Header 
        title="공기질 모니터링" 
        subtitle="미세먼지 상세 분석"
        onBack={onBack}
      />
      
      <main className="max-w-2xl mx-auto px-4 py-6 pb-24">
        {/* 현재 상태 대형 카드 */}
        <Card className={`p-8 mb-6 ${pmStatus.bgColor} border-2 ${pmStatus.borderColor}`}>
          <div className="text-center">
            <span className="text-7xl mb-4 block">{pmStatus.face}</span>
            <h2 className={`text-3xl font-bold ${pmStatus.textColor} mb-2`}>{pmStatus.text}</h2>
            <p className="text-slate-600 mb-6">{pmStatus.desc}</p>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-white/80 rounded-2xl">
                <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">PM2.5</p>
                <p className="text-3xl font-bold text-slate-800">{pm25?.toFixed(0) || '--'}</p>
                <p className="text-xs text-slate-400">㎍/㎥</p>
              </div>
              <div className="p-4 bg-white/80 rounded-2xl">
                <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">PM10</p>
                <p className="text-3xl font-bold text-slate-800">{pm10?.toFixed(0) || '--'}</p>
                <p className="text-xs text-slate-400">㎍/㎥</p>
              </div>
            </div>
          </div>
        </Card>

        {/* 등급 안내 */}
        <Card className="p-5 mb-6">
          <h3 className="font-bold text-slate-800 mb-4">공기질 등급 안내</h3>
          <div className="grid grid-cols-4 gap-2">
            {aqiLevels.map((level) => (
              <div 
                key={level.label}
                className={`p-3 rounded-xl text-center ${level.bgColor} border ${level.borderColor}
                  ${pmStatus.text === level.label ? 'ring-2 ring-offset-2' : ''}
                `}
                style={pmStatus.text === level.label ? { ringColor: level.color } : {}}
              >
                <p className="text-xs font-medium mb-1" style={{ color: level.color }}>{level.label}</p>
                <p className="text-xs text-slate-500">{level.range}</p>
              </div>
            ))}
          </div>
        </Card>

        {/* PM2.5 그래프 */}
        <Card className="p-5 mb-6">
          <h3 className="font-bold text-slate-800 mb-4">PM2.5 변화 (24시간)</h3>
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="pm25Grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8B5CF6" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#8B5CF6" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis dataKey="hour" stroke="#94A3B8" fontSize={10} tickLine={false} />
              <YAxis stroke="#94A3B8" fontSize={10} tickLine={false} />
              <Tooltip
                contentStyle={{ 
                  backgroundColor: 'white', 
                  border: '1px solid #E2E8F0', 
                  borderRadius: '12px',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                }}
              />
              <Area 
                type="monotone" 
                dataKey="pm25" 
                stroke="#8B5CF6" 
                strokeWidth={3}
                fill="url(#pm25Grad)"
                name="PM2.5 (㎍/㎥)"
                dot={false}
                activeDot={{ r: 6, fill: '#8B5CF6', strokeWidth: 2, stroke: 'white' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        {/* PM10 그래프 */}
        <Card className="p-5">
          <h3 className="font-bold text-slate-800 mb-4">PM10 변화 (24시간)</h3>
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="pm10Grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#EC4899" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#EC4899" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis dataKey="hour" stroke="#94A3B8" fontSize={10} tickLine={false} />
              <YAxis stroke="#94A3B8" fontSize={10} tickLine={false} />
              <Tooltip
                contentStyle={{ 
                  backgroundColor: 'white', 
                  border: '1px solid #E2E8F0', 
                  borderRadius: '12px',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                }}
              />
              <Area 
                type="monotone" 
                dataKey="pm10" 
                stroke="#EC4899" 
                strokeWidth={3}
                fill="url(#pm10Grad)"
                name="PM10 (㎍/㎥)"
                dot={false}
                activeDot={{ r: 6, fill: '#EC4899', strokeWidth: 2, stroke: 'white' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
      </main>
    </div>
  );
};

// =====================================================
// 소음 상세 페이지
// =====================================================
const NoiseDetail = ({ onBack }) => {
  const { noiseData, currentData } = useApiData();
  const [selectedPoint, setSelectedPoint] = useState(null);
  const [viewMode, setViewMode] = useState('all'); // all, original, cancelled, reduction
  
  const formatChartData = () => {
    if (!noiseData || noiseData.length === 0) {
      // 데모 데이터 생성
      return Array.from({ length: 60 }, (_, i) => {
        const original = 50 + Math.sin(i / 5) * 20 + Math.random() * 10;
        const cancelled = original * 0.4 + Math.random() * 5;
        return {
          time: `${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`,
          original: original,
          cancelled: cancelled,
          reduction: original - cancelled
        };
      });
    }
    
    return noiseData.map(d => ({
      time: new Date(d.recorded_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
      original: parseFloat(d.original_db) || 0,
      cancelled: parseFloat(d.cancelled_db) || 0,
      reduction: parseFloat(d.reduction_db) || 0
    }));
  };

  const chartData = formatChartData();
  const noise = currentData?.current_noise;
  const noiseCancelled = currentData?.current_noise_cancelled;
  const noiseLevel = getNoiseLevel(noise);
  const reduction = noise && noiseCancelled ? noise - noiseCancelled : 0;
  const reductionPercent = noise && noiseCancelled ? ((reduction / noise) * 100).toFixed(0) : 0;

  const avgOriginal = chartData.reduce((sum, d) => sum + d.original, 0) / chartData.length;
  const avgCancelled = chartData.reduce((sum, d) => sum + d.cancelled, 0) / chartData.length;
  const avgReduction = chartData.reduce((sum, d) => sum + d.reduction, 0) / chartData.length;

  const viewModes = [
    { id: 'all', label: '전체', color: '#64748B' },
    { id: 'original', label: '원본', color: '#F59E0B' },
    { id: 'cancelled', label: '상쇄 후', color: '#10B981' },
    { id: 'reduction', label: '감소량', color: '#8B5CF6' }
  ];

  const handleChartClick = (data) => {
    if (data && data.activePayload) {
      setSelectedPoint(data.activePayload[0]?.payload);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-teal-50">
      <Header 
        title="소음 분석" 
        subtitle="노이즈 캔슬링 효과"
        onBack={onBack}
      />
      
      <main className="max-w-2xl mx-auto px-4 py-6 pb-24">
        {/* 현재 상태 */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <Card className="p-4 text-center bg-gradient-to-br from-amber-50 to-orange-50">
            <Mic className="w-6 h-6 text-amber-500 mx-auto mb-2" />
            <p className="text-2xl font-bold text-slate-800">{noise?.toFixed(0) || '--'}</p>
            <p className="text-xs text-slate-400">원본 (dB)</p>
          </Card>
          
          <Card className="p-4 text-center bg-gradient-to-br from-emerald-50 to-teal-50">
            <VolumeX className="w-6 h-6 text-emerald-500 mx-auto mb-2" />
            <p className="text-2xl font-bold text-slate-800">{noiseCancelled?.toFixed(0) || '--'}</p>
            <p className="text-xs text-slate-400">상쇄 후 (dB)</p>
          </Card>
          
          <Card className="p-4 text-center bg-gradient-to-br from-violet-50 to-purple-50">
            <Shield className="w-6 h-6 text-violet-500 mx-auto mb-2" />
            <p className="text-2xl font-bold text-slate-800">{reductionPercent}%</p>
            <p className="text-xs text-slate-400">감소율</p>
          </Card>
        </div>

        {/* 노이즈 캔슬링 효과 시각화 */}
        <Card className="p-5 mb-6">
          <h3 className="font-bold text-slate-800 mb-4">노이즈 캔슬링 효과</h3>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-slate-600">원본 소음</span>
                <span className="font-medium text-amber-600">{noise?.toFixed(0) || '--'} dB</span>
              </div>
              <div className="h-4 bg-slate-100 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-amber-400 to-orange-500 rounded-full transition-all duration-1000"
                  style={{ width: `${Math.min((noise || 0), 100)}%` }}
                />
              </div>
            </div>
            
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-slate-600">상쇄 후 소음</span>
                <span className="font-medium text-emerald-600">{noiseCancelled?.toFixed(0) || '--'} dB</span>
              </div>
              <div className="h-4 bg-slate-100 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-emerald-400 to-teal-500 rounded-full transition-all duration-1000"
                  style={{ width: `${Math.min((noiseCancelled || 0), 100)}%` }}
                />
              </div>
            </div>
            
            <div className="p-4 bg-gradient-to-r from-violet-50 to-purple-50 rounded-2xl border border-violet-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center">
                    <Waves className="w-5 h-5 text-violet-600" />
                  </div>
                  <div>
                    <p className="font-medium text-violet-700">소음 감소량</p>
                    <p className="text-xs text-violet-500">진동자 노이즈 캔슬링</p>
                  </div>
                </div>
                <p className="text-2xl font-bold text-violet-600">-{reduction?.toFixed(0) || 0} dB</p>
              </div>
            </div>
          </div>
        </Card>

        {/* 뷰 모드 선택 */}
        <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
          {viewModes.map((mode) => (
            <button
              key={mode.id}
              onClick={() => setViewMode(mode.id)}
              className={`
                px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all
                ${viewMode === mode.id 
                  ? 'text-white shadow-lg' 
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                }
              `}
              style={viewMode === mode.id ? { backgroundColor: mode.color } : {}}
            >
              {mode.label}
            </button>
          ))}
        </div>

        {/* 선택된 포인트 상세 정보 */}
        {selectedPoint && (
          <Card className="p-4 mb-4 bg-gradient-to-r from-slate-50 to-slate-100 border-2 border-slate-200">
            <div className="flex justify-between items-center mb-3">
              <h4 className="font-bold text-slate-800">📍 {selectedPoint.time}</h4>
              <button 
                onClick={() => setSelectedPoint(null)}
                className="p-1 hover:bg-slate-200 rounded-lg transition-colors"
              >
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center p-2 bg-amber-50 rounded-xl">
                <p className="text-lg font-bold text-amber-600">{selectedPoint.original?.toFixed(1)}</p>
                <p className="text-xs text-slate-500">원본 dB</p>
              </div>
              <div className="text-center p-2 bg-emerald-50 rounded-xl">
                <p className="text-lg font-bold text-emerald-600">{selectedPoint.cancelled?.toFixed(1)}</p>
                <p className="text-xs text-slate-500">상쇄 후 dB</p>
              </div>
              <div className="text-center p-2 bg-violet-50 rounded-xl">
                <p className="text-lg font-bold text-violet-600">{selectedPoint.reduction?.toFixed(1)}</p>
                <p className="text-xs text-slate-500">감소량 dB</p>
              </div>
            </div>
          </Card>
        )}

        {/* 그래프 */}
        <Card className="p-5 mb-6">
          <h3 className="font-bold text-slate-800 mb-4">소음 변화 (최근 60분)</h3>
          <p className="text-xs text-slate-400 mb-4">그래프를 탭하면 상세 정보를 볼 수 있습니다</p>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData} onClick={handleChartClick}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis dataKey="time" stroke="#94A3B8" fontSize={10} tickLine={false} />
              <YAxis stroke="#94A3B8" fontSize={10} tickLine={false} />
              <Tooltip
                contentStyle={{ 
                  backgroundColor: 'white', 
                  border: '1px solid #E2E8F0', 
                  borderRadius: '12px',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                }}
              />
              <Legend />
              {(viewMode === 'all' || viewMode === 'original') && (
                <Line 
                  type="monotone" 
                  dataKey="original" 
                  stroke="#F59E0B" 
                  strokeWidth={viewMode === 'original' ? 3 : 2}
                  name="원본 (dB)"
                  dot={false}
                  activeDot={{ r: 6, fill: '#F59E0B', strokeWidth: 2, stroke: 'white' }}
                />
              )}
              {(viewMode === 'all' || viewMode === 'cancelled') && (
                <Line 
                  type="monotone" 
                  dataKey="cancelled" 
                  stroke="#10B981" 
                  strokeWidth={viewMode === 'cancelled' ? 3 : 2}
                  name="상쇄 후 (dB)"
                  dot={false}
                  activeDot={{ r: 6, fill: '#10B981', strokeWidth: 2, stroke: 'white' }}
                />
              )}
              {(viewMode === 'all' || viewMode === 'reduction') && (
                <Line 
                  type="monotone" 
                  dataKey="reduction" 
                  stroke="#8B5CF6" 
                  strokeWidth={viewMode === 'reduction' ? 3 : 2}
                  name="감소량 (dB)"
                  dot={false}
                  activeDot={{ r: 6, fill: '#8B5CF6', strokeWidth: 2, stroke: 'white' }}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </Card>

        {/* 평균 통계 */}
        <Card className="p-5">
          <h3 className="font-bold text-slate-800 mb-4">평균 통계 (60분)</h3>
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center p-3 bg-amber-50 rounded-xl">
              <BarChart3 className="w-5 h-5 text-amber-500 mx-auto mb-1" />
              <p className="text-lg font-bold text-slate-800">{avgOriginal.toFixed(1)}</p>
              <p className="text-xs text-slate-400">평균 원본</p>
            </div>
            <div className="text-center p-3 bg-emerald-50 rounded-xl">
              <BarChart3 className="w-5 h-5 text-emerald-500 mx-auto mb-1" />
              <p className="text-lg font-bold text-slate-800">{avgCancelled.toFixed(1)}</p>
              <p className="text-xs text-slate-400">평균 상쇄</p>
            </div>
            <div className="text-center p-3 bg-violet-50 rounded-xl">
              <BarChart3 className="w-5 h-5 text-violet-500 mx-auto mb-1" />
              <p className="text-lg font-bold text-slate-800">{avgReduction.toFixed(1)}</p>
              <p className="text-xs text-slate-400">평균 감소</p>
            </div>
          </div>
        </Card>
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
      
      {/* 글로벌 스타일 */}
      <style jsx global>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        .animate-fadeIn {
          animation: fadeIn 0.3s ease-out;
        }
        
        /* 커스텀 스크롤바 */
        ::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        
        ::-webkit-scrollbar-track {
          background: transparent;
        }
        
        ::-webkit-scrollbar-thumb {
          background: #CBD5E1;
          border-radius: 3px;
        }
        
        ::-webkit-scrollbar-thumb:hover {
          background: #94A3B8;
        }

        /* iOS 스타일 터치 효과 */
        * {
          -webkit-tap-highlight-color: transparent;
        }
        
        /* 부드러운 스크롤 */
        html {
          scroll-behavior: smooth;
        }
      `}</style>
    </DataProvider>
  );
};

export default App;
