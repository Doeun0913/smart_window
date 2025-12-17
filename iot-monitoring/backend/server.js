// =====================================================
// 🏠 Smart Home IoT Monitoring System - Backend Server
// =====================================================
// Node.js + Express + PostgreSQL + WebSocket

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const WebSocket = require('ws');
const http = require('http');
const axios = require('axios');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// =====================================================
// PostgreSQL 연결 설정
// =====================================================
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'iot_monitoring',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// 연결 테스트
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Database connection failed:', err.message);
  } else {
    console.log('✅ Database connected successfully');
    release();
  }
});

// =====================================================
// 미들웨어
// =====================================================
app.use(cors({
  origin: function (origin, callback) {
    // 모든 origin 허용 (개발 환경)
    // 프로덕션에서는 특정 도메인만 허용하도록 수정
    callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));
app.use(express.json());

// 요청 로깅
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// =====================================================
// WebSocket 관리
// =====================================================
const clients = new Map();
const MAX_CLIENTS = 100; // 최대 클라이언트 수 제한

// 주기적으로 죽은 연결 정리 (더 자주 정리)
setInterval(() => {
  let cleaned = 0;
  clients.forEach((client, clientId) => {
    if (client.ws.readyState !== WebSocket.OPEN) {
      try {
        client.ws.terminate();
      } catch (e) {
        // 무시
      }
      clients.delete(clientId);
      cleaned++;
    }
  });
  if (cleaned > 0) {
    console.log(`🧹 정리된 죽은 연결: ${cleaned}개 (현재: ${clients.size}개)`);
  }
}, 10000); // 10초마다 정리 (더 자주)

wss.on('connection', (ws, req) => {
  // 최대 클라이언트 수 체크
  if (clients.size >= MAX_CLIENTS) {
    console.warn(`⚠️ Maximum clients reached (${MAX_CLIENTS}), rejecting new connection`);
    ws.close(1008, 'Server at capacity');
    return;
  }

  const clientId = Date.now().toString(36) + Math.random().toString(36).substr(2);
  const connectionTime = Date.now();
  
  clients.set(clientId, { 
    ws, 
    subscribedDevices: ['raspberry-pi-01'],
    connectedAt: connectionTime
  });

  console.log(`🔌 WebSocket client connected: ${clientId} (Total: ${clients.size})`);

  // 핑/퐁을 통한 연결 상태 확인
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.ping();
      } catch (e) {
        clearInterval(pingInterval);
        clients.delete(clientId);
      }
    } else {
      clearInterval(pingInterval);
      clients.delete(clientId);
    }
  }, 30000); // 30초마다 핑

  ws.on('pong', () => {
    // 연결이 살아있음을 확인
  });

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'subscribe' && data.deviceId) {
        const client = clients.get(clientId);
        if (client && !client.subscribedDevices.includes(data.deviceId)) {
          client.subscribedDevices.push(data.deviceId);
        }
      }
    } catch (e) {
      console.error('WebSocket message error:', e);
    }
  });

  ws.on('close', (code, reason) => {
    clearInterval(pingInterval);
    clients.delete(clientId);
    console.log(`🔌 WebSocket client disconnected: ${clientId} (Code: ${code}, Total: ${clients.size})`);
  });

  ws.on('error', (error) => {
    clearInterval(pingInterval);
    console.error(`WebSocket error for client ${clientId}:`, error.message);
    clients.delete(clientId);
  });
});

// 브로드캐스트 함수
function broadcastToDeviceSubscribers(deviceId, data) {
  clients.forEach((client) => {
    if (client.ws.readyState === WebSocket.OPEN &&
      client.subscribedDevices.includes(deviceId)) {
      client.ws.send(JSON.stringify(data));
    }
  });
}

function broadcastToAll(data) {
  clients.forEach((client) => {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(data));
    }
  });
}

// =====================================================
// 공기질 API 설정 (에어코리아)
// =====================================================
const AIR_QUALITY_API_BASE = 'https://apis.data.go.kr/B552584/ArpltnInforInqireSvc';
const AIR_QUALITY_API_KEY = process.env.AIR_QUALITY_API_KEY || '924967322b617ed7448721386156955148026e23f5caa94534ce243630de4851';
const AIR_QUALITY_STATION_NAME = process.env.AIR_QUALITY_STATION_NAME || '종로구'; // 기본 측정소
const AIR_QUALITY_SIDO_NAME = process.env.AIR_QUALITY_SIDO_NAME || '서울'; // 기본 시도

