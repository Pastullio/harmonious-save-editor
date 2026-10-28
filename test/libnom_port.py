# Literal Python port of libNOM.io's Steam meta encrypt/decrypt (PlatformSteam_Read.cs / _Write.cs),
# used as an independent oracle for the JS codec.
import struct, sys

M = 0xFFFFFFFF
KEY_TAIL = list(struct.unpack('<4I', b'NAESEVADNAYRTNRG'))

def rotl(x, n): return ((x << n) | (x >> (32 - n))) & M

def key(slot):
    return [((rotl((slot ^ 0x1422CB8C) & M, 13) * 5) + 0xE6546B64) & M, KEY_TAIL[1], KEY_TAIL[2], KEY_TAIL[3]]

def decrypt(words, slot, iterations):
    k = key(slot); r = list(words); last = len(r) - 1
    h = 0
    for _ in range(iterations): h = (h + 0x9E3779B9) & M
    for _ in range(iterations):
        cur = r[0]; ki = (h >> 2) & 3; vi = last
        j = last
        while j > 0:
            a = r[vi - 1]
            r[vi] = (r[vi] - (((((cur >> 3) ^ ((a << 4) & M)) + (((cur * 4) & M) ^ (a >> 5))) & M) ^ (((a ^ k[(j & 3) ^ ki]) + (cur ^ h)) & M))) & M
            cur = r[vi]; j -= 1; vi -= 1
        vi = last; a = r[vi]
        r[0] = (r[0] - (((((cur >> 3) ^ ((a << 4) & M)) + (((cur * 4) & M) ^ (a >> 5))) & M) ^ (((a ^ k[ki]) + (cur ^ h)) & M))) & M
        h = (h + 0x61C88647) & M
    return r

def encrypt(words, slot, iterations):
    k = key(slot); r = list(words); last = len(r) - 1
    cur = 0; h = 0
    for _ in range(iterations):
        h = (h + 0x9E3779B9) & M
        ki = (h >> 2) & 3
        for j in range(last):
            b = r[j + 1]
            r[j] = (r[j] + (((((b >> 3) ^ ((cur << 4) & M)) + (((b * 4) & M) ^ (cur >> 5))) & M) ^ (((cur ^ k[(j & 3) ^ ki]) + (b ^ h)) & M))) & M
            cur = r[j]
        b = r[0]
        r[last] = (r[last] + (((((b >> 3) ^ ((cur << 4) & M)) + (((b * 4) & M) ^ (cur >> 5))) & M) ^ (((cur ^ k[(last & 3) ^ ki]) + (b ^ h)) & M))) & M
        cur = r[last]
    return r

if __name__ == '__main__':
    mode, slot, it, path_in, path_out = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4], sys.argv[5]
    data = open(path_in, 'rb').read()
    w = list(struct.unpack('<%dI' % (len(data) // 4), data))
    out = (decrypt if mode == 'd' else encrypt)(w, slot, it)
    open(path_out, 'wb').write(struct.pack('<%dI' % len(out), *out))
