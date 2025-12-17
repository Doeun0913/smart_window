-- =====================================================
-- 🏠 Smart Home IoT Monitoring System - Database Schema
-- =====================================================
-- PostgreSQL 14+ 호환
-- 실제 센서 데이터를 저장하기 위한 프로덕션 스키마

-- 기존 테이블 삭제 (개발 환경용)
DROP TABLE IF EXISTS alert_events CASCADE;
DROP TABLE IF EXISTS pldc_control_log CASCADE;
DROP TABLE IF EXISTS air_quality CASCADE;
DROP TABLE IF EXISTS noise_levels CASCADE;
DROP TABLE IF EXISTS temperature_humidity CASCADE;
DROP TABLE IF EXISTS devices CASCADE;
DROP VIEW IF EXISTS current_sensor_status CASCADE;
DROP VIEW IF EXISTS hourly_averages CASCADE;

-- =====================================================
-- 디바이스 관리 테이블
-- =====================================================
CREATE TABLE devices (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    location VARCHAR(100),
    device_type VARCHAR(50) DEFAULT 'raspberry-pi',
    is_active BOOLEAN DEFAULT true,
    last_seen TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 기본 디바이스 등록
INSERT INTO devices (id, name, location) VALUES 
    ('raspberry-pi-01', '거실 센서', '거실'),
    ('raspberry-pi-02', '침실 센서', '침실');

-- =====================================================
-- 온습도 센서 데이터 테이블
-- =====================================================
CREATE TABLE temperature_humidity (
    id BIGSERIAL PRIMARY KEY,
    device_id VARCHAR(50) NOT NULL REFERENCES devices(id),
    temperature DECIMAL(5,2) NOT NULL CHECK (temperature >= -50 AND temperature <= 100),
    humidity DECIMAL(5,2) NOT NULL CHECK (humidity >= 0 AND humidity <= 100),
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 파티셔닝을 위한 인덱스
CREATE INDEX idx_temp_humidity_device_time ON temperature_humidity(device_id, recorded_at DESC);
CREATE INDEX idx_temp_humidity_recorded_at ON temperature_humidity(recorded_at DESC);

-- =====================================================
-- 소음 센서 데이터 테이블 (1분 단위 저장)
-- =====================================================
CREATE TABLE noise_levels (
    id BIGSERIAL PRIMARY KEY,
    device_id VARCHAR(50) NOT NULL REFERENCES devices(id),
    original_db DECIMAL(5,2) NOT NULL CHECK (original_db >= 0 AND original_db <= 200),
    cancelled_db DECIMAL(5,2) NOT NULL CHECK (cancelled_db >= 0 AND cancelled_db <= 200),
    reduction_db DECIMAL(5,2) GENERATED ALWAYS AS (original_db - cancelled_db) STORED,
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_noise_device_time ON noise_levels(device_id, recorded_at DESC);
CREATE INDEX idx_noise_recorded_at ON noise_levels(recorded_at DESC);

-- =====================================================
-- 미세먼지 센서 데이터 테이블
-- =====================================================
CREATE TABLE air_quality (
    id BIGSERIAL PRIMARY KEY,
    device_id VARCHAR(50) NOT NULL REFERENCES devices(id),
    pm25 DECIMAL(6,2) NOT NULL CHECK (pm25 >= 0),
    pm10 DECIMAL(6,2) NOT NULL CHECK (pm10 >= 0),
    aqi INTEGER,
    status VARCHAR(20),
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_air_quality_device_time ON air_quality(device_id, recorded_at DESC);
CREATE INDEX idx_air_quality_recorded_at ON air_quality(recorded_at DESC);

-- =====================================================
-- PLDC 제어 로그 테이블
-- =====================================================
CREATE TABLE pldc_control_log (
    id BIGSERIAL PRIMARY KEY,
    device_id VARCHAR(50) NOT NULL REFERENCES devices(id),
    state BOOLEAN NOT NULL,
    changed_by VARCHAR(50),
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_pldc_device_time ON pldc_control_log(device_id, changed_at DESC);
CREATE INDEX idx_pldc_changed_at ON pldc_control_log(changed_at DESC);

-- 초기 PLDC 상태 (OFF)
INSERT INTO pldc_control_log (device_id, state, changed_by) VALUES 
    ('raspberry-pi-01', false, 'system');

-- =====================================================
-- 알림 이벤트 테이블
-- =====================================================
CREATE TABLE alert_events (
    id BIGSERIAL PRIMARY KEY,
    device_id VARCHAR(50) NOT NULL REFERENCES devices(id),
    alert_type VARCHAR(50) NOT NULL,
    sensor_type VARCHAR(50) NOT NULL,
    value DECIMAL(10,2),
    threshold DECIMAL(10,2),
    message TEXT,
    severity VARCHAR(20) CHECK (severity IN ('info', 'warning', 'critical')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolved_by VARCHAR(50)
);

CREATE INDEX idx_alerts_device_time ON alert_events(device_id, created_at DESC);
CREATE INDEX idx_alerts_unresolved ON alert_events(resolved_at) WHERE resolved_at IS NULL;
CREATE INDEX idx_alerts_severity ON alert_events(severity, created_at DESC);

-- =====================================================
-- 뷰: 현재 센서 상태 (최신 데이터)
-- =====================================================
CREATE OR REPLACE VIEW current_sensor_status AS
SELECT 
    d.id as device_id,
    d.name as device_name,
    d.location,
    th.temperature as current_temperature,
    th.humidity as current_humidity,
    th.recorded_at as temp_updated_at,
    nl.original_db as current_noise,
    nl.cancelled_db as current_noise_cancelled,
    nl.recorded_at as noise_updated_at,
    aq.pm25 as current_pm25,
    aq.pm10 as current_pm10,
    aq.aqi as current_aqi,
    aq.status as air_status,
    aq.recorded_at as air_updated_at,
    pl.state as pldc_state,
    pl.changed_at as pldc_updated_at
FROM devices d
LEFT JOIN LATERAL (
    SELECT temperature, humidity, recorded_at 
    FROM temperature_humidity 
    WHERE device_id = d.id 
    ORDER BY recorded_at DESC LIMIT 1
) th ON true
LEFT JOIN LATERAL (
    SELECT original_db, cancelled_db, recorded_at 
    FROM noise_levels 
    WHERE device_id = d.id 
    ORDER BY recorded_at DESC LIMIT 1
) nl ON true
LEFT JOIN LATERAL (
    SELECT pm25, pm10, aqi, status, recorded_at 
    FROM air_quality 
    WHERE device_id = d.id 
    ORDER BY recorded_at DESC LIMIT 1
) aq ON true
LEFT JOIN LATERAL (
    SELECT state, changed_at 
    FROM pldc_control_log 
    WHERE device_id = d.id 
    ORDER BY changed_at DESC LIMIT 1
) pl ON true
WHERE d.is_active = true;

-- =====================================================
-- 뷰: 시간별 평균 데이터 (24시간)
-- =====================================================
CREATE OR REPLACE VIEW hourly_averages AS
SELECT 
    DATE_TRUNC('hour', recorded_at) as hour,
    device_id,
    ROUND(AVG(temperature)::numeric, 2) as avg_temperature,
    ROUND(AVG(humidity)::numeric, 2) as avg_humidity,
    ROUND(MIN(temperature)::numeric, 2) as min_temperature,
    ROUND(MAX(temperature)::numeric, 2) as max_temperature,
    COUNT(*) as sample_count
FROM temperature_humidity
WHERE recorded_at >= NOW() - INTERVAL '24 hours'
GROUP BY DATE_TRUNC('hour', recorded_at), device_id
ORDER BY hour DESC;

-- =====================================================
-- 함수: AQI 계산
-- =====================================================
CREATE OR REPLACE FUNCTION calculate_aqi(pm25_value DECIMAL)
RETURNS TABLE(aqi INTEGER, status VARCHAR(20)) AS $$
BEGIN
    IF pm25_value <= 15 THEN
        RETURN QUERY SELECT 50, '좋음'::VARCHAR(20);
    ELSIF pm25_value <= 35 THEN
        RETURN QUERY SELECT 100, '보통'::VARCHAR(20);
    ELSIF pm25_value <= 75 THEN
        RETURN QUERY SELECT 150, '나쁨'::VARCHAR(20);
    ELSE
        RETURN QUERY SELECT 200, '매우나쁨'::VARCHAR(20);
    END IF;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 함수: 센서 데이터 삽입 시 알림 생성
-- =====================================================
CREATE OR REPLACE FUNCTION check_sensor_thresholds()
RETURNS TRIGGER AS $$
DECLARE
    alert_msg TEXT;
    alert_sev VARCHAR(20);
BEGIN
    -- 온습도 임계값 체크
    IF TG_TABLE_NAME = 'temperature_humidity' THEN
        IF NEW.temperature > 30 THEN
            INSERT INTO alert_events (device_id, alert_type, sensor_type, value, threshold, message, severity)
            VALUES (NEW.device_id, 'HIGH_TEMPERATURE', 'temperature', NEW.temperature, 30, 
                    '온도가 30°C를 초과했습니다: ' || NEW.temperature || '°C', 'warning');
        ELSIF NEW.temperature < 15 THEN
            INSERT INTO alert_events (device_id, alert_type, sensor_type, value, threshold, message, severity)
            VALUES (NEW.device_id, 'LOW_TEMPERATURE', 'temperature', NEW.temperature, 15, 
                    '온도가 15°C 미만입니다: ' || NEW.temperature || '°C', 'warning');
        END IF;
        
        IF NEW.humidity > 80 THEN
            INSERT INTO alert_events (device_id, alert_type, sensor_type, value, threshold, message, severity)
            VALUES (NEW.device_id, 'HIGH_HUMIDITY', 'humidity', NEW.humidity, 80, 
                    '습도가 80%를 초과했습니다: ' || NEW.humidity || '%', 'warning');
        END IF;
    END IF;
    
    -- 미세먼지 임계값 체크
    IF TG_TABLE_NAME = 'air_quality' THEN
        IF NEW.pm25 > 75 THEN
            INSERT INTO alert_events (device_id, alert_type, sensor_type, value, threshold, message, severity)
            VALUES (NEW.device_id, 'HIGH_PM25', 'air_quality', NEW.pm25, 75, 
                    'PM2.5가 매우 나쁨 수준입니다: ' || NEW.pm25 || ' ㎍/㎥', 'critical');
        ELSIF NEW.pm25 > 35 THEN
            INSERT INTO alert_events (device_id, alert_type, sensor_type, value, threshold, message, severity)
            VALUES (NEW.device_id, 'MODERATE_PM25', 'air_quality', NEW.pm25, 35, 
                    'PM2.5가 나쁨 수준입니다: ' || NEW.pm25 || ' ㎍/㎥', 'warning');
        END IF;
    END IF;
    
    -- 소음 임계값 체크
    IF TG_TABLE_NAME = 'noise_levels' THEN
        IF NEW.original_db > 80 THEN
            INSERT INTO alert_events (device_id, alert_type, sensor_type, value, threshold, message, severity)
            VALUES (NEW.device_id, 'HIGH_NOISE', 'noise', NEW.original_db, 80, 
                    '소음이 80dB을 초과했습니다: ' || NEW.original_db || ' dB', 'warning');
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 트리거 생성
CREATE TRIGGER trg_temp_humidity_alert
    AFTER INSERT ON temperature_humidity
    FOR EACH ROW EXECUTE FUNCTION check_sensor_thresholds();

CREATE TRIGGER trg_air_quality_alert
    AFTER INSERT ON air_quality
    FOR EACH ROW EXECUTE FUNCTION check_sensor_thresholds();

CREATE TRIGGER trg_noise_alert
    AFTER INSERT ON noise_levels
    FOR EACH ROW EXECUTE FUNCTION check_sensor_thresholds();

-- =====================================================
-- 데이터 정리 함수 (오래된 데이터 삭제)
-- =====================================================
CREATE OR REPLACE FUNCTION cleanup_old_data(days_to_keep INTEGER DEFAULT 30)
RETURNS TABLE(
    temp_deleted BIGINT,
    noise_deleted BIGINT,
    air_deleted BIGINT,
    alerts_deleted BIGINT
) AS $$
DECLARE
    cutoff_date TIMESTAMP WITH TIME ZONE;
BEGIN
    cutoff_date := NOW() - (days_to_keep || ' days')::INTERVAL;
    
    WITH deleted_temp AS (
        DELETE FROM temperature_humidity WHERE recorded_at < cutoff_date RETURNING 1
    ),
    deleted_noise AS (
        DELETE FROM noise_levels WHERE recorded_at < cutoff_date RETURNING 1
    ),
    deleted_air AS (
        DELETE FROM air_quality WHERE recorded_at < cutoff_date RETURNING 1
    ),
    deleted_alerts AS (
        DELETE FROM alert_events WHERE created_at < cutoff_date AND resolved_at IS NOT NULL RETURNING 1
    )
    SELECT 
        (SELECT COUNT(*) FROM deleted_temp),
        (SELECT COUNT(*) FROM deleted_noise),
        (SELECT COUNT(*) FROM deleted_air),
        (SELECT COUNT(*) FROM deleted_alerts)
    INTO temp_deleted, noise_deleted, air_deleted, alerts_deleted;
    
    RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 통계 함수
-- =====================================================
CREATE OR REPLACE FUNCTION get_daily_stats(target_device_id VARCHAR DEFAULT 'raspberry-pi-01')
RETURNS TABLE(
    avg_temp DECIMAL,
    min_temp DECIMAL,
    max_temp DECIMAL,
    avg_humidity DECIMAL,
    avg_pm25 DECIMAL,
    avg_noise DECIMAL,
    avg_noise_reduction DECIMAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ROUND(AVG(th.temperature)::numeric, 2),
        ROUND(MIN(th.temperature)::numeric, 2),
        ROUND(MAX(th.temperature)::numeric, 2),
        ROUND(AVG(th.humidity)::numeric, 2),
        ROUND(AVG(aq.pm25)::numeric, 2),
        ROUND(AVG(nl.original_db)::numeric, 2),
        ROUND(AVG(nl.reduction_db)::numeric, 2)
    FROM temperature_humidity th
    FULL OUTER JOIN air_quality aq ON th.device_id = aq.device_id 
        AND DATE_TRUNC('hour', th.recorded_at) = DATE_TRUNC('hour', aq.recorded_at)
    FULL OUTER JOIN noise_levels nl ON th.device_id = nl.device_id 
        AND DATE_TRUNC('hour', th.recorded_at) = DATE_TRUNC('hour', nl.recorded_at)
    WHERE th.device_id = target_device_id
        AND th.recorded_at >= NOW() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 권한 설정 (프로덕션 환경)
-- =====================================================
-- GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO iot_app;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO iot_app;
-- GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO iot_app;

COMMENT ON TABLE devices IS '센서 디바이스 관리 테이블';
COMMENT ON TABLE temperature_humidity IS '온습도 센서 데이터';
COMMENT ON TABLE noise_levels IS '소음 센서 데이터 (노이즈 캔슬링 포함)';
COMMENT ON TABLE air_quality IS '미세먼지 센서 데이터';
COMMENT ON TABLE pldc_control_log IS 'PLDC 조명 제어 로그';
COMMENT ON TABLE alert_events IS '센서 알림 이벤트';