// =====================================================
// 유틸리티 함수
// =====================================================
function calculateAQI(pm25) {
  if (pm25 <= 15) return { aqi: 50, status: '좋음' };
  if (pm25 <= 35) return { aqi: 100, status: '보통' };
  if (pm25 <= 75) return { aqi: 150, status: '나쁨' };
  return { aqi: 200, status: '매우나쁨' };
}

function handleError(res, error, message = 'Internal server error') {
  console.error(`❌ ${message}:`, error.message);
  res.status(500).json({ error: message, details: error.message });
}

// =====================================================
// 공기질 API 호출 함수
// =====================================================
async function fetchAirQualityFromAPI() {
  try {
    // 시도별 실시간 측정정보 조회 API 사용 (더 안정적)
    // serviceKey는 URL 인코딩 필요
    const url = `${AIR_QUALITY_API_BASE}/getCtprvnRltmMesureDnsty`;
    // serviceKey는 인코딩하지 않고 그대로 전달 (에어코리아 API 요구사항)
    const params = {
      serviceKey: AIR_QUALITY_API_KEY,
      returnType: 'json',
      numOfRows: 10,
      pageNo: 1,
      sidoName: encodeURIComponent(AIR_QUALITY_SIDO_NAME),
      ver: '1.0'
    };

    console.log(`🌬️  공기질 API 호출 중... (시도: ${AIR_QUALITY_SIDO_NAME})`);

    // URL 직접 구성 (에어코리아 API는 특정 형식 요구)
    const sidoNameEncoded = encodeURIComponent(AIR_QUALITY_SIDO_NAME);
    const fullUrl = `${url}?serviceKey=${AIR_QUALITY_API_KEY}&returnType=json&numOfRows=10&pageNo=1&sidoName=${sidoNameEncoded}&ver=1.0`;

    console.log(`📡 API 호출: ${url} (sidoName=${AIR_QUALITY_SIDO_NAME})`);

    const response = await axios.get(fullUrl, {
      timeout: 10000,
      headers: {
        'Accept': 'application/json'
      }
    });

    // 응답 구조 확인 및 디버깅
    if (!response.data || !response.data.response) {
      console.error('❌ API 응답 구조가 올바르지 않습니다:', JSON.stringify(response.data).substring(0, 500));
      return null;
    }

    const header = response.data.response.header;
    const body = response.data.response.body;

    // 헤더에서 결과 코드 확인
    if (header && header.resultCode && header.resultCode !== '00') {
      console.error(`❌ API 오류 코드: ${header.resultCode}, 메시지: ${header.resultMsg || '알 수 없음'}`);
      console.error('📋 전체 응답:', JSON.stringify(response.data).substring(0, 1000));
      return null;
    }

    // body가 없거나 items가 없으면 오류
    if (!body) {
      console.error('❌ API 응답에 body가 없습니다');
      console.error('📋 전체 응답:', JSON.stringify(response.data).substring(0, 1000));
      return null;
    }

    console.log(`📊 응답 데이터: totalCount=${body.totalCount}, items 개수=${body.items ? body.items.length : 0}`);

    if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
      console.warn('⚠️  API 응답에 데이터가 없습니다. totalCount:', body.totalCount);
      console.warn('📋 응답 샘플:', JSON.stringify(body).substring(0, 500));
      return null;
    }

    // 첫 번째 측정소 데이터 사용 (또는 stationName과 일치하는 것 찾기)
    let item = body.items[0];

    // 측정소 이름이 지정되어 있으면 해당 측정소 찾기
    if (AIR_QUALITY_STATION_NAME) {
      const matchedItem = body.items.find(i =>
        i.stationName && i.stationName.includes(AIR_QUALITY_STATION_NAME)
      );
      if (matchedItem) {
        item = matchedItem;
      }
    }

    // PM2.5와 PM10 값 추출
    // API 응답 필드명이 다양할 수 있으므로 여러 가능성 체크
    let pm25 = null;
    let pm10 = null;

    // PM2.5 값 찾기
    if (item.pm25Value !== undefined && item.pm25Value !== null && item.pm25Value !== '') {
      pm25 = parseFloat(item.pm25Value);
    } else if (item.pm25 !== undefined && item.pm25 !== null && item.pm25 !== '') {
      pm25 = parseFloat(item.pm25);
    }

    // PM10 값 찾기
    if (item.pm10Value !== undefined && item.pm10Value !== null && item.pm10Value !== '') {
      pm10 = parseFloat(item.pm10Value);
    } else if (item.pm10 !== undefined && item.pm10 !== null && item.pm10 !== '') {
      pm10 = parseFloat(item.pm10);
    }

    // 값이 유효한지 확인 (NaN 체크)
    if (isNaN(pm25) || isNaN(pm10)) {
      console.warn('⚠️  PM2.5 또는 PM10 값이 유효하지 않습니다:', { pm25, pm10, item });
      return null;
    }

    if (pm25 !== null && pm10 !== null && pm25 >= 0 && pm10 >= 0) {
      // AQI 계산
      const { aqi, status } = calculateAQI(pm25);

      return {
        pm25,
        pm10,
        aqi,
        status,
        stationName: item.stationName || AIR_QUALITY_STATION_NAME || '알 수 없음',
        dataTime: item.dataTime || new Date().toISOString()
      };
    } else {
      console.warn('⚠️  PM2.5 또는 PM10 값이 없거나 음수입니다:', { pm25, pm10 });
      return null;
    }
  } catch (error) {
    console.error('❌ 공기질 API 호출 실패:', error.message);
    if (error.response) {
      console.error('API 응답 상태:', error.response.status);
      console.error('API 응답 데이터:', JSON.stringify(error.response.data).substring(0, 500));
    }
    return null;
  }
}

