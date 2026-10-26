"""Create a reviewable source/evidence ZIP, with secret and archive integrity checks."""
import hashlib
import json
import subprocess
from datetime import datetime
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]


def main():
    raw = subprocess.check_output(['git','-c',f'safe.directory={ROOT.as_posix()}','ls-files','-z','--cached','--others','--exclude-standard'],cwd=ROOT)
    names = sorted(set(n.decode('utf-8') for n in raw.split(b'\0') if n))
    secrets = [v.encode() for k,v in dotenv_values(ROOT/'.env').items() if v and len(v)>10 and any(s in k.upper() for s in ('KEY','SECRET','TOKEN'))]
    files,manifest = [],[]
    for name in names:
        path = ROOT/name
        if not path.is_file(): continue
        if not path.resolve().is_relative_to(ROOT) or any(p in {'.git','.venv','node_modules','data','dist','__pycache__'} for p in path.relative_to(ROOT).parts):
            raise RuntimeError('Unexpected path in publication inventory')
        if path.name.startswith('.env') and path.name != '.env.example': raise RuntimeError('Secret file in inventory')
        content = path.read_bytes()
        if any(secret in content for secret in secrets): raise RuntimeError(f'Configured secret detected in {name}')
        files.append((name,content));manifest.append(f'{hashlib.sha256(content).hexdigest()}  {name}')
    folder = ROOT/'data/deliverables';folder.mkdir(parents=True,exist_ok=True)
    archive = folder/f'BrandonTravel2_Portfolio_1_0_{datetime.now():%Y%m%d_%H%M%S}.zip'
    with ZipFile(archive,'w',ZIP_DEFLATED,compresslevel=6) as z:
        for name,content in files:z.writestr('BrandonTravel2/'+name,content)
        z.writestr('BrandonTravel2/MANIFEST.sha256','\n'.join(manifest)+'\n')
    with ZipFile(archive) as z:
        if z.testzip() is not None: raise RuntimeError('Archive CRC check failed')
        for name,content in files:
            if hashlib.sha256(z.read('BrandonTravel2/'+name)).digest()!=hashlib.sha256(content).digest():
                raise RuntimeError('Archive hash mismatch')
    digest=hashlib.sha256(archive.read_bytes()).hexdigest()
    archive.with_suffix('.zip.sha256').write_text(digest+'  '+archive.name+'\n',encoding='utf-8')
    result={'path':str(archive),'bytes':archive.stat().st_size,'files':len(files)+1,'sha256':digest,'configuredSecretsScanned':len(secrets),'secretsFound':0,'crcAndHashes':'Pass'}
    (folder/'portfolio-package-verification.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps(result))


if __name__=='__main__':main()
