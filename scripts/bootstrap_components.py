"""Materialize the exact upstream registries for adaptation; preserve provenance."""
import json
from pathlib import Path
root = Path(__file__).resolve().parents[1]
web = root / 'apps/web'
web.mkdir(parents=True, exist_ok=True)
k = json.loads((root/'.references/kanban.json').read_text(encoding='utf-8-sig'))
c = json.loads((root/'.references/full-calendar.json').read_text(encoding='utf-8-sig'))
for f in k['files']:
    dest = web/'src'/f['target']
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(f['content'], encoding='utf-8')
for f in c['files']:
    dest = web/f['path']
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(f['content'], encoding='utf-8')
deps = {x: 'latest' for x in k['dependencies'] + c['dependencies']}
deps.update({'react':'^19.2.0','react-dom':'^19.2.0','lucide-react':'latest','clsx':'latest','tailwind-merge':'latest','class-variance-authority':'latest','radix-ui':'latest','sonner':'latest','@radix-ui/react-scroll-area':'latest'})
package = {'name':'brandontravel2-web','private':True,'version':'0.1.0','type':'module','scripts':{'dev':'vite --host 127.0.0.1','build':'tsc -b && vite build','test:e2e':'playwright test'},'dependencies':deps,'devDependencies':{'typescript':'latest','vite':'latest','@vitejs/plugin-react':'latest','@tailwindcss/vite':'latest','tailwindcss':'latest','@types/react':'latest','@types/react-dom':'latest','@types/node':'latest','@playwright/test':'latest','openapi-typescript':'latest'}}
(web/'package.json').write_text(json.dumps(package,indent=2),encoding='utf-8')
print('Installed source files:',len(k['files'])+len(c['files']))
print('Calendar shadcn dependencies:',c['registryDependencies'])