// 공기질 데이터를 DB에 저장하는 함수
async function saveAirQualityToDB(deviceId = 'raspberry-pi-01') {
  try {
    const airQualityData = await fetchAirQualityFromAPI();

    if (!airQualityData) {
      console.log('⚠️  공기질 데이터를 가져올 수 없습니다');
      return false;
    }

    const { pm25, pm10, aqi, status } = airQualityData;

    const query = `
      INSERT INTO air_quality (device_id, pm25, pm10, aqi, status)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
    const result = await pool.query(query, [deviceId, pm25, pm10, aqi, status]);

    // 디바이스 last_seen 업데이트
    await pool.query(`
      UPDATE devices SET last_seen = NOW(), updated_at = NOW()
      WHERE id = $1
    `, [deviceId]);

    // 실시간 브로드캐스트
    broadcastToDeviceSubscribers(deviceId, {
      type: 'sensor_update',
      sensor: 'air_quality',
      device_id: deviceId,
      data: result.rows[0]
    });

    console.log(`✅ 공기질 데이터 저장 완료: PM2.5=${pm25}, PM10=${pm10}, 상태=${status}`);
    return true;
  } catch (error) {
    console.error('❌ 공기질 데이터 저장 실패:', error.message);
    return false;
  }
}

// =====================================================
// 공기질 데이터 자동 갱신 스케줄러
// =====================================================
let airQualityInterval = null;

function startAirQualityScheduler(intervalMinutes = 30) {
  // 즉시 한 번 실행
  saveAirQualityToDB();

  // 주기적으로 실행 (기본 30분마다)
  airQualityInterval = setInterval(() => {
    saveAirQualityToDB();
  }, intervalMinutes * 60 * 1000);

  console.log(`🔄 공기질 데이터 자동 갱신 시작 (${intervalMinutes}분마다)`);
}

function stopAirQualityScheduler() {
  if (airQualityInterval) {
    clearInterval(airQualityInterval);
    airQualityInterval = null;
    console.log('⏹️  공기질 데이터 자동 갱신 중지');
  }
}

// =====================================================
// API 라우트 - 디바이스 관리
// =====================================================
app.get('/api/devices', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, location, device_type, is_active, last_seen, created_at
      FROM devices
      ORDER BY created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    handleError(res, error, 'Error fetching devices');
  }
});

app.post('/api/devices', async (req, res) => {
  try {
    const { id, name, location, device_type } = req.body;
    const result = await pool.query(`
      INSERT INTO devices (id, name, location, device_type)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [id, name, location, device_type || 'raspberry-pi']);
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    handleError(res, error, 'Error creating device');
  }
});

