# Makes the same small archive twice, as the Mac (LZ4) and the PC (zstd) pack it, from extracted game files (never
# committed), for TestMacAndPCPaks: python3 test/make_test_paks.py <folder of extracted .mbin files> <out folder>
# then HSE_TEST_PAKS=<out folder> go test -run TestMacAndPCPaks. Needs: pip install hgpaktool lz4 zstandard
import os, sys, shutil, hashlib, json
from hgpaktool import HGPAKFile
src=sys.argv[1]; base=sys.argv[2]; root=base+'/src'
shutil.rmtree(root, ignore_errors=True); os.makedirs(root)
names=[]
for d,_,fs in os.walk(src):
    for f in fs:
        if not f.endswith('.mbin'): continue
        rel=os.path.relpath(os.path.join(d,f),src).replace(os.sep,'/')
        if True:
            os.makedirs(os.path.dirname(os.path.join(root,rel)),exist_ok=True); shutil.copy(os.path.join(d,f),os.path.join(root,rel)); names.append(rel)
os.makedirs(root+'/textures',exist_ok=True)
open(root+'/textures/noise.dds','wb').write(os.urandom(400000)); names.append('textures/noise.dds')   # won't pack: stored chunks
open(root+'/textures/zeros.dds','wb').write(bytes(300000)); names.append('textures/zeros.dds')
# a made-up table with a layout stamp DryDock doesn't know, as after a game update (test_report.js)
fake='metadata/reality/tables/frigatetraittable.mbin'
if fake not in names:
    os.makedirs(os.path.dirname(root+'/'+fake),exist_ok=True)
    open(root+'/'+fake,'wb').write(bytes([0xCC]*8)+bytes.fromhex('e40c0000')+bytes(4)+bytes.fromhex('1122334455667788')+bytes(0x200)); names.append(fake)
names.sort()
man=root+'/nmsarc.test.pak.manifest'  # hgpaktool names the pak from this
open(man,'w',newline='').write(''.join(n+'\r\n' for n in names))
sums={n:hashlib.sha1(open(os.path.join(root,n),'rb').read()).hexdigest() for n in names}
for plat,out in (('mac',base+'/MACOSBANKS'),('windows',base+'/PCBANKS')):
    os.makedirs(out,exist_ok=True)
    HGPAKFile.repack(man, out+'/NMSARC.Test.pak', True, plat)
    print(plat, os.path.getsize(out+'/NMSARC.Test.pak'))
json.dump(sums,open(base+'/sums.json','w')); print(len(names))
