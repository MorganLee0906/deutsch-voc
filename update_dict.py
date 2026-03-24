import os
import json


def update_vocab_list():
    voc_dir = 'voc'
    files = [f for f in os.listdir(voc_dir) if f.endswith('.txt')]

    # 建立清單格式
    vocab_list = []
    for f in files:
        # 將檔名轉為易讀的名字，例如 Unit_Family.txt -> Family
        display_name = f.replace('.txt', '').replace('Unit_', '')
        vocab_list.append({
            "name": display_name,
            "file": f
        })

    # 寫入 json
    with open(os.path.join(voc_dir, 'list.json'), 'w', encoding='utf-8') as jf:
        json.dump(vocab_list, jf, ensure_ascii=False, indent=2)

    print(f"成功更新！共找到 {len(files)} 個單字本。")


if __name__ == "__main__":
    update_vocab_list()