// =====================================================
// API 라우트 - 현재 센서 상태
// =====================================================
app.get('/api/current', async (req, res) => {
  try {
    const deviceId = req.query.device_id || 'raspberry-pi-01';
    const result = await pool.query(`
      SELECT * FROM current_sensor_status WHERE device_id = $1
    `, [deviceId]);

    if (result.rows.length === 0) {
      // 데이터가 없으면 기본값 반환
      res.json({
        device_id: deviceId,
        current_temperature: null,
        current_humidity: null,
        current_noise: null,
        current_noise_cancelled: null,
        current_pm25: null,
        current_pm10: null,
        current_aqi: null,
        air_status: null,
        pldc_state: false
      });
    } else {
      res.json(result.rows[0]);
    }
  } catch (error) {
    handleError(res, error, 'Error fetching current status');
  }
});

// 모든 디바이스의 현재 상태
app.get('/api/current/all', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM current_sensor_status');
    res.json(result.rows);
  } catch (error) {
    handleError(res, error, 'Error fetching all device status');
  }
});

// =====================================================
// API 라우트 - 온습도 데이터
// =====================================================
app.get('/api/temperature-humidity', async (req, res) => {
  try {
    const { hours = 24, device_id = 'raspberry-pi-01' } = req.query;
    const query = `
      SELECT 
        DATE_TRUNC('hour', recorded_at) as hour,
        ROUND(AVG(temperature)::numeric, 2) as temperature,
        ROUND(AVG(humidity)::numeric, 2) as humidity,
        ROUND(MIN(temperature)::numeric, 2) as min_temp,
        ROUND(MAX(temperature)::numeric, 2) as max_temp,
        COUNT(*) as samples
      FROM temperature_humidity
      WHERE device_id = $1 
        AND recorded_at >= NOW() - ($2 || ' hours')::INTERVAL
      GROUP BY DATE_TRUNC('hour', recorded_at)
      ORDER BY hour ASC
    `;
    const result = await pool.query(query, [device_id, hours]);
    res.json(result.rows);
  } catch (error) {
    handleError(res, error, 'Error fetching temperature/humidity data');
  }
});

// 최신 온습도 데이터 (실시간용)
app.get('/api/temperature-humidity/latest', async (req, res) => {
  try {
    const { device_id = 'raspberry-pi-01', limit = 100 } = req.query;
    const query = `
      SELECT id, temperature, humidity, recorded_at
      FROM temperature_humidity
      WHERE device_id = $1
      ORDER BY recorded_at DESC
      LIMIT $2
    `;
    const result = await pool.query(query, [device_id, limit]);
    res.json(result.rows.reverse());
  } catch (error) {
    handleError(res, error, 'Error fetching latest temperature data');
  }
});

// =====================================================
// API 라우트 - 소음 데이터
// =====================================================
app.get('/api/noise', async (req, res) => {
  try {
    const { minutes = 60, device_id = 'raspberry-pi-01' } = req.query;
    const query = `
      SELECT 
        id,
        ROUND(original_db::numeric, 2) as original_db,
        ROUND(cancelled_db::numeric, 2) as cancelled_db,
        ROUND(reduction_db::numeric, 2) as reduction_db,
        recorded_at
      FROM noise_levels
      WHERE device_id = $1 
        AND recorded_at >= NOW() - ($2 || ' minutes')::INTERVAL
      ORDER BY recorded_at ASC
    `;
    const result = await pool.query(query, [device_id, minutes]);
    res.json(result.rows);
  } catch (error) {
    handleError(res, error, 'Error fetching noise data');
  }
});

// 소음 통계
app.get('/api/noise/stats', async (req, res) => {
  try {
    const { hours = 24, device_id = 'raspberry-pi-01' } = req.query;
    const query = `
      SELECT 
        ROUND(AVG(original_db)::numeric, 2) as avg_original,
        ROUND(AVG(cancelled_db)::numeric, 2) as avg_cancelled,
        ROUND(AVG(reduction_db)::numeric, 2) as avg_reduction,
        ROUND(MAX(original_db)::numeric, 2) as max_original,
        ROUND(MIN(original_db)::numeric, 2) as min_original,
        ROUND(MAX(cancelled_db)::numeric, 2) as max_cancelled,
        ROUND(MIN(cancelled_db)::numeric, 2) as min_cancelled,
        COUNT(*) as sample_count
      FROM noise_levels
      WHERE device_id = $1 
        AND recorded_at >= NOW() - ($2 || ' hours')::INTERVAL
    `;
    const result = await pool.query(query, [device_id, hours]);
    res.json(result.rows[0]);
  } catch (error) {
    handleError(res, error, 'Error fetching noise stats');
  }
});

