import board
import adafruit_bme280

# I2C 통신 설정 (보드에 따라 자동으로 설정됨)
i2c = board.I2C()

try:
    bme280 = adafruit_bme280.Adafruit_BME280_I2C(i2c, address=0x77)
except ValueError:
    try:
        bme280 = adafruit_bme280.Adafruit_BME280_I2C(i2c, address=0x76)
    except ValueError:
        print("BME280 센서를 I2C 주소 0x77 또는 0x76에서 찾을 수 없습니다.")
        print("연결을 확인하거나 'sudo i2cdetect -y 1' 명령어로 주소를 확인하세요.")
        exit()

print("BME280 센서가 성공적으로 연결되었습니다.\n")

while True:
    try:
        print("******************\n\n\n")

        # 센서 값 읽기
        temperature = bme280.temperature
        humidity = bme280.humidity
        pressure = bme280.pressure
        
        print(f"온도: {temperature:.2f} °C")
        print(f"습도: {humidity:.2f} %")
        print(f"기압: {pressure:.2f} hPa")
        print("Ctrl+C를 눌러 종료합니다.")

    except RuntimeError as error:
        # 가끔 센서 읽기에 실패할 수 있습니다.
        print(error.args[0])
    except KeyboardInterrupt:
        break