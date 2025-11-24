import time

def is_hand_open(finger_states):
    open_count = sum(finger_states)
    return open_count >= 4

test_cases = {
    "모두 펴짐": [1, 1, 1, 1, 1],
    "모두 접힘": [0, 0, 0, 0, 0],
    "검지만 펴짐": [0, 1, 0, 0, 0],
    "4개 펴짐": [1, 1, 1, 1, 0],
}

print("\n=== 키보드 입력 시뮬레이션 ===")
print("손 상태 입력: o=펴기, c=쥐기, q=종료")

while True:
    key = input("입력: ").lower()
    if key == 'q':
        print("종료합니다.")
        break
    elif key == 'o':
        print("손 펼침 → LED ON (시뮬레이션)")
    elif key == 'c':
        print("손 쥠 → LED OFF (시뮬레이션)")
    else:
        print("잘못된 입력입니다. o/c/q 중 하나 입력")