// ANC 성공률 조회 (실시간 캐시)
app.get('/api/noise/success-rate', async (req, res) => {
  try {
    const { device_id = 'raspberry-pi-01' } = req.query;

    const cachedRate = global.ancSuccessRates?.[device_id];

    if (cachedRate) {
      res.json({
        success_rate: cachedRate.success_rate,
        updated_at: cachedRate.updated_at,
        device_id
      });
    } else {
      // 캐시가 없으면 DB에서 최근 성공률 계산 (reduction_db > 0인 비율)
      const query = `
        SELECT 
          COUNT(*) FILTER (WHERE reduction_db >= 1.0) as success_count,
          COUNT(*) as total_count
        FROM noise_levels
        WHERE device_id = $1 
          AND recorded_at >= NOW() - INTERVAL '1 hour'
      `;
      const result = await pool.query(query, [device_id]);
      const { success_count, total_count } = result.rows[0];
      const calculatedRate = total_count > 0 ? (success_count / total_count * 100) : 0;

      res.json({
        success_rate: parseFloat(calculatedRate.toFixed(1)),
        updated_at: new Date().toISOString(),
        device_id,
        source: 'calculated'
      });
    }
  } catch (error) {
    handleError(res, error, 'Error fetching success rate');
  }
});

// =====================================================
// API 라우트 - 미세먼지 데이터
// =====================================================
app.get('/api/air-quality', async (req, res) => {
  try {
    const { hours = 24, device_id = 'raspberry-pi-01' } = req.query;
    const query = `
      SELECT 
        DATE_TRUNC('hour', recorded_at) as hour,
        ROUND(AVG(pm25)::numeric, 2) as pm25,
        ROUND(AVG(pm10)::numeric, 2) as pm10,
        MAX(aqi) as aqi,
        MAX(status) as status
      FROM air_quality
      WHERE device_id = $1 
        AND recorded_at >= NOW() - ($2 || ' hours')::INTERVAL
      GROUP BY DATE_TRUNC('hour', recorded_at)
      ORDER BY hour ASC
    `;
    const result = await pool.query(query, [device_id, hours]);
    res.json(result.rows);
  } catch (error) {
    handleError(res, error, 'Error fetching air quality data');
  }
});

// 미세먼지 통계
app.get('/api/air-quality/stats', async (req, res) => {
  try {
    const { hours = 24, device_id = 'raspberry-pi-01' } = req.query;
    const query = `
      SELECT 
        ROUND(AVG(pm25)::numeric, 2) as avg_pm25,
        ROUND(AVG(pm10)::numeric, 2) as avg_pm10,
        ROUND(MAX(pm25)::numeric, 2) as max_pm25,
        ROUND(MIN(pm25)::numeric, 2) as min_pm25,
        COUNT(*) as sample_count
      FROM air_quality
      WHERE device_id = $1 
        AND recorded_at >= NOW() - ($2 || ' hours')::INTERVAL
    `;
    const result = await pool.query(query, [device_id, hours]);
    res.json(result.rows[0]);
  } catch (error) {
    handleError(res, error, 'Error fetching air quality stats');
  }
});

// =====================================================
// API 라우트 - PLDC 제어
// =====================================================
app.get('/api/pldc/status', async (req, res) => {
  try {
    const { device_id = 'raspberry-pi-01' } = req.query;
    const query = `
      SELECT state, changed_by, changed_at 
      FROM pldc_control_log 
      WHERE device_id = $1
      ORDER BY changed_at DESC 
      LIMIT 1
    `;
    const result = await pool.query(query, [device_id]);
    res.json({
      state: result.rows[0]?.state || false,
      changed_by: result.rows[0]?.changed_by || null,
      changed_at: result.rows[0]?.changed_at || null
    });
  } catch (error) {
    handleError(res, error, 'Error fetching PLDC status');
  }
});

