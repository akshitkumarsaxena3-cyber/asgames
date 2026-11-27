import os, sys, io, struct, hashlib, zlib, datetime, base64
import zipfile
from PIL import Image, ImageDraw, ImageFont
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives.serialization import pkcs7

base_dir = os.path.dirname(os.path.abspath(__file__))
old_apk_path = os.path.join(base_dir, 'downloads', 'BDGWin_v2.4.0.apk')
apk_path = os.path.join(base_dir, 'downloads', 'ASGames_v2.4.0.apk')
assets_dir = os.path.join(base_dir, 'assets')

source_apk = apk_path if os.path.exists(apk_path) else old_apk_path

print('1. Generating high-resolution AS GAMES Gold Casino Icons...')
def make_icon(size):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    pad = max(2, int(size * 0.04))
    corner = int(size * 0.22)
    
    # Outer luxury background
    draw.rounded_rectangle([pad, pad, size - pad, size - pad], radius=corner, fill=(18, 18, 36, 255), outline=(245, 196, 67, 255), width=max(2, size // 50))
    # Inner gold border
    in_pad = pad + max(2, size // 36)
    draw.rounded_rectangle([in_pad, in_pad, size - in_pad, size - in_pad], radius=int(corner * 0.85), outline=(255, 170, 0, 160), width=max(1, size // 100))
    
    # Draw Crown
    cw, ch = size // 2, int(size * 0.20)
    cr_w = int(size * 0.16)
    cr_h = int(size * 0.08)
    crown_poly = [
        (cw - cr_w, ch + cr_h),
        (cw - int(cr_w * 1.2), ch - cr_h),
        (cw - int(cr_w * 0.45), ch),
        (cw, ch - int(cr_h * 1.3)),
        (cw + int(cr_w * 0.45), ch),
        (cw + int(cr_w * 1.2), ch - cr_h),
        (cw + cr_w, ch + cr_h)
    ]
    draw.polygon(crown_poly, fill=(245, 196, 67, 255), outline=(255, 235, 120, 255))
    draw.circle((cw, ch - int(cr_h * 1.35)), max(2, size // 80), fill=(239, 68, 68, 255))
    draw.circle((cw - int(cr_w * 1.2), ch - cr_h), max(1, size // 100), fill=(239, 68, 68, 255))
    draw.circle((cw + int(cr_w * 1.2), ch - cr_h), max(1, size // 100), fill=(239, 68, 68, 255))

    # Text AS
    try:
        f_main = ImageFont.truetype('arialbd.ttf', int(size * 0.30))
        f_sub = ImageFont.truetype('arialbd.ttf', int(size * 0.125))
        f_tag = ImageFont.truetype('arialbd.ttf', int(size * 0.065))
    except:
        f_main = f_sub = f_tag = ImageFont.load_default()

    t1 = 'AS'
    y1 = int(size * 0.42)
    draw.text((cw + max(1, size//120), y1 + max(1, size//120)), t1, font=f_main, fill=(0, 0, 0, 220), anchor='mm')
    draw.text((cw, y1), t1, font=f_main, fill=(255, 215, 0, 255), anchor='mm')

    # Badge GAMES
    t2 = 'GAMES'
    bw, bh = int(size * 0.62), int(size * 0.17)
    bx = (size - bw) // 2
    by = int(size * 0.58)
    draw.rounded_rectangle([bx, by, bx + bw, by + bh], radius=bh // 2, fill=(217, 38, 38, 255), outline=(245, 196, 67, 255), width=max(1, size // 100))
    draw.text((cw, by + bh // 2), t2, font=f_sub, fill=(255, 255, 255, 255), anchor='mm')

    # Subtext (if size >= 96)
    if size >= 96:
        draw.text((cw, int(size * 0.84)), 'VIP CASINO', font=f_tag, fill=(245, 196, 67, 230), anchor='mm')

    buf = io.BytesIO()
    img.save(buf, format='PNG')
    return buf.getvalue()

icon_192 = make_icon(192)
icon_144 = make_icon(144)
icon_96 = make_icon(96)
icon_72 = make_icon(72)
icon_48 = make_icon(48)
icon_512 = make_icon(512)

# Save to assets/icon-*.png
with open(os.path.join(assets_dir, 'icon-192.png'), 'wb') as f: f.write(icon_192)
with open(os.path.join(assets_dir, 'icon-512.png'), 'wb') as f: f.write(icon_512)
with open(os.path.join(assets_dir, 'icon-maskable.png'), 'wb') as f: f.write(icon_512)
print('Assets icons updated to AS GAMES!')

print('2. Reading base APK and modifying resources...')
with zipfile.ZipFile(source_apk, 'r') as z_in:
    entries = {}
    for item in z_in.infolist():
        if item.filename.startswith('META-INF/') and any(item.filename.endswith(ext) for ext in ['.MF', '.SF', '.RSA', '.DSA', '.EC']):
            continue
        entries[item.filename] = z_in.read(item.filename)

# 2a. Patch classes.dex
dex = bytearray(entries['classes.dex'])
new_url = b'https://asgame.ascollab.in/?v=1'
replaced_url = False
for old_url in [b'https://github.com/bishwassagar', b'https://asgames.onrender.com/#/']:
    pos = dex.find(old_url)
    if pos != -1:
        assert len(old_url) == len(new_url), 'URL length must match exactly'
        dex[pos:pos+len(new_url)] = new_url
        sha1 = hashlib.sha1(dex[32:]).digest()
        dex[12:32] = sha1
        adler = zlib.adler32(dex[12:]) & 0xffffffff
        dex[8:12] = adler.to_bytes(4, 'little')
        entries['classes.dex'] = bytes(dex)
        print('classes.dex URL patched to:', new_url.decode())
        replaced_url = True
        break
if not replaced_url and new_url in dex:
    print('classes.dex already points to:', new_url.decode())

# 2b. Patch resources.arsc
arsc = bytearray(entries['resources.arsc'])
new_name = b'AS Games - VIP'
replaced = False
for old_name in [b'My Application', b'BDG Win Casino']:
    pos = arsc.find(old_name)
    if pos != -1:
        assert len(old_name) == len(new_name), 'Name length must match exactly'
        arsc[pos:pos+len(new_name)] = new_name
        entries['resources.arsc'] = bytes(arsc)
        print('resources.arsc App Name patched to:', new_name.decode())
        replaced = True
        break
if not replaced and new_name in arsc:
    print('resources.arsc already has App Name:', new_name.decode())

# 2c. Replace icons
for n in ['res/Gc.png', 'res/o-.png']:
    if n in entries: entries[n] = icon_192
for n in ['res/fO.png', 'res/RJ.png']:
    if n in entries: entries[n] = icon_144
for n in ['res/wb.png', 'res/Gf.png', 'res/FS.png', 'res/kp.png', 'res/nf.png']:
    if n in entries: entries[n] = icon_96
for n in ['res/8c.png', 'res/Pb.png', 'res/yn.png']:
    if n in entries: entries[n] = icon_72
for n in ['res/6t.png', 'res/zR.png', 'res/7i.png', 'res/9w.png', 'res/KM.png', 'res/RV.png', 'res/Wh.png', 'res/dY.png']:
    if n in entries: entries[n] = icon_48
print('All icon drawables replaced with AS GAMES Gold Icons!')

# 2d. Update assets/offline.html
offline_html = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>AS Games - Official Gaming App</title>
    <style>
        * { margin:0; padding:0; box-sizing:border-box; }
        body {
            background: linear-gradient(180deg, #0d0d1e 0%, #16162c 50%, #0a0a14 100%);
            color: #ffffff;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 24px;
            text-align: center;
        }
        .logo-box {
            width: 100px;
            height: 100px;
            border-radius: 22px;
            background: linear-gradient(135deg, #1f1f3a, #101020);
            border: 3px solid #f5c443;
            box-shadow: 0 0 25px rgba(245, 196, 67, 0.4);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            margin-bottom: 20px;
        }
        .crown { font-size: 28px; line-height: 1; }
        .logo-text { font-size: 20px; font-weight: 900; color: #ffd700; letter-spacing: 1px; }
        .logo-sub { font-size: 10px; font-weight: 800; background: #d92626; color: #fff; padding: 2px 8px; border-radius: 8px; margin-top: 2px; }
        h1 { font-size: 20px; font-weight: 800; color: #fae59f; margin-bottom: 8px; }
        p { font-size: 13.5px; color: #cbd5e1; line-height: 1.5; max-width: 320px; margin-bottom: 22px; }
        .btn-reload {
            display: inline-block;
            background: linear-gradient(135deg, #f5c443, #d99b1c);
            color: #1a1a2e;
            font-size: 15px;
            font-weight: 800;
            padding: 13px 32px;
            border-radius: 28px;
            border: none;
            cursor: pointer;
            text-decoration: none;
            box-shadow: 0 6px 20px rgba(245, 196, 67, 0.45);
        }
    </style>
</head>
<body>
    <div class="logo-box">
        <div class="crown">👑</div>
        <div class="logo-text">AS</div>
        <div class="logo-sub">GAMES</div>
    </div>
    <h1>AS Games VIP</h1>
    <p>Connecting to secure live gaming servers... Please check your internet connection.</p>
    <a href="https://asgame.ascollab.in/?v=1" class="btn-reload">🚀 Open AS Games</a>
    <script>
        setInterval(function() {
            if (navigator.onLine) {
                window.location.href = 'https://asgame.ascollab.in/?v=1';
            }
        }, 3000);
    </script>
</body>
</html>"""
entries['assets/offline.html'] = offline_html.encode('utf-8')

print('3. Generating RSA Release Key and X.509 Certificate...')
key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
subject = issuer = x509.Name([
    x509.NameAttribute(NameOID.COMMON_NAME, u'AS Games Android Release'),
    x509.NameAttribute(NameOID.ORGANIZATION_NAME, u'AS Games VIP'),
    x509.NameAttribute(NameOID.COUNTRY_NAME, u'IN'),
])
cert = x509.CertificateBuilder().subject_name(
    subject
).issuer_name(
    issuer
).public_key(
    key.public_key()
).serial_number(
    x509.random_serial_number()
).not_valid_before(
    datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=1)
).not_valid_after(
    datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=365*25)
).sign(key, hashes.SHA256())

cert_der = cert.public_bytes(serialization.Encoding.DER)

print('4. Creating v1 JAR signature (MANIFEST.MF, CERT.SF, CERT.RSA)...')
manifest_lines = [b'Manifest-Version: 1.0', b'Created-By: 1.0 (Android)']
file_digests = {}
for name in sorted(entries.keys()):
    digest = base64.b64encode(hashlib.sha256(entries[name]).digest())
    file_digests[name] = digest
    manifest_lines.append(b'')
    manifest_lines.append(f'Name: {name}'.encode())
    manifest_lines.append(b'SHA-256-Digest: ' + digest)
manifest_lines.append(b'')
manifest_mf = b'\r\n'.join(manifest_lines) + b'\r\n'
entries['META-INF/MANIFEST.MF'] = manifest_mf

sf_lines = [
    b'Signature-Version: 1.0',
    b'Created-By: 1.0 (Android)',
    b'SHA-256-Digest-Manifest: ' + base64.b64encode(hashlib.sha256(manifest_mf).digest())
]
for name in sorted(file_digests.keys()):
    entry_data = f'Name: {name}\r\nSHA-256-Digest: {file_digests[name].decode()}\r\n\r\n'.encode()
    sf_lines.append(b'')
    sf_lines.append(f'Name: {name}'.encode())
    sf_lines.append(b'SHA-256-Digest: ' + base64.b64encode(hashlib.sha256(entry_data).digest()))
sf_lines.append(b'')
cert_sf = b'\r\n'.join(sf_lines) + b'\r\n'
entries['META-INF/CERT.SF'] = cert_sf

builder = pkcs7.PKCS7SignatureBuilder().set_data(cert_sf)
builder = builder.add_signer(cert, key, hashes.SHA256())
cert_rsa = builder.sign(serialization.Encoding.DER, [pkcs7.PKCS7Options.DetachedSignature])
entries['META-INF/CERT.RSA'] = cert_rsa

print('5. Writing APK zip with 4-byte alignment for stored files (Android 11+ requirement)...')
zip_buffer = io.BytesIO()
with zipfile.ZipFile(zip_buffer, 'w', compression=zipfile.ZIP_DEFLATED) as z_out:
    for priority in ['META-INF/MANIFEST.MF', 'META-INF/CERT.SF', 'META-INF/CERT.RSA']:
        z_out.writestr(priority, entries.pop(priority))
    for name in sorted(entries.keys()):
        if name == 'resources.arsc':
            # Calculate 4-byte alignment padding for ZipInfo.extra
            cur_pos = zip_buffer.tell()
            # Local file header is 30 bytes + len(filename) + len(extra)
            header_end = cur_pos + 30 + len(name.encode('utf-8'))
            pad = (4 - (header_end % 4)) % 4
            zi = zipfile.ZipInfo(name, date_time=(2026, 11, 27, 3, 45, 0))
            zi.compress_type = zipfile.ZIP_STORED
            if pad > 0:
                zi.extra = b'\x00' * pad
            z_out.writestr(zi, entries[name])
        else:
            z_out.writestr(name, entries[name], compress_type=zipfile.ZIP_DEFLATED)

raw_apk = zip_buffer.getvalue()

print('6. Generating APK Signature Scheme v2 Block (Alg ID 0x0103 SHA256withRSA)...')
eocd_pos = raw_apk.rfind(b'\x50\x4b\x05\x06')
cd_offset = struct.unpack('<I', raw_apk[eocd_pos+16:eocd_pos+20])[0]
cd_size = struct.unpack('<I', raw_apk[eocd_pos+12:eocd_pos+16])[0]

sec1 = raw_apk[:cd_offset]
sec2 = raw_apk[cd_offset:cd_offset+cd_size]
eocd = bytearray(raw_apk[eocd_pos:])

def get_chunks(data):
    for i in range(0, len(data), 1048576):
        yield data[i:i+1048576]

chunk_digests = []
for sec in [sec1, sec2, bytes(eocd)]:
    for ch in get_chunks(sec):
        ch_len = len(ch)
        h = hashlib.sha256(b'\xa5' + struct.pack('<I', ch_len) + ch).digest()
        chunk_digests.append(h)

top_digest = hashlib.sha256(b'\x5a' + struct.pack('<I', len(chunk_digests)) + b''.join(chunk_digests)).digest()

lp = lambda d: struct.pack('<I', len(d)) + d

# 0x0103 = SIGNATURE_RSA_PKCS1_V1_5_WITH_SHA256
ALG_RSA_PKCS1_SHA256 = 0x0103
digest_item = lp(struct.pack('<I', ALG_RSA_PKCS1_SHA256) + lp(top_digest))
cert_item = lp(cert_der)
attr_seq = struct.pack('<I', 0)

signed_data = lp(digest_item) + lp(cert_item) + attr_seq

sig_bytes = key.sign(signed_data, padding.PKCS1v15(), hashes.SHA256())
sig_item = lp(struct.pack('<I', ALG_RSA_PKCS1_SHA256) + lp(sig_bytes))

pub_bytes = key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)

signer = lp(signed_data) + lp(sig_item) + lp(pub_bytes)
signers = lp(lp(signer))

v2_pair = struct.pack('<I', 0x7109871a) + signers
v2_pair_lp64 = struct.pack('<Q', len(v2_pair)) + v2_pair

block_size = len(v2_pair_lp64) + 8 + 16
apk_signing_block = struct.pack('<Q', block_size) + v2_pair_lp64 + struct.pack('<Q', block_size) + b'APK Sig Block 42'

new_cd_offset = cd_offset + len(apk_signing_block)
eocd[16:20] = struct.pack('<I', new_cd_offset)

final_apk = sec1 + apk_signing_block + sec2 + bytes(eocd)

with open(apk_path, 'wb') as f:
    f.write(final_apk)

print(f'Done! Successfully built ASGames_v2.4.0.apk! Total size: {len(final_apk)} bytes')
