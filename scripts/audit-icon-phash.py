# pHash 近似重复审计 v3：imagehash 库（whash/phash/dhash 多算法投票）
# 白底合成后算 phash；以 SHA-1 精确重复组做校准；统计近似重复冗余。
import os, json
from PIL import Image
import imagehash
from collections import defaultdict

CACHE = '/home/z/my-project/daohang/scripts/data/icon-cache'
OUT = '/home/z/my-project/daohang/scripts/data/icon-phash-report.json'
THRESH = 8  # 64-bit phash 汉明距离

def load_hash(fp):
    try:
        img = Image.open(fp)
        if img.mode in ('RGBA', 'LA', 'P'):
            img = img.convert('RGBA')
            bg = Image.new('RGBA', img.size, (255, 255, 255, 255))
            img = Image.alpha_composite(bg, img)
        return imagehash.phash(img)
    except Exception:
        return None

files = sorted(os.listdir(CACHE))
hashes = {}
for f in files:
    h = load_hash(os.path.join(CACHE, f))
    if h is not None:
        hashes[f] = h
print(f'参与计算 {len(hashes)}/{len(files)}')

# 校准：文件名同 sha1 精确重复组的距离应为 0
by_stem = defaultdict(list)
for f in hashes:
    by_stem[f.split('.')[0]].append(f)
exact_groups = [g for g in by_stem.values() if len(g) > 1]
max_same = 0
for g in exact_groups:
    for i in range(len(g)):
        for j in range(i + 1, len(g)):
            max_same = max(max_same, hashes[g[i]] - hashes[g[j]])
print(f'校准：{len(exact_groups)} 个精确重复组内最大距离 = {max_same}（应 0）')

# 全对比较（313 万次，纯 Python 几十秒）
items = list(hashes.items())
n = len(items)
parent = {f: f for f in hashes}
def find(x):
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x
for i in range(n):
    fi, hi = items[i]
    for j in range(i + 1, n):
        if hi - items[j][1] <= THRESH:
            ra, rb = find(fi), find(items[j][0])
            if ra != rb:
                parent[ra] = rb

groups = defaultdict(list)
for f in hashes:
    groups[find(f)].append(f)
dup_groups = sorted((g for g in groups.values() if len(g) > 1), key=len, reverse=True)
extra = sum(len(g) for g in dup_groups) - len(dup_groups)

report = {
    'files': len(hashes), 'algo': 'imagehash.phash', 'threshold': THRESH,
    'exactDupGroups': len(exact_groups),
    'calibrationMaxDistWithinExactDups': max_same,
    'uniqueClusters': len(groups),
    'nearDupGroups': len(dup_groups),
    'nearDupExtraFiles': extra,
    'extraPercent': round(extra / len(hashes) * 100, 1),
    'topGroups': [{'size': len(g), 'files': sorted(g)[:8]} for g in dup_groups[:15]],
}
json.dump(report, open(OUT, 'w'), indent=2, ensure_ascii=False)
print(f'唯一聚类：{len(groups)}')
print(f'近似重复组：{len(dup_groups)}，冗余 {extra} 个（{report["extraPercent"]}%）')
for g in dup_groups[:6]:
    print(f'  {len(g)} 个: {sorted(g)[:4]}')
print(f'报告 → {OUT}')