app.post('/api/pldc/control', async (req, res) => {
  try {
    const { state, device_id = 'raspberry-pi-01', changed_by = 'web-app' } = req.body;

    if (typeof state !== 'boolean') {
      return res.status(400).json({ error: 'state must be a boolean' });
    }

    const query = `
      INSERT INTO pldc_control_log (device_id, state, changed_by)
      VALUES ($1, $2, $3)
      RETURNING *
    `;
    const result = await pool.query(query, [device_id, state, changed_by]);

    // WebSocket으로 상태 변경 브로드캐스트
    broadcastToDeviceSubscribers(device_id, {
      type: 'pldc_update',
      device_id,
      state,
      changed_by,
      changed_at: result.rows[0].changed_at
    });

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    handleError(res, error, 'Error controlling PLDC');
  }
});

// PLDC 히스토리
app.get('/api/pldc/history', async (req, res) => {
  try {
    const { device_id = 'raspberry-pi-01', limit = 50 } = req.query;
    const query = `
      SELECT id, state, changed_by, changed_at
      FROM pldc_control_log
      WHERE device_id = $1
      ORDER BY changed_at DESC
      LIMIT $2
    `;
    const result = await pool.query(query, [device_id, limit]);
    res.json(result.rows);
  } catch (error) {
    handleError(res, error, 'Error fetching PLDC history');
  }
});

// =====================================================
// API 라우트 - ANC 시스템 제어
// =====================================================

// ANC 상태를 메모리에 저장
if (!global.ancState) {
  global.ancState = {
    running: false,
    pid: null,
    started_at: null,
    success_rate: null
  };
}

// ANC 상태 조회
app.get('/api/anc/status', async (req, res) => {
  try {
    // 실제 프로세스 확인
    const { exec } = require('child_process');
    exec('pgrep -f "anc_elite.py"', (error, stdout) => {
      const isRunning = !error && stdout.trim().length > 0;
      const pid = isRunning ? stdout.trim().split('\n')[0] : null;

      global.ancState.running = isRunning;
      global.ancState.pid = pid;

      res.json({
        running: isRunning,
        pid: pid,
        started_at: global.ancState.started_at,
        success_rate: global.ancSuccessRates?.['raspberry-pi-01']?.success_rate || null
      });
    });
  } catch (error) {
    handleError(res, error, 'Error fetching ANC status');
  }
});

// ANC 시스템 시작/정지
app.post('/api/anc/control', async (req, res) => {
  try {
    const { action } = req.body; // 'start' or 'stop'
    const { spawn, exec } = require('child_process');
    const path = require('path');

    if (action === 'start') {
      // 이미 실행중인지 확인
      exec('pgrep -f "anc_elite.py"', (error, stdout) => {
        if (!error && stdout.trim()) {
          return res.json({
            success: false,
            message: 'ANC 시스템이 이미 실행 중입니다',
            running: true
          });
        }

        // ANC 시작
        const ancPath = path.join(__dirname, '..', 'anc_system');
        const venvPython = path.join(ancPath, 'venv', 'bin', 'python');
        const ancScript = path.join(ancPath, 'anc_elite.py');

        // Python 실행 (venv 사용)
        const child = spawn(venvPython, [ancScript, '200'], {
          cwd: ancPath,
          detached: true,
          stdio: 'ignore'
        });

        child.unref();

        global.ancState = {
          running: true,
          pid: child.pid,
          started_at: new Date().toISOString(),
          success_rate: null
        };

        // 브로드캐스트
        broadcastToAll({
          type: 'anc_update',
          running: true,
          pid: child.pid
        });

        res.json({
          success: true,
          message: 'ANC 시스템이 시작되었습니다',
          running: true,
          pid: child.pid
        });
      });

    } else if (action === 'stop') {
      exec('pkill -f "anc_elite.py"', (error) => {
        global.ancState = {
          running: false,
          pid: null,
          started_at: null,
          success_rate: null
        };

        // 브로드캐스트
        broadcastToAll({
          type: 'anc_update',
          running: false,
          pid: null
        });

        res.json({
          success: true,
          message: 'ANC 시스템이 정지되었습니다',
          running: false
        });
      });

    } else {
      res.status(400).json({ error: 'action must be "start" or "stop"' });
    }
  } catch (error) {
    handleError(res, error, 'Error controlling ANC');
  }
});

