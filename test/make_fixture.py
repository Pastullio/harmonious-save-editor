# Builds a synthetic Steam save (save3.hg + mf_save3.hg) the way the game/libNOM would,
# using python-lz4 for compression and the literal libNOM port for meta encryption.
import json, struct, sys, random, lz4.block, os
sys.path.insert(0, os.path.dirname(__file__))
import libnom_port

out_dir = sys.argv[1]
hashed = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'vendor', 'libnom', 'hashed_technology.bin'), 'rb').read().split(b'\0')
random.seed(7)

def slot(i, typ, ident, amt, mx):
    return '{"Vn8":{"elv":"%s"},"b2n":"%s","1o9":%d,"F9q":%d,"eVk":0.0,"b76":true,"3ZH":{">Qh":%d,"XJ>":%d}}' % (typ, ident, amt, mx, i % 10, i // 10)

def inv(n, w, h):
    s = ','.join(slot(i, random.choice(['Product', 'Substance', 'Technology']), random.choice(['^FUEL1', '^LAND1', '^ANTIMATTER', '^SHIPJUMP1']), random.randint(1, 9999), 9999) for i in range(n))
    valid = ','.join('{">Qh":%d,"XJ>":%d}' % (i % 10, i // 10) for i in range(w * h))
    return '{":No":[%s],"hl?":[%s],"=Tb":%d,"N9>":%d,"B@N":{"1o6":"S"},"NKm":"","@bB":[]}' % (s, valid, w, h)

# a raw (non-UTF-8) hashed technology id, exactly as the game writes it
raw_tech = b'^' + hashed[3] + b'#'

parts = []
parts.append(b'{"F2P":4720,"8>q":"Win|Final","XTp":"Main","<h0":{"Pk4":"Harmonious Caf\xc3\xa9 \xe2\x98\x85","Lg8":123456},')
parts.append(b'"vLc":{"6f=":{"wGS":4294967295,"7QL":12345,"kN;":678,"Float":1.0,"Neg":-0.5,"Exp":1e-05,"Big":18446744073709551615,')
parts.append(b'"Esc":"a\\/b \\u00e9 \\"q\\" tab\\\tend","Ctl":"line\\nnext",')
parts.append(b'"623":"numeric key","100":1,"2":2,')
parts.append(b';l5:' if False else b'";l5":' + inv(48, 10, 6).encode() + b',')
parts.append(b'"PMT":{":No":[{"Vn8":{"elv":"Technology"},"b2n":"' + raw_tech + b'","1o9":100,"F9q":100,"eVk":0.0,"b76":true,"3ZH":{">Qh":0,"XJ>":0}}],"hl?":[],"=Tb":10,"N9>":6},')
parts.append(b'"@Cs":[' + b','.join(b'{"NKm":"Ship %d","NTx":{"93M":"MODELS/COMMON/SPACECRAFT/FIGHTERS/FIGHTER_PROC.SCENE.MBIN","@EL":[true,"0x%016X"]},";l5":' % (k, random.getrandbits(64)) + inv(30, 10, 5).encode() + b'}' for k in range(12)) + b'],')
# bulk filler so the file spans several 512 KiB chunks
parts.append(b'"Filler":[' + b','.join(b'{"K7E":"%d","f5Q":"0x%08X","wMC":[%f,%f,%f]}' % (i, random.getrandbits(32), random.random(), random.random() * 1000, -random.random()) for i in range(40000)) + b']')
parts.append(b'}},"2YS":{"6f=":{"wGS":5}}}')
plain = b''.join(parts) + b'\0'
open(os.path.join(out_dir, 'plain.bin'), 'wb').write(plain)

# data file: 512 KiB chunks, LZ4 block (python-lz4 = reference LZ4)
data = b''
for p in range(0, len(plain), 0x80000):
    src = plain[p:p + 0x80000]
    c = lz4.block.compress(src, store_size=False)
    data += bytes([0xE5, 0xA1, 0xED, 0xFE]) + struct.pack('<III', len(c), len(src), 0) + c
open(os.path.join(out_dir, 'save3.hg'), 'wb').write(data)

# meta file: Worlds Part II layout (432 bytes)
meta = bytearray(432)
struct.pack_into('<II', meta, 0, 0xEEEEEEBE, 0x7D4)
struct.pack_into('<II', meta, 56, len(plain), len(data))
struct.pack_into('<I', meta, 68, 4720)
struct.pack_into('<HHQ', meta, 72, 6, 0, 123456)
name = 'Harmonious Café ★'.encode(); meta[88:88 + len(name)] = name
summ = b'On freighter in Euclid'; meta[216:216 + len(summ)] = summ
struct.pack_into('<I', meta, 344, 6)
struct.pack_into('<Q', meta, 348, 0x1122334455667788)  # slot identifier (opaque)
struct.pack_into('<II', meta, 356, 1761000000, 0x7D4)
meta[364:428] = bytes(random.getrandbits(8) for _ in range(64))  # difficulty tag (opaque)
# last word stays 0 (libNOM's encrypt assumes this)
words = list(struct.unpack('<108I', bytes(meta)))
enc = libnom_port.encrypt(words, 4, 6)  # save3.hg -> PlayerState3 = slot 4
open(os.path.join(out_dir, 'mf_save3.hg'), 'wb').write(struct.pack('<108I', *enc))
open(os.path.join(out_dir, 'meta_plain.bin'), 'wb').write(bytes(meta))
print('plain', len(plain), 'data', len(data), 'chunks', (len(plain) + 0x7FFFF) // 0x80000)
