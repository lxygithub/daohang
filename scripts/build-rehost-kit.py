# 打包本地上传套件 → /home/z/my-project/download/rehost-local-kit-<date>.zip
# 内容：上传脚本 + 说明 + 数据文件（清单/进度/去重索引/源映射）+ 预下载图标（仅待转存引用的）
import os, json, zipfile, sys

SRC = '/home/z/my-project/daohang/scripts'
DATA = os.path.join(SRC, 'data')
ICONS_SRC = os.path.join(DATA, 'prefetch-icons')
DATE = sys.argv[1] if len(sys.argv) > 1 else '20260916'
OUT = f'/home/z/my-project/download/rehost-local-kit-{DATE}.zip'

os.makedirs('/home/z/my-project/download', exist_ok=True)

# 1. 组装文件清单
map_file = os.path.join(DATA, 'prefetch-src-map.json')
src_map = json.load(open(map_file, encoding='utf8'))
referenced = {f"{v['h']}.{v['e']}" for v in src_map.values() if isinstance(v, dict) and 'h' in v}
print(f'src-map 引用图标文件 {len(referenced)} 个')

data_files = ['builtin-sites.json', 'prefetch-src-map.json', 'icon-hash-index.json', 'rehost-state.jsonl']
entries = [
    (os.path.join(SRC, 'rehost-local.mjs'), f'rehost-local/rehost-local.mjs'),
    (os.path.join(SRC, 'rehost-local-README.md'), f'rehost-local/README.md'),
]
for f in data_files:
    fp = os.path.join(DATA, f)
    if not os.path.exists(fp):
        sys.exit(f'缺少数据文件: {fp}')
    entries.append((fp, f'rehost-local/data/{f}'))

missing, icon_bytes = 0, 0
icon_names = sorted(os.listdir(ICONS_SRC)) if os.path.isdir(ICONS_SRC) else []
for name in icon_names:
    if name not in referenced:
        continue
    fp = os.path.join(ICONS_SRC, name)
    if not os.path.isfile(fp):
        missing += 1
        continue
    icon_bytes += os.path.getsize(fp)
    entries.append((fp, f'rehost-local/icons/{name}'))
print(f'待打包：脚本/数据 {len(entries) - len(icon_names) and len([e for e in entries if "/icons/" not in e[1]])} 个 + 图标 {len(entries)} 总计')

# 2. 压缩
if os.path.exists(OUT):
    os.remove(OUT)
with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for fp, arc in entries:
        z.write(fp, arc)

size = os.path.getsize(OUT)
with zipfile.ZipFile(OUT) as z:
    n = len(z.namelist())
    bad = z.testzip()
print(f'完成：{OUT}')
print(f'文件数 {n}｜原始图标字节 {icon_bytes/1024/1024:.1f}MB｜压缩包 {size/1024/1024:.1f}MB｜缺失 {missing}｜完整性 {"异常:"+str(bad) if bad else "OK"}')