// =====================================================
// API 라우트 - 알림
// =====================================================
app.get('/api/alerts', async (req, res) => {
  try {
    const { device_id, resolved, severity, limit = 50 } = req.query;

    let query = `
      SELECT * FROM alert_events
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (device_id) {
      query += ` AND device_id = $${paramIndex++}`;
      params.push(device_id);
    }

    if (resolved === 'false') {
      query += ` AND resolved_at IS NULL`;
    } else if (resolved === 'true') {
      query += ` AND resolved_at IS NOT NULL`;
    }

    if (severity) {
      query += ` AND severity = $${paramIndex++}`;
      params.push(severity);
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
    params.push(limit);

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    handleError(res, error, 'Error fetching alerts');
  }
});

// 알림 해결
app.post('/api/alerts/:id/resolve', async (req, res) => {
  try {
    const { id } = req.params;
    const { resolved_by = 'web-app' } = req.body;

    const query = `
      UPDATE alert_events 
      SET resolved_at = NOW(), resolved_by = $2
      WHERE id = $1 AND resolved_at IS NULL
      RETURNING *
    `;
    const result = await pool.query(query, [id, resolved_by]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Alert not found or already resolved' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    handleError(res, error, 'Error resolving alert');
  }
});

// =====================================================
// API 라우트 - 센서 데이터 수신 (라즈베리파이에서 호출)
// =====================================================
app.post('/api/sensor/temperature-humidity', async (req, res) => {
  try {
    const { temperature, humidity, device_id = 'raspberry-pi-01' } = req.body;

    if (temperature === undefined || humidity === undefined) {
      return res.status(400).json({ error: 'temperature and humidity are required' });
    }

    const query = `
      INSERT INTO temperature_humidity (device_id, temperature, humidity)
      VALUES ($1, $2, $3)
      RETURNING *
    `;
    const result = await pool.query(query, [device_id, temperature, humidity]);

    // 디바이스 last_seen 업데이트
    await pool.query(`
      UPDATE devices SET last_seen = NOW(), updated_at = NOW()
      WHERE id = $1
    `, [device_id]);

    // 실시간 브로드캐스트
    broadcastToDeviceSubscribers(device_id, {
      type: 'sensor_update',
      sensor: 'temperature_humidity',
      device_id,
      data: result.rows[0]
    });

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    handleError(res, error, 'Error saving temperature/humidity');
  }
});

app.post('/api/sensor/noise', async (req, res) => {
  try {
    const { original_db, cancelled_db, success_rate, device_id = 'raspberry-pi-01' } = req.body;

    if (original_db === undefined || cancelled_db === undefined) {
      return res.status(400).json({ error: 'original_db and cancelled_db are required' });
    }

    const query = `
      INSERT INTO noise_levels (device_id, original_db, cancelled_db)
      VALUES ($1, $2, $3)
      RETURNING *
    `;
    const result = await pool.query(query, [device_id, original_db, cancelled_db]);

    // 디바이스 last_seen 업데이트
    await pool.query(`
      UPDATE devices SET last_seen = NOW(), updated_at = NOW()
      WHERE id = $1
    `, [device_id]);

    // 성공률을 메모리에 캐시 (최신값만 유지)
    if (!global.ancSuccessRates) {
      global.ancSuccessRates = {};
    }
    if (success_rate !== undefined) {
      global.ancSuccessRates[device_id] = {
        success_rate: success_rate,
        updated_at: new Date().toISOString()
      };
    }

    // 실시간 브로드캐스트 (성공률 포함)
    broadcastToDeviceSubscribers(device_id, {
      type: 'sensor_update',
      sensor: 'noise',
      device_id,
      data: {
        ...result.rows[0],
        success_rate: success_rate || null
      }
    });

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    handleError(res, error, 'Error saving noise data');
  }
});

app.post('/api/sensor/air-quality', async (req, res) => {
  try {
    const { pm25, pm10, device_id = 'raspberry-pi-01' } = req.body;

    if (pm25 === undefined || pm10 === undefined) {
      return res.status(400).json({ error: 'pm25 and pm10 are required' });
    }

    // AQI 계산
    const { aqi, status } = calculateAQI(pm25);

    const query = `
      INSERT INTO air_quality (device_id, pm25, pm10, aqi, status)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
    const result = await pool.query(query, [device_id, pm25, pm10, aqi, status]);

    // 디바이스 last_seen 업데이트
    await pool.query(`
      UPDATE devices SET last_seen = NOW(), updated_at = NOW()
      WHERE id = $1
    `, [device_id]);

    // 실시간 브로드캐스트
    broadcastToDeviceSubscribers(device_id, {
      type: 'sensor_update',
      sensor: 'air_quality',
      device_id,
      data: result.rows[0]
    });

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    handleError(res, error, 'Error saving air quality data');
  }
});

// 공기질 API에서 데이터 가져와서 저장 (수동 갱신)
app.post('/api/air-quality/refresh', async (req, res) => {
  try {
    const { device_id = 'raspberry-pi-01' } = req.body;
    const success = await saveAirQualityToDB(device_id);

    if (success) {
      res.json({ success: true, message: '공기질 데이터가 갱신되었습니다' });
    } else {
      res.status(500).json({ success: false, error: '공기질 데이터를 가져오는데 실패했습니다' });
    }
  } catch (error) {
    handleError(res, error, 'Error refreshing air quality data');
  }
});

// 공기질 API 상태 확인
app.get('/api/air-quality/api-status', async (req, res) => {
  try {
    const airQualityData = await fetchAirQualityFromAPI();

    if (airQualityData) {
      res.json({
        success: true,
        connected: true,
        data: airQualityData,
        message: '공기질 API 연결 정상'
      });
    } else {
      res.status(503).json({
        success: false,
        connected: false,
        message: '공기질 API에서 데이터를 가져올 수 없습니다'
      });
    }
  } catch (error) {
    handleError(res, error, 'Error checking air quality API status');
  }
});

// =====================================================
// API 라우트 - 통계 및 리포트
// =====================================================
app.get('/api/stats/daily', async (req, res) => {
  try {
    const { device_id = 'raspberry-pi-01' } = req.query;
    const result = await pool.query('SELECT * FROM get_daily_stats($1)', [device_id]);
    res.json(result.rows[0]);
  } catch (error) {
    handleError(res, error, 'Error fetching daily stats');
  }
});

app.get('/api/stats/hourly', async (req, res) => {
  try {
    const { device_id = 'raspberry-pi-01' } = req.query;
    const result = await pool.query(`
      SELECT * FROM hourly_averages WHERE device_id = $1
    `, [device_id]);
    res.json(result.rows);
  } catch (error) {
    handleError(res, error, 'Error fetching hourly stats');
  }
});

// =====================================================
// 헬스체크
// =====================================================
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: 'connected',
      websocket_clients: clients.size
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      database: 'disconnected',
      error: error.message
    });
  }
});

// 루트 경로에서 간단한 상태 문자열 반환 (예전 스타일)
app.get('/', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.type('text/plain').send('healthy');
  } catch (error) {
    res.status(503).type('text/plain').send('unhealthy');
  }
});

// =====================================================
// 404 핸들러
// =====================================================
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// =====================================================
// 서버 시작
// =====================================================
const PORT = process.env.PORT || 3001;
const AIR_QUALITY_UPDATE_INTERVAL = parseInt(process.env.AIR_QUALITY_UPDATE_INTERVAL) || 30; // 기본 30분

server.listen(PORT, () => {
  console.log('═══════════════════════════════════════════');
  console.log('🏠 Smart Home IoT Monitoring Server');
  console.log('═══════════════════════════════════════════');
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 WebSocket server ready`);
  console.log(`📊 API base URL: http://localhost:${PORT}/api`);
  console.log(`🌬️  공기질 API: ${AIR_QUALITY_STATION_NAME} (${AIR_QUALITY_SIDO_NAME})`);
  console.log(`🔄 공기질 자동 갱신: ${AIR_QUALITY_UPDATE_INTERVAL}분마다`);
  console.log('═══════════════════════════════════════════');

  // 공기질 데이터 자동 갱신 스케줄러 시작
  startAirQualityScheduler(AIR_QUALITY_UPDATE_INTERVAL);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  stopAirQualityScheduler();
  wss.close();
  await pool.end();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received. Shutting down gracefully...');
  stopAirQualityScheduler();
  wss.close();
  await pool.end();
  process.exit(0);
});
